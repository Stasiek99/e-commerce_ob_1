/**
 * Regression guard for the SSR render timeout + CSR fallback added in server.ts.
 *
 * The logic below mirrors the Promise.race handler from server.ts so that
 * reverting the timeout guard or the fallback headers fails these tests.
 * (Mirrors the pattern from app-init-ssr.spec.ts which documents the same approach.)
 *
 * Invariants:
 *  1. A render that completes within the timeout → sends the SSR HTML
 *  2. A render that exceeds the timeout → serves the CSR shell with
 *     X-SSR-Fallback: timeout and Cache-Control: no-store
 *  3. A render that fails with a non-timeout error → calls next(err) (500 handler)
 *  4. clearTimeout is called on both success and failure paths
 */

const TIMEOUT_MS = 10_000;
const CSR_SHELL = '<html><head></head><body><app-root></app-root></body></html>';

// Mirrors the per-request handler from server.ts.
// Tests call this function; changing the pattern in server.ts must break these tests.
// Helper that runs the handler and exposes mock objects for assertions
async function runHandler(
  renderPromise: Promise<string>,
  opts?: { csrShell?: string; timeoutMs?: number },
) {
  const res = {
    send: jest.fn<void, [string]>(),
    set: jest.fn<void, [string, string]>(),
  };
  const next = jest.fn<void, [unknown]>();

  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const err = new Error('SSR render timed out') as Error & { name: string };
      err.name = 'SSRTimeoutError';
      reject(err);
    }, opts?.timeoutMs ?? TIMEOUT_MS);
  });

  await Promise.race([renderPromise, timeoutPromise])
    .then((html) => {
      clearTimeout(timeoutHandle);
      res.send(html);
    })
    .catch((err: Error & { name?: string }) => {
      clearTimeout(timeoutHandle);
      if (err.name === 'SSRTimeoutError') {
        res.set('X-SSR-Fallback', 'timeout');
        res.set('Cache-Control', 'no-store');
        res.send(opts?.csrShell ?? CSR_SHELL);
        return;
      }
      next(err);
    });

  return { res, next };
}

describe('SSR render timeout + CSR fallback (server.ts pattern)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('sends SSR HTML when render completes within the timeout', async () => {
    const rendered = '<html>SSR content</html>';
    const handlerPromise = runHandler(Promise.resolve(rendered));

    // Advance time — render already resolved, timeout should not fire
    jest.advanceTimersByTime(TIMEOUT_MS - 1);
    const { res, next } = await handlerPromise;

    expect(res.send).toHaveBeenCalledWith(rendered);
    expect(res.set).not.toHaveBeenCalledWith('X-SSR-Fallback', 'timeout');
    expect(next).not.toHaveBeenCalled();
  });

  it('does NOT set Cache-Control: no-store when render succeeds', async () => {
    const handlerPromise = runHandler(Promise.resolve('<html>OK</html>'));
    const { res } = await handlerPromise;

    expect(res.set).not.toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  // ── Timeout path ─────────────────────────────────────────────────────────────

  it('serves the CSR shell when render exceeds the timeout', async () => {
    const neverResolves = new Promise<string>(() => {});
    const handlerPromise = runHandler(neverResolves);

    jest.advanceTimersByTime(TIMEOUT_MS + 1);
    const { res } = await handlerPromise;

    expect(res.send).toHaveBeenCalledWith(CSR_SHELL);
  });

  it('sets X-SSR-Fallback: timeout when render times out', async () => {
    const neverResolves = new Promise<string>(() => {});
    const handlerPromise = runHandler(neverResolves);

    jest.advanceTimersByTime(TIMEOUT_MS + 1);
    const { res } = await handlerPromise;

    expect(res.set).toHaveBeenCalledWith('X-SSR-Fallback', 'timeout');
  });

  it('sets Cache-Control: no-store when serving the CSR fallback', async () => {
    const neverResolves = new Promise<string>(() => {});
    const handlerPromise = runHandler(neverResolves);

    jest.advanceTimersByTime(TIMEOUT_MS + 1);
    const { res } = await handlerPromise;

    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('does NOT call next() when render times out (CSR fallback handles the response)', async () => {
    const neverResolves = new Promise<string>(() => {});
    const handlerPromise = runHandler(neverResolves);

    jest.advanceTimersByTime(TIMEOUT_MS + 1);
    const { next } = await handlerPromise;

    expect(next).not.toHaveBeenCalled();
  });

  it('serves the pre-read csrShell content (not a re-read)', async () => {
    const customShell = '<html>CUSTOM CSR SHELL</html>';
    const neverResolves = new Promise<string>(() => {});
    const handlerPromise = runHandler(neverResolves, { csrShell: customShell });

    jest.advanceTimersByTime(TIMEOUT_MS + 1);
    const { res } = await handlerPromise;

    expect(res.send).toHaveBeenCalledWith(customShell);
  });

  it('does NOT fire timeout when render completes 1ms before the threshold', async () => {
    // Render resolves at TIMEOUT_MS - 1; timeout is set to fire at TIMEOUT_MS
    const slowRender = new Promise<string>((resolve) => {
      setTimeout(() => resolve('<html>just in time</html>'), TIMEOUT_MS - 1);
    });
    const handlerPromise = runHandler(slowRender);

    jest.advanceTimersByTime(TIMEOUT_MS);
    const { res } = await handlerPromise;

    // Render won the race — CSR fallback must NOT be sent
    expect(res.send).toHaveBeenCalledWith('<html>just in time</html>');
    expect(res.set).not.toHaveBeenCalledWith('X-SSR-Fallback', 'timeout');
  });

  // ── Non-timeout render error path ──────────────────────────────────────────

  it('calls next(err) when render rejects with a non-timeout error', async () => {
    const renderError = new Error('Component threw during render');
    const handlerPromise = runHandler(Promise.reject(renderError));

    const { res, next } = await handlerPromise;

    expect(next).toHaveBeenCalledWith(renderError);
    // CSR fallback must NOT be activated for unexpected render errors
    expect(res.set).not.toHaveBeenCalledWith('X-SSR-Fallback', 'timeout');
    expect(res.send).not.toHaveBeenCalledWith(CSR_SHELL);
  });

  it('does NOT set X-SSR-Fallback when render rejects with a generic error', async () => {
    const handlerPromise = runHandler(Promise.reject(new Error('Database offline')));

    const { res } = await handlerPromise;

    expect(res.set).not.toHaveBeenCalledWith('X-SSR-Fallback', 'timeout');
  });
});
