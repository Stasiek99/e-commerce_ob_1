import { mergeApplicationConfig, ApplicationConfig, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { provideServerRendering, withRoutes, RenderMode, ServerRoute } from '@angular/ssr';
import { WA_WINDOW } from '@ng-web-apis/common';
import { appConfig } from './app.config';

/**
 * In SSR, `WA_WINDOW` (from @ng-web-apis/common, used transitively by Taiga UI)
 * resolves to `document.defaultView`, a minimal shim that lacks
 * `requestAnimationFrame` / `cancelAnimationFrame`. Taiga destructures both
 * off WINDOW at subscribe time, which throws during prerender.
 *
 * Wrap the server-side window in a Proxy that polyfills these two fields
 * with setTimeout-based fallbacks; everything else passes through untouched.
 */
const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(
      // Token-consuming routes must run client-side only. The tokens are
      // single-use; an SSR pass would silently burn them before hydration.
      withRoutes([
        { path: 'auth/magic-login', renderMode: RenderMode.Client },
        { path: 'auth/verify-email', renderMode: RenderMode.Client },
      ] satisfies ServerRoute[]),
    ),
    {
      provide: WA_WINDOW,
      useFactory: () => {
        const doc = inject(DOCUMENT);
        const base = (doc?.defaultView ?? {}) as Record<string | symbol, unknown>;
        return new Proxy(base, {
          get(target, prop) {
            if (prop === 'requestAnimationFrame') {
              return (cb: FrameRequestCallback): number =>
                setTimeout(() => cb(Date.now()), 16) as unknown as number;
            }
            if (prop === 'cancelAnimationFrame') {
              return (handle: number): void => {
                clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
              };
            }
            return target[prop];
          },
        });
      },
    },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
