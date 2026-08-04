import { provideTaiga, TUI_DARK_MODE } from "@taiga-ui/core";
import {
  ApplicationConfig,
  ErrorHandler,
  PLATFORM_ID,
  inject,
  isDevMode,
  provideAppInitializer,
  provideZoneChangeDetection,
  signal,
} from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import {
  provideClientHydration,
  withEventReplay,
  withHttpTransferCacheOptions,
} from "@angular/platform-browser";
import { provideServiceWorker } from "@angular/service-worker";
import { firstValueFrom, of } from "rxjs";
import { catchError } from "rxjs/operators";
import { AuthService } from "./core/services/auth.service";
import { AnalyticsService } from "./core/services/analytics.service";
import {
  NavigationEnd,
  NavigationStart,
  Router,
  TitleStrategy,
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
  withPreloading,
  withViewTransitions,
} from "@angular/router";
import { SelectivePreloadStrategy } from "./core/strategies/selective-preload.strategy";
import { AppTitleStrategy } from "./core/strategies/title.strategy";
import {
  provideHttpClient,
  withInterceptors,
  withFetch,
} from "@angular/common/http";
import { provideAnimationsAsync } from "@angular/platform-browser/animations/async";
import { LazySentryErrorHandler, scheduleSentryLoad } from "./core/sentry";
import { routes } from "./app.routes";
import { authInterceptor } from "./core/interceptors/auth.interceptor";
import { errorInterceptor } from "./core/interceptors/error.interceptor";
import { ssrTimeoutInterceptor } from "./core/interceptors/ssr-timeout.interceptor";
import { environment } from "../environments/environment";
import { LOCAL_STORAGE } from "./core/tokens/storage.tokens";
import { RESPONSE } from "./core/tokens/ssr.tokens";

// Angular Universal doesn't turn a guard-returned UrlTree into a real HTTP
// redirect — it silently renders the redirect target's component tree under
// the originally-requested URL at status 200 (e.g. checkoutGuard redirecting
// an empty cart to /cart still serves that markup at the /checkout URL).
// Bridges it to a real 3xx via the RESPONSE token, the same per-request
// express Response already used for the 404 case in product-detail.component.ts.
// No-op in the browser and whenever RESPONSE isn't provided (i.e. always, outside
// the one per-request SSR render in server.ts).
export function bridgeGuardRedirectsToHttp(): void {
  if (isPlatformBrowser(inject(PLATFORM_ID))) return;
  const response = inject(RESPONSE, { optional: true });
  if (!response) return;
  const router = inject(Router);

  let requestedUrl: string | null = null;
  const subscription = router.events.subscribe((event) => {
    if (event instanceof NavigationStart) {
      if (requestedUrl === null) requestedUrl = event.url;
      return;
    }
    if (!(event instanceof NavigationEnd)) return;

    if (
      !response.headersSent &&
      requestedUrl !== null &&
      event.urlAfterRedirects !== requestedUrl
    ) {
      response.redirect(302, event.urlAfterRedirects);
    }
    subscription.unsubscribe();
  });
}

const sentryProviders = environment.sentryDsn
  ? [
      // Buffers until the SDK chunk arrives, then replays — see core/sentry.ts.
      { provide: ErrorHandler, useClass: LazySentryErrorHandler },
      provideAppInitializer(() => {
        if (!isPlatformBrowser(inject(PLATFORM_ID))) return;
        // Deliberately not awaited: fetching the SDK must not delay bootstrap.
        scheduleSentryLoad(inject(Router));
      }),
    ]
  : [];

export const appConfig: ApplicationConfig = {
  providers: [
    provideClientHydration(
      withEventReplay(),
      withHttpTransferCacheOptions({ includePostRequests: false }),
    ),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withViewTransitions(),
      withInMemoryScrolling({ scrollPositionRestoration: "enabled" }),
      withPreloading(SelectivePreloadStrategy),
    ),
    provideHttpClient(
      withFetch(),
      withInterceptors([
        authInterceptor,
        errorInterceptor,
        ssrTimeoutInterceptor,
      ]),
    ),
    provideAnimationsAsync(),
    provideTaiga(),
    // Taiga UI 5 added TUI_DARK_MODE, which follows the OS/browser
    // prefers-color-scheme by default. The site's design tokens and
    // hand-written component styles (header, footer, product cards, ...)
    // only define a light palette, so letting Taiga's own components
    // auto-switch to dark produced a mismatched, half-dark UI for anyone
    // with a dark system theme. Pin the app to light until a real dark
    // theme is designed.
    {
      provide: TUI_DARK_MODE,
      useFactory: () => Object.assign(signal(false), { reset: () => {} }),
    },
    provideAppInitializer(() => {
      inject(AnalyticsService).init(environment.gtmId);
    }),
    provideAppInitializer(() => {
      bridgeGuardRedirectsToHttp();
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
    provideServiceWorker("ngsw-worker.js", {
      enabled: !isDevMode(),
      registrationStrategy: "registerWhenStable:30000",
    }),
  ],
};
