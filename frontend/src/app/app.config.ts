import {
  ApplicationConfig,
  ErrorHandler,
  PLATFORM_ID,
  inject,
  isDevMode,
  provideAppInitializer,
  provideZoneChangeDetection,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { provideClientHydration, withEventReplay, withHttpTransferCacheOptions } from '@angular/platform-browser';
import { provideServiceWorker } from '@angular/service-worker';
import { firstValueFrom, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthService } from './core/services/auth.service';
import { AnalyticsService } from './core/services/analytics.service';
import {
  PreloadAllModules,
  Router,
  TitleStrategy,
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withPreloading,
  withViewTransitions,
} from '@angular/router';
import { AppTitleStrategy } from './core/strategies/title.strategy';
import {
  provideHttpClient,
  withInterceptors,
  withFetch,
} from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { NG_EVENT_PLUGINS } from '@taiga-ui/event-plugins';
import * as Sentry from '@sentry/angular';
import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { errorInterceptor } from './core/interceptors/error.interceptor';
import { environment } from '../environments/environment';
import { LOCAL_STORAGE } from './core/tokens/storage.tokens';

const sentryProviders = environment.sentryDsn
  ? [
      { provide: ErrorHandler, useValue: Sentry.createErrorHandler() },
      { provide: Sentry.TraceService, deps: [Router] },
      provideAppInitializer(() => {
        inject(Sentry.TraceService);
      }),
    ]
  : [];

export const appConfig: ApplicationConfig = {
  providers: [
    provideClientHydration(withEventReplay(), withHttpTransferCacheOptions({ includePostRequests: false })),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withViewTransitions(),
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
      withPreloading(PreloadAllModules),
    ),
    provideHttpClient(
      withFetch(),
      withInterceptors([authInterceptor, errorInterceptor]),
    ),
    provideAnimationsAsync(),
    NG_EVENT_PLUGINS,
    provideAppInitializer(() => {
      inject(AnalyticsService).init(environment.gtmId);
    }),
    provideAppInitializer(async () => {
      // Auth refresh is only meaningful in the browser (needs cookies). Skip in
      // SSR/prerender — otherwise every prerendered product page fires an extra
      // POST /auth/refresh against the backend, all returning 401.
      if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
      const auth = inject(AuthService);
      await firstValueFrom(auth.refresh().pipe(catchError(() => of(null))));
    }),
    // Browser: real window.localStorage. SSR: overridden per-request in server.ts
    // so the factory below is never reached on the server.
    {
      provide: LOCAL_STORAGE,
      useFactory: (): Storage =>
        isPlatformBrowser(inject(PLATFORM_ID))
          ? window.localStorage
          : ({
              getItem: () => null,
              setItem: () => {},
              removeItem: () => {},
              clear: () => {},
              key: () => null,
              length: 0,
            } as Storage),
    },
    { provide: TitleStrategy, useClass: AppTitleStrategy },
    ...sentryProviders,
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
