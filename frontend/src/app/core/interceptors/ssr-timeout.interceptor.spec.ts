/**
 * Regression guard for the ssrTimeoutInterceptor.
 *
 * Invariants:
 *  1. In SSR context (PLATFORM_ID='server'): HTTP requests that take longer than
 *     8000ms result in a TimeoutError so the outer SSR render timeout in server.ts
 *     can fall back to the CSR shell instead of hanging until Vercel's 30s cut.
 *  2. In browser context (PLATFORM_ID='browser'): requests pass through unchanged —
 *     no timeout is applied, normal browser networking is unaffected.
 */

import {
  TestBed,
  fakeAsync,
  tick,
  flushMicrotasks,
} from "@angular/core/testing";
import {
  HttpClient,
  provideHttpClient,
  withInterceptors,
} from "@angular/common/http";
import {
  HttpTestingController,
  provideHttpClientTesting,
} from "@angular/common/http/testing";
import { PLATFORM_ID } from "@angular/core";
import { ssrTimeoutInterceptor } from "./ssr-timeout.interceptor";

describe("ssrTimeoutInterceptor", () => {
  // ── SSR context ──────────────────────────────────────────────────────────────

  describe("SSR context (PLATFORM_ID=server)", () => {
    let http: HttpClient;
    let httpMock: HttpTestingController;

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          { provide: PLATFORM_ID, useValue: "server" },
          provideHttpClient(withInterceptors([ssrTimeoutInterceptor])),
          provideHttpClientTesting(),
        ],
      });
      http = TestBed.inject(HttpClient);
      httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
      httpMock.verify();
      TestBed.resetTestingModule();
    });

    it("passes through a request that completes well within 8000ms", fakeAsync(() => {
      let result: unknown;

      http.get("/api/products").subscribe((r) => {
        result = r;
      });
      const req = httpMock.expectOne("/api/products");
      req.flush([{ id: "1", name: "Rose Oud" }]);
      flushMicrotasks();

      expect(result).toEqual([{ id: "1", name: "Rose Oud" }]);
    }));

    it("emits TimeoutError when the backend does not respond within 8000ms", fakeAsync(() => {
      let caughtError: unknown;

      http.get("/api/slow").subscribe({
        error: (err) => {
          caughtError = err;
        },
      });
      httpMock.expectOne("/api/slow"); // intentionally never flushed

      tick(8001);
      flushMicrotasks();

      expect((caughtError as Error).name).toBe("TimeoutError");
    }));

    it("does NOT emit TimeoutError when request completes at exactly 7999ms", fakeAsync(() => {
      let caughtError: unknown;
      let result: unknown;

      http.get("/api/fast").subscribe({
        next: (r) => {
          result = r;
        },
        error: (err) => {
          caughtError = err;
        },
      });
      const req = httpMock.expectOne("/api/fast");

      tick(7999);
      req.flush({ status: "ok" }); // complete just before the timeout fires
      tick(2); // advance past 8000ms — timeout is already cancelled
      flushMicrotasks();

      expect(caughtError).toBeUndefined();
      expect(result).toEqual({ status: "ok" });
    }));

    it("applies the timeout independently to each request (no shared state)", fakeAsync(() => {
      const errors: string[] = [];

      http.get("/api/req-1").subscribe({ error: (e) => errors.push("req-1") });
      http.get("/api/req-2").subscribe({ error: (e) => errors.push("req-2") });
      httpMock.expectOne("/api/req-1"); // both left pending
      httpMock.expectOne("/api/req-2");

      tick(8001);
      flushMicrotasks();

      expect(errors).toEqual(expect.arrayContaining(["req-1", "req-2"]));
    }));
  });

  // ── Browser context ──────────────────────────────────────────────────────────

  describe("browser context (PLATFORM_ID=browser)", () => {
    let http: HttpClient;
    let httpMock: HttpTestingController;

    beforeEach(() => {
      TestBed.configureTestingModule({
        providers: [
          { provide: PLATFORM_ID, useValue: "browser" },
          provideHttpClient(withInterceptors([ssrTimeoutInterceptor])),
          provideHttpClientTesting(),
        ],
      });
      http = TestBed.inject(HttpClient);
      httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
      httpMock.verify();
      TestBed.resetTestingModule();
    });

    it("passes requests through without any timeout", fakeAsync(() => {
      let result: unknown;
      let caughtError: unknown;

      http.get("/api/test").subscribe({
        next: (r) => {
          result = r;
        },
        error: (err) => {
          caughtError = err;
        },
      });

      // Advance 10s — well past the 8s SSR threshold — no timeout in browser
      tick(10_001);
      flushMicrotasks();

      // No error yet — request is still pending
      expect(caughtError).toBeUndefined();

      // Now flush it to clean up
      const req = httpMock.expectOne("/api/test");
      req.flush({ data: "browser data" });
      flushMicrotasks();

      expect(result).toEqual({ data: "browser data" });
    }));

    it("completes normally for a standard browser request", fakeAsync(() => {
      let result: unknown;
      http.get("/api/catalog").subscribe((r) => {
        result = r;
      });
      const req = httpMock.expectOne("/api/catalog");
      req.flush([{ slug: "rose-oud" }]);
      flushMicrotasks();

      expect(result).toEqual([{ slug: "rose-oud" }]);
    }));
  });
});
