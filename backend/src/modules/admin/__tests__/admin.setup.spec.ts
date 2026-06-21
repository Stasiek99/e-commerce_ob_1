import * as bcrypt from 'bcrypt';
import {
  buildAdminAuthenticator,
  isAdminAuthenticated,
  regenerateSessionOnLogin,
  isGenerateLabelVisible,
  REVIEW_EDIT_PROPERTIES,
} from '../admin.setup';

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

describe('isAdminAuthenticated', () => {
  it('returns true when req.session.adminUser is set (the key @adminjs/express actually sets on login)', () => {
    const req: any = { session: { adminUser: { email: 'admin@example.com' } } };

    expect(isAdminAuthenticated(req)).toBe(true);
  });

  it('returns false when the session has no adminUser', () => {
    const req: any = { session: {} };

    expect(isAdminAuthenticated(req)).toBe(false);
  });

  it('returns false when there is no session at all', () => {
    const req: any = {};

    expect(isAdminAuthenticated(req)).toBe(false);
  });

  it('returns false for a session carrying only the unused req.session.passport.user shape', () => {
    // Regression guard: a logged-in admin's session never has this shape (no Passport
    // strategy is registered for the admin panel) — this is the wrong key /admin/picklist
    // and /admin/fulfillment-gap used to check, which made them permanently unreachable.
    const req: any = { session: { passport: { user: 'admin@example.com' } } };

    expect(isAdminAuthenticated(req)).toBe(false);
  });
});

describe('regenerateSessionOnLogin', () => {
  it('calls next without regenerating when there is no authenticated admin user', () => {
    const next = jest.fn();
    const req: any = { session: {} };

    regenerateSessionOnLogin(req, {} as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('regenerates the session and re-attaches the admin user on first authenticated request', () => {
    const next = jest.fn();
    const regenerate = jest.fn((cb: (err: Error | null) => void) => cb(null));
    const session: any = { adminUser: { email: 'admin@example.com' }, regenerate };
    const req: any = { session };

    regenerateSessionOnLogin(req, {} as any, next);

    expect(regenerate).toHaveBeenCalledTimes(1);
    expect(session.adminUser).toEqual({ email: 'admin@example.com' });
    expect(session._regenerated).toBe(true);
    expect(next).toHaveBeenCalledWith();
  });

  it('does not regenerate again once the session has already been regenerated', () => {
    const next = jest.fn();
    const regenerate = jest.fn();
    const session: any = { adminUser: { email: 'admin@example.com' }, _regenerated: true, regenerate };
    const req: any = { session };

    regenerateSessionOnLogin(req, {} as any, next);

    expect(regenerate).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('forwards the error to next and does not mark the session as regenerated when regenerate fails', () => {
    const next = jest.fn();
    const error = new Error('store unavailable');
    const regenerate = jest.fn((cb: (err: Error | null) => void) => cb(error));
    const session: any = { adminUser: { email: 'admin@example.com' }, regenerate };
    const req: any = { session };

    regenerateSessionOnLogin(req, {} as any, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(session._regenerated).toBeUndefined();
  });
});

describe('isGenerateLabelVisible', () => {
  it.each(['PENDING_PAYMENT', 'CANCELLED', 'REFUNDED', 'DELIVERED', 'SHIPPED'])(
    'returns false for %s orders, matching shippingService.generateLabel()\'s allowed-status guard',
    (status) => {
      expect(isGenerateLabelVisible(status)).toBe(false);
    },
  );

  it.each(['PAID', 'PROCESSING'])(
    'returns true for %s orders, the only statuses generateLabel() actually accepts',
    (status) => {
      expect(isGenerateLabelVisible(status)).toBe(true);
    },
  );

  it('returns true when status is undefined', () => {
    expect(isGenerateLabelVisible(undefined)).toBe(true);
  });
});

describe('REVIEW_EDIT_PROPERTIES', () => {
  it('whitelists only adminReply, keeping status/rating/productId out of the plain Edit form', () => {
    expect(REVIEW_EDIT_PROPERTIES).toEqual(['adminReply']);
  });

  it('excludes status, so rating/productId/status changes cannot bypass updateReviewStats()', () => {
    expect(REVIEW_EDIT_PROPERTIES).not.toContain('status');
    expect(REVIEW_EDIT_PROPERTIES).not.toContain('rating');
    expect(REVIEW_EDIT_PROPERTIES).not.toContain('productId');
  });
});
