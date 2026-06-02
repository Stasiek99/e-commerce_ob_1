import * as Sentry from '@sentry/nestjs';
import type { Request } from 'express';
import { CouponController } from '../coupon.controller';

const VALID_RESULT = {
  valid: true,
  couponId: 'coupon-1',
  discountType: 'PERCENTAGE',
  discountAmountInCents: 500,
};

const INVALID_RESULT = {
  valid: false,
  message: 'Kod rabatowy jest nieprawidłowy lub nieaktywny.',
};

const makeReq = (overrides: Record<string, unknown> = {}): Request =>
  ({ ip: '1.2.3.4', ips: [], headers: {}, ...overrides } as unknown as Request);

const makeDto = () => ({
  code: 'SAVE10',
  cartTotalInCents: 5000,
  variantIds: [],
});

describe('CouponController', () => {
  let controller: CouponController;
  let mockValidate: jest.Mock;
  let redis: { incr: jest.Mock; expire: jest.Mock; del: jest.Mock };
  let sentrySpy: jest.SpyInstance;

  beforeEach(() => {
    mockValidate = jest.fn();
    redis = {
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      del: jest.fn().mockResolvedValue(1),
    };

    // Instantiate directly to skip NestJS DI — we're testing handler logic only
    controller = new CouponController(
      { validate: mockValidate } as any,
      redis as any,
    );

    sentrySpy = jest.spyOn(Sentry, 'captureMessage').mockReturnValue(undefined as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ─── valid coupon path ────────────────────────────────────────────────────────

  describe('validate — valid coupon', () => {
    it('returns the service result when the coupon is valid', async () => {
      mockValidate.mockResolvedValue(VALID_RESULT);

      const result = await controller.validate(makeReq(), makeDto());

      expect(result).toEqual(VALID_RESULT);
    });

    it('resets the failure counter in Redis on a valid coupon', async () => {
      mockValidate.mockResolvedValue(VALID_RESULT);

      await controller.validate(makeReq(), makeDto());

      expect(redis.del).toHaveBeenCalledWith('coupon:validate:fail:1.2.3.4');
      expect(redis.incr).not.toHaveBeenCalled();
    });

    it('does not alert Sentry on a valid coupon', async () => {
      mockValidate.mockResolvedValue(VALID_RESULT);

      await controller.validate(makeReq(), makeDto());

      expect(sentrySpy).not.toHaveBeenCalled();
    });
  });

  // ─── invalid coupon path — below Sentry threshold ────────────────────────────

  describe('validate — invalid coupon below threshold', () => {
    it('increments the Redis failure counter on an invalid coupon', async () => {
      mockValidate.mockResolvedValue(INVALID_RESULT);
      redis.incr.mockResolvedValue(1);

      await controller.validate(makeReq(), makeDto());

      expect(redis.incr).toHaveBeenCalledWith('coupon:validate:fail:1.2.3.4');
    });

    it('sets a 5-minute rolling TTL on the failure counter', async () => {
      mockValidate.mockResolvedValue(INVALID_RESULT);
      redis.incr.mockResolvedValue(1);

      await controller.validate(makeReq(), makeDto());

      expect(redis.expire).toHaveBeenCalledWith('coupon:validate:fail:1.2.3.4', 300);
    });

    it('does not alert Sentry when failure count is below 5', async () => {
      mockValidate.mockResolvedValue(INVALID_RESULT);
      redis.incr.mockResolvedValue(4);

      await controller.validate(makeReq(), makeDto());

      expect(sentrySpy).not.toHaveBeenCalled();
    });

    it('does not reset the failure counter on an invalid coupon', async () => {
      mockValidate.mockResolvedValue(INVALID_RESULT);
      redis.incr.mockResolvedValue(1);

      await controller.validate(makeReq(), makeDto());

      expect(redis.del).not.toHaveBeenCalled();
    });
  });

  // ─── Sentry alert at threshold ────────────────────────────────────────────────

  describe('validate — Sentry alert at threshold', () => {
    it('fires a Sentry warning when failure count reaches 5', async () => {
      mockValidate.mockResolvedValue(INVALID_RESULT);
      redis.incr.mockResolvedValue(5);

      await controller.validate(makeReq(), makeDto());

      expect(sentrySpy).toHaveBeenCalledWith(
        expect.stringContaining('Coupon brute-force suspected'),
        'warning',
      );
    });

    it('includes the IP address in the Sentry alert message', async () => {
      mockValidate.mockResolvedValue(INVALID_RESULT);
      redis.incr.mockResolvedValue(5);

      await controller.validate(makeReq({ ip: '9.9.9.9' }), makeDto());

      expect(sentrySpy).toHaveBeenCalledWith(
        expect.stringContaining('9.9.9.9'),
        'warning',
      );
    });

    it('fires Sentry on every failure above threshold, not just the 5th', async () => {
      mockValidate.mockResolvedValue(INVALID_RESULT);
      redis.incr.mockResolvedValue(10);

      await controller.validate(makeReq(), makeDto());

      expect(sentrySpy).toHaveBeenCalledTimes(1);
    });
  });

  // ─── IP extraction ────────────────────────────────────────────────────────────

  describe('validate — IP extraction', () => {
    it('uses req.ips[0] (X-Forwarded-For) as the Redis key when available', async () => {
      mockValidate.mockResolvedValue(INVALID_RESULT);
      redis.incr.mockResolvedValue(1);

      await controller.validate(makeReq({ ips: ['203.0.113.1', '10.0.0.1'] }), makeDto());

      expect(redis.incr).toHaveBeenCalledWith('coupon:validate:fail:203.0.113.1');
    });

    it('falls back to req.ip when ips array is empty', async () => {
      mockValidate.mockResolvedValue(INVALID_RESULT);
      redis.incr.mockResolvedValue(1);

      await controller.validate(makeReq({ ip: '5.5.5.5', ips: [] }), makeDto());

      expect(redis.incr).toHaveBeenCalledWith('coupon:validate:fail:5.5.5.5');
    });

    it('uses "unknown" when neither ips nor ip are present', async () => {
      mockValidate.mockResolvedValue(INVALID_RESULT);
      redis.incr.mockResolvedValue(1);

      await controller.validate({ headers: {} } as unknown as Request, makeDto());

      expect(redis.incr).toHaveBeenCalledWith('coupon:validate:fail:unknown');
    });
  });
});
