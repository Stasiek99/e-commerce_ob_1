import * as bcrypt from 'bcrypt';
import { buildAdminAuthenticator, regenerateSessionOnLogin } from '../admin.setup';

jest.mock('bcrypt');

const mockBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('buildAdminAuthenticator', () => {
  const ADMIN_EMAIL = 'admin@example.com';
  const ADMIN_HASH = '$2b$10$hashedpassword';

  beforeEach(() => {
    jest.clearAllMocks();
    // hash() is called once at startup to produce the dummy hash
    mockBcrypt.hash.mockResolvedValue('$2b$10$dummyhash' as never);
  });

  it('precomputes a dummy hash exactly once on initialisation', async () => {
    await buildAdminAuthenticator(ADMIN_EMAIL, ADMIN_HASH);

    expect(mockBcrypt.hash).toHaveBeenCalledTimes(1);
    expect(mockBcrypt.hash).toHaveBeenCalledWith('timing-guard', 10);
  });

  describe('authenticate callback — wrong email', () => {
    it('always calls bcrypt.compare against the dummy hash to normalise timing', async () => {
      mockBcrypt.compare.mockResolvedValue(false as never);
      const authenticate = await buildAdminAuthenticator(ADMIN_EMAIL, ADMIN_HASH);

      const result = await authenticate('attacker@example.com', 'anypassword');

      expect(mockBcrypt.compare).toHaveBeenCalledTimes(1);
      expect(mockBcrypt.compare).toHaveBeenCalledWith('anypassword', '$2b$10$dummyhash');
      expect(result).toBeNull();
    });

    it('returns null regardless of password when email does not match', async () => {
      mockBcrypt.compare.mockResolvedValue(true as never);
      const authenticate = await buildAdminAuthenticator(ADMIN_EMAIL, ADMIN_HASH);

      const result = await authenticate('wrong@example.com', 'correct-password');

      expect(result).toBeNull();
    });
  });

  describe('authenticate callback — correct email', () => {
    it('returns null when password is wrong', async () => {
      mockBcrypt.compare.mockResolvedValue(false as never);
      const authenticate = await buildAdminAuthenticator(ADMIN_EMAIL, ADMIN_HASH);

      const result = await authenticate(ADMIN_EMAIL, 'wrong-password');

      expect(mockBcrypt.compare).toHaveBeenCalledWith('wrong-password', ADMIN_HASH);
      expect(result).toBeNull();
    });

    it('returns the email object when credentials are valid', async () => {
      mockBcrypt.compare.mockResolvedValue(true as never);
      const authenticate = await buildAdminAuthenticator(ADMIN_EMAIL, ADMIN_HASH);

      const result = await authenticate(ADMIN_EMAIL, 'correct-password');

      expect(result).toEqual({ email: ADMIN_EMAIL });
    });

    it('compares against adminPassword hash, not the dummy hash', async () => {
      mockBcrypt.compare.mockResolvedValue(true as never);
      const authenticate = await buildAdminAuthenticator(ADMIN_EMAIL, ADMIN_HASH);

      await authenticate(ADMIN_EMAIL, 'some-password');

      expect(mockBcrypt.compare).toHaveBeenCalledWith('some-password', ADMIN_HASH);
    });
  });

  describe('timing side-channel prevention', () => {
    it('calls bcrypt.compare once on wrong-email path (not zero times)', async () => {
      mockBcrypt.compare.mockResolvedValue(false as never);
      const authenticate = await buildAdminAuthenticator(ADMIN_EMAIL, ADMIN_HASH);

      await authenticate('notadmin@example.com', 'password');

      expect(mockBcrypt.compare).toHaveBeenCalledTimes(1);
    });

    it('calls bcrypt.compare once on correct-email path (same call count)', async () => {
      mockBcrypt.compare.mockResolvedValue(false as never);
      const authenticate = await buildAdminAuthenticator(ADMIN_EMAIL, ADMIN_HASH);

      await authenticate(ADMIN_EMAIL, 'wrong-password');

      expect(mockBcrypt.compare).toHaveBeenCalledTimes(1);
    });
  });
});

describe('regenerateSessionOnLogin', () => {
  it('calls next without regenerating when there is no authenticated passport user', () => {
    const next = jest.fn();
    const req: any = { session: {} };

    regenerateSessionOnLogin(req, {} as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('regenerates the session and re-attaches the passport user on first authenticated request', () => {
    const next = jest.fn();
    const regenerate = jest.fn((cb: (err: Error | null) => void) => cb(null));
    const session: any = { passport: { user: 'admin@example.com' }, regenerate };
    const req: any = { session };

    regenerateSessionOnLogin(req, {} as any, next);

    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(session.passport).toEqual({ user: 'admin@example.com' });
    expect(session._regenerated).toBe(true);
    expect(next).toHaveBeenCalledWith();
  });

  it('does not regenerate again once the session has already been regenerated', () => {
    const next = jest.fn();
    const regenerate = jest.fn();
    const session: any = { passport: { user: 'admin@example.com' }, _regenerated: true, regenerate };
    const req: any = { session };

    regenerateSessionOnLogin(req, {} as any, next);

    expect(regenerate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('forwards the error to next and does not mark the session as regenerated when regenerate fails', () => {
    const next = jest.fn();
    const error = new Error('store unavailable');
    const regenerate = jest.fn((cb: (err: Error | null) => void) => cb(error));
    const session: any = { passport: { user: 'admin@example.com' }, regenerate };
    const req: any = { session };

    regenerateSessionOnLogin(req, {} as any, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(session._regenerated).toBeUndefined();
  });
});
