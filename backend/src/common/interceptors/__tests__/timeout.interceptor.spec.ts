import { BadRequestException, ExecutionContext, RequestTimeoutException } from '@nestjs/common';
import { CallHandler } from '@nestjs/common';
import { Observable, of, throwError, NEVER } from 'rxjs';
import { lastValueFrom } from 'rxjs';
import { TimeoutInterceptor } from '../timeout.interceptor';

const makeCtx = () => ({} as ExecutionContext);
const makeHandler = (obs: Observable<any>): CallHandler => ({ handle: () => obs });

describe('TimeoutInterceptor', () => {
  describe('happy path', () => {
    it('passes the resolved value through when handler completes within the timeout', async () => {
      const interceptor = new TimeoutInterceptor(1_000);

      const result = await lastValueFrom(
        interceptor.intercept(makeCtx(), makeHandler(of('response-value'))),
      );

      expect(result).toBe('response-value');
    });

    it('works with the default 30 000 ms timeout (fast observable resolves normally)', async () => {
      const interceptor = new TimeoutInterceptor(); // default constructor

      const result = await lastValueFrom(
        interceptor.intercept(makeCtx(), makeHandler(of(42))),
      );

      expect(result).toBe(42);
    });
  });

  describe('timeout enforcement', () => {
    it('throws RequestTimeoutException when the handler exceeds the configured timeout', async () => {
      const interceptor = new TimeoutInterceptor(10); // 10 ms — fires before NEVER emits

      await expect(
        lastValueFrom(interceptor.intercept(makeCtx(), makeHandler(NEVER))),
      ).rejects.toThrow(RequestTimeoutException);
    }, 5_000);

    it('does NOT throw RequestTimeoutException when the handler resolves just in time', async () => {
      const interceptor = new TimeoutInterceptor(1_000);

      await expect(
        lastValueFrom(interceptor.intercept(makeCtx(), makeHandler(of('fast')))),
      ).resolves.toBe('fast');
    });
  });

  describe('error pass-through', () => {
    it('re-throws non-timeout errors without wrapping them in RequestTimeoutException', async () => {
      const interceptor = new TimeoutInterceptor(1_000);
      const upstream = new BadRequestException('bad input');

      await expect(
        lastValueFrom(
          interceptor.intercept(makeCtx(), makeHandler(throwError(() => upstream))),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('preserves the original error reference for non-timeout errors', async () => {
      const interceptor = new TimeoutInterceptor(1_000);
      const originalError = new Error('upstream failure');

      let caught: unknown;
      try {
        await lastValueFrom(
          interceptor.intercept(makeCtx(), makeHandler(throwError(() => originalError))),
        );
      } catch (e) {
        caught = e;
      }

      expect(caught).toBe(originalError);
    });

    it('does not convert upstream errors into RequestTimeoutException', async () => {
      const interceptor = new TimeoutInterceptor(1_000);

      let caught: unknown;
      try {
        await lastValueFrom(
          interceptor.intercept(
            makeCtx(),
            makeHandler(throwError(() => new Error('unrelated'))),
          ),
        );
      } catch (e) {
        caught = e;
      }

      expect(caught).not.toBeInstanceOf(RequestTimeoutException);
    });
  });
});
