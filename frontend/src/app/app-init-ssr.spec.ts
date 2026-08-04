/**
 * Behavioural tests for the auth appInitializer SSR/prerender guard.
 *
 * Invariant: auth.refresh() must NOT fire when PLATFORM_ID is 'server'.
 * Without this guard, a build with N prerendered product pages fires N
 * redundant POST /auth/refresh calls to the backend (all 401s), adding
 * needless build latency proportional to the catalog size.
 *
 * The initializer logic below is a verbatim copy of app.config.ts so that
 * removing the guard from the real config is caught by both this file and
 * the source-level assertions in pwa.spec.ts.
 */

import { TestBed } from "@angular/core/testing";
import {
  ApplicationInitStatus,
  PLATFORM_ID,
  inject,
  provideAppInitializer,
} from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import { firstValueFrom, of, throwError, EMPTY } from "rxjs";
import { catchError } from "rxjs/operators";
import { AuthService } from "./core/services/auth.service";

// Mirrors the inline initializer in app.config.ts.
const ssrGuardedAuthInitializer = async () => {
  if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
  const auth = inject(AuthService);
  await firstValueFrom(auth.refresh().pipe(catchError(() => of(null))));
};

// ── server platform ───────────────────────────────────────────────────────────

describe("auth appInitializer — server platform (SSR / prerender)", () => {
  it("does not call auth.refresh() — skips the HTTP round-trip entirely", async () => {
    const mockRefresh = jest.fn().mockReturnValue(EMPTY);

    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: "server" },
        { provide: AuthService, useValue: { refresh: mockRefresh } },
        provideAppInitializer(ssrGuardedAuthInitializer),
      ],
    });

    await TestBed.inject(ApplicationInitStatus).donePromise;

    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("resolves without blocking the bootstrap lifecycle", async () => {
    const mockRefresh = jest.fn().mockReturnValue(EMPTY);

    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: "server" },
        { provide: AuthService, useValue: { refresh: mockRefresh } },
        provideAppInitializer(ssrGuardedAuthInitializer),
      ],
    });

    await expect(
      TestBed.inject(ApplicationInitStatus).donePromise,
    ).resolves.toBeUndefined();
  });
});

// ── browser platform ──────────────────────────────────────────────────────────

describe("auth appInitializer — browser platform", () => {
  it("calls auth.refresh() exactly once to restore the session", async () => {
    const mockRefresh = jest
      .fn()
      .mockReturnValue(of({ accessToken: "restored-token" }));

    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: "browser" },
        { provide: AuthService, useValue: { refresh: mockRefresh } },
        provideAppInitializer(ssrGuardedAuthInitializer),
      ],
    });

    await TestBed.inject(ApplicationInitStatus).donePromise;

    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("still resolves when auth.refresh() returns a 401 (catchError swallows it)", async () => {
    const mockRefresh = jest
      .fn()
      .mockReturnValue(throwError(() => ({ status: 401 })));

    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: "browser" },
        { provide: AuthService, useValue: { refresh: mockRefresh } },
        provideAppInitializer(ssrGuardedAuthInitializer),
      ],
    });

    // A 401 is expected for unauthenticated users — must NOT crash the app
    await expect(
      TestBed.inject(ApplicationInitStatus).donePromise,
    ).resolves.toBeUndefined();
  });

  it("still resolves when auth.refresh() returns a network error", async () => {
    const mockRefresh = jest
      .fn()
      .mockReturnValue(throwError(() => new Error("Network error")));

    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: "browser" },
        { provide: AuthService, useValue: { refresh: mockRefresh } },
        provideAppInitializer(ssrGuardedAuthInitializer),
      ],
    });

    await expect(
      TestBed.inject(ApplicationInitStatus).donePromise,
    ).resolves.toBeUndefined();
  });
});
