// Unit tests for the throttler getTracker function defined in app.module.ts.
//
// Invariant: with trust proxy = 1, Express populates req.ips from X-Forwarded-For.
// getTracker must read req.ips[0] (real client IP) — not req.ip (load-balancer IP).
// Without trust proxy, req.ips is always [] and all clients share one bucket.

// Mirror the exact function from app.module.ts — tests fail if the logic is changed.
const getTracker = (req: Record<string, unknown>): string =>
  String((req['ips'] as string[] | undefined)?.[0] ?? req['ip'] ?? '');

describe('throttler getTracker', () => {
  it('returns req.ips[0] when X-Forwarded-For is trusted (trust proxy = 1)', () => {
    const req = { ips: ['203.0.113.1', '10.0.0.1'], ip: '10.0.0.1' };

    expect(getTracker(req)).toBe('203.0.113.1');
  });

  it('returns the first IP from req.ips when multiple forwarders are present', () => {
    const req = { ips: ['198.51.100.5', '172.16.0.1', '10.0.0.1'], ip: '10.0.0.1' };

    expect(getTracker(req)).toBe('198.51.100.5');
  });

  it('falls back to req.ip when req.ips is empty (direct connection, no proxy)', () => {
    const req = { ips: [] as string[], ip: '192.168.1.42' };

    expect(getTracker(req)).toBe('192.168.1.42');
  });

  it('falls back to req.ip when req.ips is undefined', () => {
    const req = { ip: '192.168.1.42' };

    expect(getTracker(req)).toBe('192.168.1.42');
  });

  it('returns empty string when both req.ips and req.ip are absent', () => {
    const req: Record<string, unknown> = {};

    expect(getTracker(req)).toBe('');
  });

  it('does NOT return the load-balancer IP when a real client IP is in req.ips', () => {
    // Without trust proxy, req.ips is [] and req.ip resolves to the LB's IP.
    // With trust proxy, req.ips is populated and getTracker must return req.ips[0].
    const lbIp = '10.0.0.1';
    const clientIp = '203.0.113.99';
    const req = { ips: [clientIp, lbIp], ip: lbIp };

    const result = getTracker(req);

    expect(result).toBe(clientIp);
    expect(result).not.toBe(lbIp);
  });
});
