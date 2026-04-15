/**
 * SSR polyfills. Browser-only globals that some libraries touch before
 * Angular has a chance to short-circuit via platform-id guards:
 *   - localStorage / sessionStorage: CartService, CookieConsentComponent
 *   - requestAnimationFrame / cancelAnimationFrame: Taiga UI (<tui-root>)
 * Everything else is handled by Angular 20's @angular/ssr pipeline.
 */
const globalScope = globalThis as Record<string, unknown>;

if (typeof globalScope['requestAnimationFrame'] !== 'function') {
  globalScope['requestAnimationFrame'] = (cb: FrameRequestCallback): number =>
    setTimeout(() => cb(Date.now()), 16) as unknown as number;
  globalScope['cancelAnimationFrame'] = (handle: number): void => {
    clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
  };
}

if (typeof localStorage === 'undefined') {
  const createStorageMock = (): Storage => {
    const store: Record<string, string> = {};
    return {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = String(v);
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        Object.keys(store).forEach((k) => delete store[k]);
      },
      get length() {
        return Object.keys(store).length;
      },
      key: (i: number) => Object.keys(store)[i] ?? null,
    };
  };
  globalScope['localStorage'] = createStorageMock();
  globalScope['sessionStorage'] = createStorageMock();
}

import { bootstrapApplication, BootstrapContext } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { config } from './app/app.config.server';

const bootstrap = (context: BootstrapContext) =>
  bootstrapApplication(AppComponent, config, context);

export default bootstrap;
