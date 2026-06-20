import { ConflictException, ExecutionContext } from '@nestjs/common';
import { GoogleAuthGuard } from '../guards/google-auth.guard';

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('GoogleAuthGuard', () => {
  let guard: GoogleAuthGuard;

  beforeEach(() => {
    guard = new GoogleAuthGuard();
  });

  describe('handleRequest', () => {
    it('stashes a strategy-side error on the request instead of throwing', () => {
      const request: Record<string, unknown> = {};
      const err = new ConflictException('already exists');

      const result = guard.handleRequest(err, null, undefined, makeContext(request));

      expect(result).toBeNull();
      expect(request['oauthError']).toBe(err);
    });

    it('returns the authenticated user untouched and does not set oauthError on success', () => {
      const request: Record<string, unknown> = {};
      const user = { id: 'user-1' };

      const result = guard.handleRequest(null, user, undefined, makeContext(request));

      expect(result).toBe(user);
      expect(request['oauthError']).toBeUndefined();
    });
  });
});
