import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { TurnstileGuard } from '../turnstile.guard';

function makeContext(headers: Record<string, string> = {}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

const VALID_TOKEN = 'cf-test-token';
const SECRET = 'test-secret-key';

describe('TurnstileGuard', () => {
  let guard: TurnstileGuard;
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    guard = new TurnstileGuard();
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env['CLOUDFLARE_TURNSTILE_SECRET_KEY'];
  });

  describe('dev bypass (no secret key configured)', () => {
    it('allows request without calling Cloudflare when secret key is absent', async () => {
      delete process.env['CLOUDFLARE_TURNSTILE_SECRET_KEY'];
      const result = await guard.canActivate(makeContext());
      expect(result).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('allows request even without cf-turnstile-response header when secret is absent', async () => {
      delete process.env['CLOUDFLARE_TURNSTILE_SECRET_KEY'];
      const result = await guard.canActivate(makeContext({}));
      expect(result).toBe(true);
    });
  });

  describe('with secret key configured', () => {
    beforeEach(() => {
      process.env['CLOUDFLARE_TURNSTILE_SECRET_KEY'] = SECRET;
      // Re-create guard so it picks up the env var set above
      guard = new TurnstileGuard();
    });

    it('throws ForbiddenException when cf-turnstile-response header is missing', async () => {
      await expect(guard.canActivate(makeContext({}))).rejects.toThrow(ForbiddenException);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when Cloudflare returns success: false', async () => {
      fetchSpy.mockResolvedValueOnce({
        json: async () => ({ success: false }),
      } as Response);

      await expect(
        guard.canActivate(makeContext({ 'cf-turnstile-response': VALID_TOKEN })),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns true when Cloudflare returns success: true', async () => {
      fetchSpy.mockResolvedValueOnce({
        json: async () => ({ success: true }),
      } as Response);

      const result = await guard.canActivate(
        makeContext({ 'cf-turnstile-response': VALID_TOKEN }),
      );

      expect(result).toBe(true);
    });

    it('calls the Cloudflare siteverify endpoint with the correct secret and token', async () => {
      fetchSpy.mockResolvedValueOnce({
        json: async () => ({ success: true }),
      } as Response);

      await guard.canActivate(makeContext({ 'cf-turnstile-response': VALID_TOKEN }));

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
      expect(options.method).toBe('POST');
      expect(options.body).toContain(encodeURIComponent(SECRET));
      expect(options.body).toContain(encodeURIComponent(VALID_TOKEN));
    });

    it('throws ForbiddenException for an empty string token (not falsy bypass)', async () => {
      await expect(
        guard.canActivate(makeContext({ 'cf-turnstile-response': '' })),
      ).rejects.toThrow(ForbiddenException);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
