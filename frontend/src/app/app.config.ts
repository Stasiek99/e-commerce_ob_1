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
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideServiceWorker } from '@angular/service-worker';
import { firstValueFrom, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthService } from './core/services/auth.service';
import { AnalyticsService } from './core/services/analytics.service';
import {
  Router,
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withViewTransitions,
} from '@angular/router';
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
    provideClientHydration(withEventReplay()),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withViewTransitions(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
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
    ...sentryProviders,
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
