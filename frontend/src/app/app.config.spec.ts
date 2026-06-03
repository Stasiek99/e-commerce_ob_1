import { TestBed } from '@angular/core/testing';
import { PreloadAllModules, PreloadingStrategy } from '@angular/router';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';

import { appConfig } from './app.config';
import { AuthService } from './core/services/auth.service';
import { AnalyticsService } from './core/services/analytics.service';

describe('appConfig', () => {
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

  // Regression guard: withPreloading(PreloadAllModules) must remain in provideRouter.
  // Removing it reverts the PreloadingStrategy token to NoPreloading, failing this test.
  it('registers PreloadAllModules as the router preloading strategy', () => {
    const strategy = TestBed.inject(PreloadingStrategy);

    expect(strategy).toBeInstanceOf(PreloadAllModules);
  });
});
