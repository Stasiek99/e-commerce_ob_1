/**
 * Storage stubs for SSR — CartService and CookieConsentComponent touch
 * localStorage/sessionStorage at module-evaluation time. Everything else
 * is handled by Angular 20's @angular/ssr pipeline.
 */
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
  (globalThis as Record<string, unknown>)['localStorage'] = createStorageMock();
  (globalThis as Record<string, unknown>)['sessionStorage'] = createStorageMock();
}

import { bootstrapApplication, BootstrapContext } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { config } from './app/app.config.server';

const bootstrap = (context: BootstrapContext) =>
  bootstrapApplication(AppComponent, config, context);

export default bootstrap;
