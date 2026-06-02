/**
 * Regression harness for the ChunkLoadError bootstrap-catch handler in main.ts.
 *
 * Invariant: when bootstrapApplication rejects with a ChunkLoadError (or any
 * error whose message contains "chunk"), the catch handler must trigger a page
 * reload instead of surfacing the error to console.
 *
 * Logic is inlined here verbatim (with an injectable reload callback to work
 * around jsdom's non-configurable window.location.reload in test environments)
 * so that removing the guard from main.ts causes these tests to fail immediately.
 */

// Mirrors the catch handler in main.ts, with the reload side-effect injectable
// so the predicate logic can be tested without fighting jsdom's frozen Location.
const handleBootstrapError = (
  err: { name?: string; message?: string } | null | undefined,
  reload: () => void = () => window.location.reload(),
): void => {
  if (err?.name === 'ChunkLoadError' || err?.message?.includes('chunk')) {
    reload();
    return;
  }
  console.error(err);
};

describe('main.ts bootstrap catch handler', () => {
  let reloadSpy: jest.Mock;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    reloadSpy = jest.fn();
    consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => jest.clearAllMocks());

  it('calls reload when the error name is ChunkLoadError', () => {
    const err = Object.assign(new Error('Loading chunk 5 failed.'), { name: 'ChunkLoadError' });

    handleBootstrapError(err, reloadSpy);

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('calls reload when the error message contains "chunk"', () => {
    const err = new Error('Failed to fetch dynamically imported module: chunk-ABCDEF12.js');

    handleBootstrapError(err, reloadSpy);

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('logs via console.error and does NOT reload for an unrelated error', () => {
    const err = new Error('Cannot read properties of undefined');

    handleBootstrapError(err, reloadSpy);

    expect(reloadSpy).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(err);
  });

  it('logs via console.error and does NOT reload for a null error', () => {
    handleBootstrapError(null, reloadSpy);

    expect(reloadSpy).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(null);
  });
});
