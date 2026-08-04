import {
  mergeApplicationConfig,
  ApplicationConfig,
  inject,
} from "@angular/core";
import { DOCUMENT } from "@angular/common";
import {
  provideServerRendering,
  withRoutes,
  RenderMode,
  ServerRoute,
} from "@angular/ssr";
import { WA_WINDOW } from "@ng-web-apis/common";
import { appConfig } from "./app.config";

/**
 * In SSR, `WA_WINDOW` (from @ng-web-apis/common, used transitively by Taiga UI)
 * resolves to `document.defaultView`, a minimal shim that lacks
 * `requestAnimationFrame` / `cancelAnimationFrame`. Taiga destructures both
 * off WINDOW at subscribe time, which throws during prerender.
 *
 * Taiga UI 5 also added TUI_DARK_MODE, which calls
 * `WA_WINDOW.matchMedia('(prefers-color-scheme: dark)')` eagerly at token
 * init and subscribes to its 'change' event via RxJS's fromEvent (which
 * needs addEventListener/removeEventListener). document.defaultView has no
 * matchMedia in the server DOM shim either, so it throws the same way.
 *
 * Wrap the server-side window in a Proxy that polyfills these fields with
 * inert fallbacks; everything else passes through untouched. The prerendered
 * shell always renders as light-mode (matches: false) — the client picks up
 * the real system preference on hydration.
 */
const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(
      withRoutes([
        // Token-consuming routes — single-use tokens must not be burned by SSR
        { path: "auth/magic-login", renderMode: RenderMode.Client },
        { path: "auth/verify-email", renderMode: RenderMode.Client },
        { path: "auth/callback", renderMode: RenderMode.Client },
        { path: "auth/reset-password", renderMode: RenderMode.Client },

        // Auth-guarded / user-specific — no SSR benefit, avoid leaking state
        { path: "account", renderMode: RenderMode.Client },
        { path: "account/**", renderMode: RenderMode.Client },
        { path: "cart", renderMode: RenderMode.Client },
        { path: "checkout", renderMode: RenderMode.Client },
        { path: "checkout/auth-choice", renderMode: RenderMode.Client },
        { path: "checkout/success", renderMode: RenderMode.Client },
        { path: "checkout/failure", renderMode: RenderMode.Client },
        { path: "wishlist", renderMode: RenderMode.Client },
        { path: "returns", renderMode: RenderMode.Client },
        { path: "orders/track", renderMode: RenderMode.Client },

        // Static informational pages — prerender at build time
        { path: "", renderMode: RenderMode.Prerender },
        { path: "legal/terms", renderMode: RenderMode.Prerender },
        { path: "legal/privacy", renderMode: RenderMode.Prerender },
        { path: "legal/withdrawal", renderMode: RenderMode.Prerender },
        { path: "partnership", renderMode: RenderMode.Prerender },
        { path: "auth/login", renderMode: RenderMode.Prerender },
        { path: "auth/register", renderMode: RenderMode.Prerender },
        { path: "auth/forgot-password", renderMode: RenderMode.Prerender },
        { path: "auth/magic-link", renderMode: RenderMode.Prerender },

        // Product/category pages: RenderMode.Server would require an absolute
        // API URL in the SSR Node.js context (no Vite proxy available).
        // environment.apiUrl is '/api' (relative) in dev — native fetch rejects
        // relative URLs, causing a TypeError → empty SSR render → browser
        // re-fetches → 408/NG0506. Client mode until SSR API URL is wired up.
        { path: "products", renderMode: RenderMode.Client },
        { path: "products/:slug", renderMode: RenderMode.Client },
        { path: "category/:slug", renderMode: RenderMode.Client },

        // Catch-all (404 page and any future routes not listed above)
        { path: "**", renderMode: RenderMode.Server },
      ] satisfies ServerRoute[]),
    ),
    {
      provide: WA_WINDOW,
      useFactory: () => {
        const doc = inject(DOCUMENT);
        const base = (doc?.defaultView ?? {}) as Record<
          string | symbol,
          unknown
        >;
        return new Proxy(base, {
          get(target, prop) {
            if (prop === "requestAnimationFrame") {
              return (cb: FrameRequestCallback): number =>
                setTimeout(() => cb(Date.now()), 16) as unknown as number;
            }
            if (prop === "cancelAnimationFrame") {
              return (handle: number): void => {
                clearTimeout(
                  handle as unknown as ReturnType<typeof setTimeout>,
                );
              };
            }
            if (prop === "matchMedia") {
              return (media: string) => ({
                matches: false,
                media,
                addEventListener: () => {},
                removeEventListener: () => {},
                addListener: () => {},
                removeListener: () => {},
                dispatchEvent: () => false,
              });
            }
            return target[prop];
          },
        });
      },
    },
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
