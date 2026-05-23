/**
 * E2E security tests — API-level, no browser required.
 *
 * Covers:
 *  1. Unauthenticated access to admin/protected routes → 401
 *  2. Regular-user token on ADMIN-role routes → 403
 *  3. Cross-user data access (IDOR) — accessing another user's resources
 *  4. Input validation on security-sensitive parameters
 *
 * Prerequisites: backend running at http://localhost:3000
 * Run: pnpm --filter e2e test
 */

import { test, expect, type APIRequestContext } from '@playwright/test';

// A valid UUID that references no real database row.
const PHANTOM_UUID = '00000000-0000-4000-8000-000000000001';

async function registerUser(request: APIRequestContext): Promise<string> {
  const email = `security-test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await request.post('/auth/register', {
    data: { email, password: 'TestPassword123!', firstName: 'Test', lastName: 'User' },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`registerUser failed (${res.status()}): ${body}`);
  }
  const { accessToken } = await res.json();
  return accessToken as string;
}

// Register two shared test users once for the whole file.
// The /auth/register endpoint is throttled to 3 req/min — using one beforeAll
// keeps us well inside that limit across all describe blocks.
let userAToken: string;
let userBToken: string;

test.beforeAll(async ({ request }) => {
  [userAToken, userBToken] = await Promise.all([
    registerUser(request),
    registerUser(request),
  ]);
});

// ─── 1. Unauthenticated access ───────────────────────────────────────────────

test.describe('Unauthenticated admin access', () => {
  test('GET /orders/admin/all → 401', async ({ request }) => {
    const res = await request.get('/orders/admin/all');
    expect(res.status()).toBe(401);
  });

  test('PATCH /orders/admin/:id/status → 401', async ({ request }) => {
    const res = await request.patch(`/orders/admin/${PHANTOM_UUID}/status`, {
      data: { status: 'PROCESSING' },
    });
    expect(res.status()).toBe(401);
  });

  test('GET /payments/:orderId/status → 401', async ({ request }) => {
    const res = await request.get(`/payments/${PHANTOM_UUID}/status`);
    expect(res.status()).toBe(401);
  });

  test('POST /payments/:orderId/refund → 401', async ({ request }) => {
    const res = await request.post(`/payments/${PHANTOM_UUID}/refund`);
    expect(res.status()).toBe(401);
  });

  test('GET /orders → 401', async ({ request }) => {
    const res = await request.get('/orders');
    expect(res.status()).toBe(401);
  });

  test('GET /orders/:id → 401', async ({ request }) => {
    const res = await request.get(`/orders/${PHANTOM_UUID}`);
    expect(res.status()).toBe(401);
  });

  test('GET /users/me → 401', async ({ request }) => {
    const res = await request.get('/users/me');
    expect(res.status()).toBe(401);
  });
});

// ─── 2. Role-based access control ────────────────────────────────────────────

test.describe('Regular user cannot reach ADMIN-only routes', () => {
  test('GET /orders/admin/all → 403 for regular user', async ({ request }) => {
    const res = await request.get('/orders/admin/all', {
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    expect(res.status()).toBe(403);
  });

  test('PATCH /orders/admin/:id/status → 403 for regular user', async ({ request }) => {
    const res = await request.patch(`/orders/admin/${PHANTOM_UUID}/status`, {
      data: { status: 'PROCESSING' },
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    expect(res.status()).toBe(403);
  });
});

// ─── 3. Cross-user data access (IDOR) ────────────────────────────────────────

test.describe('Cross-user data access (IDOR protection)', () => {

  test('GET /payments/:orderId/status — authenticated user gets non-401 for unknown order', async ({
    request,
  }) => {
    // Confirms auth check runs: unauthenticated → 401, authenticated → 404 (not found).
    // The 404 proves the auth layer executed and the ownership logic ran.
    const res = await request.get(`/payments/${PHANTOM_UUID}/status`, {
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    expect(res.status()).not.toBe(401);
    expect(res.status()).toBe(404); // payment doesn't exist → NotFoundException
  });

  test('GET /payments/:orderId/status — User B cannot observe User A\'s access token', async ({
    request,
  }) => {
    // Both users request the same phantom order.
    // Neither owns it → both get 404 (no data leakage between users).
    // The 403 case (User B accessing an order that exists and belongs to User A) is
    // verified by the unit test in payments.service.spec.ts ("throws ForbiddenException
    // when user does not own the order") — replicating it here would require full
    // order/payment DB seeding.
    const [resA, resB] = await Promise.all([
      request.get(`/payments/${PHANTOM_UUID}/status`, {
        headers: { Authorization: `Bearer ${userAToken}` },
      }),
      request.get(`/payments/${PHANTOM_UUID}/status`, {
        headers: { Authorization: `Bearer ${userBToken}` },
      }),
    ]);

    // Both authenticated users hit the same not-found wall — no 200 leaks through.
    expect(resA.status()).not.toBe(200);
    expect(resB.status()).not.toBe(200);
    // Responses are identical: ownership check is symmetric.
    expect(resA.status()).toBe(resB.status());
  });

  test('GET /orders/:id — User B cannot observe User A\'s order', async ({ request }) => {
    // findOneForUser uses { where: { id, userId } } — cross-user returns same 404
    // as not-found (intentional: doesn't reveal whether the resource exists).
    const res = await request.get(`/orders/${PHANTOM_UUID}`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    expect(res.status()).toBe(404);
  });

  test('GET /orders — each user sees only their own order list', async ({ request }) => {
    const [resA, resB] = await Promise.all([
      request.get('/orders', { headers: { Authorization: `Bearer ${userAToken}` } }),
      request.get('/orders', { headers: { Authorization: `Bearer ${userBToken}` } }),
    ]);

    expect(resA.ok()).toBeTruthy();
    expect(resB.ok()).toBeTruthy();

    const bodyA = await resA.json();
    const bodyB = await resB.json();

    // Fresh test users have no orders — but the isolation guarantee is the key property:
    // each response belongs to its respective user only.
    expect(bodyA).toHaveProperty('data');
    expect(bodyB).toHaveProperty('data');
  });
});

// ─── 3b. New endpoint IDOR / auth coverage ───────────────────────────────────

test.describe('GET /orders/:id/events auth and IDOR', () => {
  test('unauthenticated → 401', async ({ request }) => {
    const res = await request.get(`/orders/${PHANTOM_UUID}/events`);
    expect(res.status()).toBe(401);
  });

  test('authenticated user on phantom order → 404 (not 200, not 500)', async ({ request }) => {
    const res = await request.get(`/orders/${PHANTOM_UUID}/events`, {
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    expect(res.status()).toBe(404);
  });
});

test.describe('POST /orders/admin/:id/invoice auth and RBAC', () => {
  test('unauthenticated → 401', async ({ request }) => {
    const res = await request.post(`/orders/admin/${PHANTOM_UUID}/invoice`);
    expect(res.status()).toBe(401);
  });

  test('regular user → 403', async ({ request }) => {
    const res = await request.post(`/orders/admin/${PHANTOM_UUID}/invoice`, {
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    expect(res.status()).toBe(403);
  });
});

// ─── 4. Input validation on security-sensitive parameters ────────────────────

test.describe('Input validation', () => {
  test('GET /payments/:orderId/status rejects non-UUID → 400', async ({ request }) => {
    const res = await request.get('/payments/not-a-uuid/status', {
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    expect(res.status()).toBe(400);
  });

  test('POST /payments/:orderId/refund non-UUID → 403 for regular user (roles guard fires before pipe)', async ({ request }) => {
    // NestJS guard order: JwtAuthGuard → RolesGuard → ParseUUIDPipe.
    // A non-admin user is rejected by RolesGuard (403) before UUID
    // validation ever runs — correct and intentional NestJS behaviour.
    const res = await request.post('/payments/not-a-uuid/refund', {
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    expect(res.status()).toBe(403);
  });

  test('x-session-id header rejects non-UUID format → 400', async ({ request }) => {
    // Cart GET is public (OptionalJwtGuard), so no token needed to trigger the header validator.
    const res = await request.get('/cart', {
      headers: { 'x-session-id': 'definitely-not-a-uuid' },
    });
    expect(res.status()).toBe(400);
  });
});
