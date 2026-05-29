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

// Stateless no-op storage: prevents ReferenceError for any code that references
// localStorage/sessionStorage as a global before Angular DI runs. Services must
// inject LOCAL_STORAGE (storage.tokens.ts) which is provided per-request in
// server.ts — each render gets an isolated store so no cross-request leakage.
if (typeof localStorage === 'undefined') {
  const noopStorage = (): Storage => ({
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    length: 0,
  });
  globalScope['localStorage'] = noopStorage();
  globalScope['sessionStorage'] = noopStorage();
}

import { bootstrapApplication, BootstrapContext } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { config } from './app/app.config.server';

const bootstrap = (context: BootstrapContext) =>
  bootstrapApplication(AppComponent, config, context);

export default bootstrap;
