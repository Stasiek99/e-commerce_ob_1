import { TestBed } from "@angular/core/testing";
import { PreloadingStrategy, TitleStrategy } from "@angular/router";
import { provideHttpClientTesting } from "@angular/common/http/testing";
import { of } from "rxjs";

import { appConfig } from "./app.config";
import { AppTitleStrategy } from "./core/strategies/title.strategy";
import { SelectivePreloadStrategy } from "./core/strategies/selective-preload.strategy";
import { AuthService } from "./core/services/auth.service";
import { AnalyticsService } from "./core/services/analytics.service";

describe("appConfig", () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ...appConfig.providers,
        // Override HttpClient so interceptors don't need a real backend
        provideHttpClientTesting(),
        // Stub initializer dependencies — they don't affect DI token registration
        { provide: AuthService, useValue: { refresh: () => of(null) } },
        { provide: AnalyticsService, useValue: { init: jest.fn() } },
      ],
    });
  });

  // Regression guard: withPreloading(SelectivePreloadStrategy) must remain in provideRouter.
  // Removing it reverts the PreloadingStrategy token to NoPreloading, failing this test.
  it("registers SelectivePreloadStrategy as the router preloading strategy", () => {
    const strategy = TestBed.inject(PreloadingStrategy);

    expect(strategy).toBeInstanceOf(SelectivePreloadStrategy);
  });

  // Regression guard: AppTitleStrategy must be wired as the TitleStrategy so screen
  // readers receive unique page names on navigation (WCAG 2.4.2 / EAA compliance).
  // We inspect the providers array directly to avoid resolving the DI chain (which
  // needs platform-browser providers not available in this lightweight test module).
  it("registers AppTitleStrategy as the TitleStrategy provider", () => {
    const entry = (
      appConfig.providers as { provide?: unknown; useClass?: unknown }[]
    ).find((p) => p?.provide === TitleStrategy);

    expect(entry).toBeDefined();
    expect(entry?.useClass).toBe(AppTitleStrategy);
  });
});
