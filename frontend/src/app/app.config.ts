import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  provideAppInitializer,
  provideZoneChangeDetection,
} from '@angular/core';
import {
  Router,
  provideRouter,
  withComponentInputBinding,
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
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding(), withViewTransitions()),
    provideHttpClient(
      withFetch(),
      withInterceptors([authInterceptor, errorInterceptor]),
    ),
    provideAnimationsAsync(),
    NG_EVENT_PLUGINS,
    ...sentryProviders,
  ],
};
