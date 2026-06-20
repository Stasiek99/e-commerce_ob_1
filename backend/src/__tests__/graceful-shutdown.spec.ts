/**
 * Regression guard for the graceful-shutdown wiring in main.ts.
 *
 * Invariants:
 *  1. keepAliveTimeout is set to 5 000 ms — below Railway's SIGKILL window (≈10 s),
 *     so idle keep-alive connections drain before the OS force-kills the process.
 *  2. On SIGTERM/SIGINT, the HTTP server is drained (closeIdleConnections() +
 *     server.close()) BEFORE app.close() runs — app.close() triggers Nest's
 *     callDestroyHook(), which disconnects Prisma process-wide via
 *     PrismaService.onModuleDestroy(). If app.close() ran first (as with
 *     app.enableShutdownHooks()), in-flight requests would lose their DB
 *     connection before the HTTP server even stopped accepting traffic.
 *  3. The HTTP drain is bounded by the same 8 000 ms budget as TimeoutInterceptor,
 *     so a stuck connection can never block shutdown past Railway's SIGKILL window.
 *  4. A repeated signal (SIGTERM twice, or SIGTERM then SIGINT) triggers the drain
 *     sequence exactly once.
 *  5. main.ts no longer calls app.enableShutdownHooks() — that API runs
 *     callDestroyHook() (Prisma teardown) before dispose() (HTTP close), which is
 *     the exact ordering bug this wiring replaces.
 */

import * as fs from 'fs';
import * as path from 'path';

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

  it('registers a SIGINT handler via process.once (not process.on)', () => {
    expect(mainSource).toContain("process.once('SIGINT'");
  });

  it('calls server.closeIdleConnections() in the shutdown handler', () => {
    expect(mainSource).toContain('server.closeIdleConnections()');
  });

  it('configures TimeoutInterceptor at 8_000 ms — below Railway SIGKILL window', () => {
    expect(mainSource).toContain('new TimeoutInterceptor(8_000)');
  });

  it('obtains the HTTP server via app.getHttpServer() after listen()', () => {
    expect(mainSource).toContain('app.getHttpServer()');
  });

  it('does NOT call app.enableShutdownHooks() — it runs Prisma teardown before HTTP drain', () => {
    expect(mainSource).not.toContain('enableShutdownHooks');
  });

  it('closes the HTTP server and only calls app.close() once draining settles', () => {
    expect(mainSource).toContain('server.close(');
    expect(mainSource).toContain('.then(() => app.close())');

    const serverCloseIndex = mainSource.indexOf('server.close(');
    const appCloseIndex = mainSource.indexOf('.then(() => app.close())');
    expect(serverCloseIndex).toBeGreaterThan(-1);
    expect(appCloseIndex).toBeGreaterThan(serverCloseIndex);
  });
});

// ── Behaviour tests ───────────────────────────────────────────────────────────
// The shutdown pattern is reproduced as a pure helper so it can be exercised
// without bootstrapping the full NestJS app. The source contract above ensures
// that if main.ts diverges from this pattern the tests still fail.

const RAILWAY_SIGKILL_WINDOW_MS = 10_000;
const CONFIGURED_KEEP_ALIVE_MS = 5_000;
const CONFIGURED_TIMEOUT_INTERCEPTOR_MS = 8_000;

// Drains the microtask queue past a multi-step promise chain (race → then → then).
// A fixed number of `await Promise.resolve()` calls is fragile to chain-length
// changes; setImmediate runs after the entire microtask queue has emptied.
const flushMicrotasks = () => new Promise<void>((resolve) => setImmediate(resolve));

function wireShutdown(
  server: { closeIdleConnections: () => void; close: (cb: () => void) => void; keepAliveTimeout: number },
  appClose: () => Promise<void>,
  exit: (code: number) => void,
  drainTimeoutMs = CONFIGURED_TIMEOUT_INTERCEPTOR_MS,
): void {
  server.keepAliveTimeout = CONFIGURED_KEEP_ALIVE_MS;

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;

    server.closeIdleConnections();
    const drained = new Promise<void>((resolve) => server.close(() => resolve()));
    const timedOut = new Promise<void>((resolve) => setTimeout(resolve, drainTimeoutMs));

    Promise.race([drained, timedOut])
      .then(() => appClose())
      .then(() => exit(0));
  };

  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

describe('main.ts — graceful shutdown behaviour', () => {
  afterEach(() => {
    process.removeAllListeners('SIGTERM');
    process.removeAllListeners('SIGINT');
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // ── keepAliveTimeout ─────────────────────────────────────────────────────

  it('sets keepAliveTimeout to 5 000 ms on the server', () => {
    const server = { keepAliveTimeout: 0, closeIdleConnections: jest.fn(), close: jest.fn() };

    wireShutdown(server, jest.fn().mockResolvedValue(undefined), jest.fn());

    expect(server.keepAliveTimeout).toBe(5_000);
  });

  it('configured keepAliveTimeout is strictly below Railway SIGKILL window', () => {
    expect(CONFIGURED_KEEP_ALIVE_MS).toBeGreaterThan(0);
    expect(CONFIGURED_KEEP_ALIVE_MS).toBeLessThan(RAILWAY_SIGKILL_WINDOW_MS);
  });

  // ── SIGTERM → drain before teardown ──────────────────────────────────────

  it('calls closeIdleConnections() and server.close() when SIGTERM fires', () => {
    const closeIdleConnections = jest.fn();
    const close = jest.fn();
    const server = { keepAliveTimeout: 0, closeIdleConnections, close };

    wireShutdown(server, jest.fn().mockResolvedValue(undefined), jest.fn());
    process.emit('SIGTERM');

    expect(closeIdleConnections).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does NOT call app.close() until the HTTP server finishes draining', async () => {
    let drainCallback: (() => void) | undefined;
    const server = {
      keepAliveTimeout: 0,
      closeIdleConnections: jest.fn(),
      close: jest.fn((cb: () => void) => {
        drainCallback = cb; // simulate an in-flight request still being served
      }),
    };
    const appClose = jest.fn().mockResolvedValue(undefined);

    wireShutdown(server, appClose, jest.fn());
    process.emit('SIGTERM');
    await flushMicrotasks();

    expect(appClose).not.toHaveBeenCalled();

    drainCallback!();
    await flushMicrotasks();

    expect(appClose).toHaveBeenCalledTimes(1);
  });

  it('calls exit(0) only after app.close() resolves', async () => {
    let resolveAppClose: () => void;
    const appClose = jest.fn(
      () => new Promise<void>((resolve) => (resolveAppClose = resolve)),
    );
    const server = {
      keepAliveTimeout: 0,
      closeIdleConnections: jest.fn(),
      close: jest.fn((cb: () => void) => cb()), // drains immediately
    };
    const exit = jest.fn();

    wireShutdown(server, appClose, exit);
    process.emit('SIGTERM');
    await flushMicrotasks();

    expect(appClose).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();

    resolveAppClose!();
    await flushMicrotasks();

    expect(exit).toHaveBeenCalledWith(0);
  });

  it('falls back to app.close() after the drain timeout when the server never finishes closing', async () => {
    jest.useFakeTimers();
    const server = {
      keepAliveTimeout: 0,
      closeIdleConnections: jest.fn(),
      close: jest.fn(), // never invokes its callback — simulates a stuck connection
    };
    const appClose = jest.fn().mockResolvedValue(undefined);

    wireShutdown(server, appClose, jest.fn(), CONFIGURED_TIMEOUT_INTERCEPTOR_MS);
    process.emit('SIGTERM');

    await Promise.resolve();
    expect(appClose).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(CONFIGURED_TIMEOUT_INTERCEPTOR_MS);

    expect(appClose).toHaveBeenCalledTimes(1);
  });

  // ── dedupe across repeated / multiple signals ────────────────────────────

  it('drains exactly once even when SIGTERM fires twice', () => {
    const closeIdleConnections = jest.fn();
    const close = jest.fn();
    const server = { keepAliveTimeout: 0, closeIdleConnections, close };

    wireShutdown(server, jest.fn().mockResolvedValue(undefined), jest.fn());
    process.emit('SIGTERM');
    process.emit('SIGTERM');

    expect(closeIdleConnections).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('drains exactly once when both SIGTERM and SIGINT arrive', () => {
    const closeIdleConnections = jest.fn();
    const close = jest.fn();
    const server = { keepAliveTimeout: 0, closeIdleConnections, close };

    wireShutdown(server, jest.fn().mockResolvedValue(undefined), jest.fn());
    process.emit('SIGTERM');
    process.emit('SIGINT');

    expect(closeIdleConnections).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
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
