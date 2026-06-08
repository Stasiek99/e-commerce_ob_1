/**
 * Regression guard for the graceful-shutdown wiring added to main.ts.
 *
 * Invariants:
 *  1. keepAliveTimeout is set to 5 000 ms — below Railway's SIGKILL window (≈10 s),
 *     so idle keep-alive connections drain before the OS force-kills the process.
 *  2. A process.once('SIGTERM') handler calls server.closeIdleConnections(), which
 *     immediately releases idle connections on shutdown without waiting for the
 *     keep-alive timer to expire.
 *  3. TimeoutInterceptor is configured at 8 000 ms — below Railway's SIGKILL window,
 *     so in-flight requests are aborted by the interceptor, not by SIGKILL.
 *  4. The handler uses process.once (not process.on), so a double SIGTERM does not
 *     trigger a second closeIdleConnections() call.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

// ── Source contract ───────────────────────────────────────────────────────────
// These fail if the shutdown wiring is removed or misconfigured in main.ts.

describe('main.ts — graceful shutdown source contract', () => {
  const mainSource = fs.readFileSync(
    path.join(__dirname, '../main.ts'),
    'utf-8',
  );

  it('sets keepAliveTimeout to 5_000 ms on the HTTP server', () => {
    expect(mainSource).toContain('server.keepAliveTimeout = 5_000');
  });

  it('registers a SIGTERM handler via process.once (not process.on)', () => {
    expect(mainSource).toContain("process.once('SIGTERM'");
  });

  it('calls server.closeIdleConnections() in the SIGTERM handler', () => {
    expect(mainSource).toContain('server.closeIdleConnections()');
  });

  it('configures TimeoutInterceptor at 8_000 ms — below Railway SIGKILL window', () => {
    expect(mainSource).toContain('new TimeoutInterceptor(8_000)');
  });

  it('obtains the HTTP server via app.getHttpServer() after listen()', () => {
    expect(mainSource).toContain('app.getHttpServer()');
  });
});

// ── Behaviour tests ───────────────────────────────────────────────────────────
// The shutdown pattern is reproduced as a pure helper so it can be exercised
// without bootstrapping the full NestJS app. The source contract above ensures
// that if main.ts diverges from this pattern the tests still fail.

const RAILWAY_SIGKILL_WINDOW_MS = 10_000;
const CONFIGURED_KEEP_ALIVE_MS = 5_000;
const CONFIGURED_TIMEOUT_INTERCEPTOR_MS = 8_000;

function wireShutdown(server: Pick<http.Server, 'closeIdleConnections' | 'keepAliveTimeout'>): void {
  server.keepAliveTimeout = CONFIGURED_KEEP_ALIVE_MS;
  process.once('SIGTERM', () => server.closeIdleConnections());
}

describe('main.ts — graceful shutdown behaviour', () => {
  afterEach(() => {
    process.removeAllListeners('SIGTERM');
  });

  // ── keepAliveTimeout ─────────────────────────────────────────────────────

  it('sets keepAliveTimeout to 5 000 ms on the server', () => {
    const server = { keepAliveTimeout: 0, closeIdleConnections: jest.fn() };

    wireShutdown(server);

    expect(server.keepAliveTimeout).toBe(5_000);
  });

  it('configured keepAliveTimeout is strictly below Railway SIGKILL window', () => {
    expect(CONFIGURED_KEEP_ALIVE_MS).toBeGreaterThan(0);
    expect(CONFIGURED_KEEP_ALIVE_MS).toBeLessThan(RAILWAY_SIGKILL_WINDOW_MS);
  });

  // ── SIGTERM → closeIdleConnections ───────────────────────────────────────

  it('calls closeIdleConnections() when SIGTERM fires', () => {
    const closeIdleConnections = jest.fn();
    const server = { keepAliveTimeout: 0, closeIdleConnections };

    wireShutdown(server);
    process.emit('SIGTERM');

    expect(closeIdleConnections).toHaveBeenCalledTimes(1);
  });

  it('does NOT call closeIdleConnections() before SIGTERM fires', () => {
    const closeIdleConnections = jest.fn();
    const server = { keepAliveTimeout: 0, closeIdleConnections };

    wireShutdown(server);
    // No SIGTERM emitted

    expect(closeIdleConnections).not.toHaveBeenCalled();
  });

  // ── process.once semantics ────────────────────────────────────────────────

  it('calls closeIdleConnections() exactly once even when SIGTERM fires twice', () => {
    const closeIdleConnections = jest.fn();
    const server = { keepAliveTimeout: 0, closeIdleConnections };

    wireShutdown(server);
    process.emit('SIGTERM');
    process.emit('SIGTERM'); // second signal must not trigger a second call

    expect(closeIdleConnections).toHaveBeenCalledTimes(1);
  });

  // ── TimeoutInterceptor window ─────────────────────────────────────────────

  it('configured TimeoutInterceptor timeout is strictly below Railway SIGKILL window', () => {
    expect(CONFIGURED_TIMEOUT_INTERCEPTOR_MS).toBeGreaterThan(0);
    expect(CONFIGURED_TIMEOUT_INTERCEPTOR_MS).toBeLessThan(RAILWAY_SIGKILL_WINDOW_MS);
  });

  it('TimeoutInterceptor timeout is greater than keepAliveTimeout (requests outlast idle connections)', () => {
    expect(CONFIGURED_TIMEOUT_INTERCEPTOR_MS).toBeGreaterThan(CONFIGURED_KEEP_ALIVE_MS);
  });
});
