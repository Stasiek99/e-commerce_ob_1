import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

/**
 * Loads third-party <script>/<link rel=stylesheet> resources on demand.
 *
 * Third-party assets that only matter on one route (the InPost GeoWidget on
 * checkout, Cloudflare Turnstile on the forms that submit a challenge) used to
 * sit in `index.html`, where they were fetched on *every* page load — the
 * GeoWidget stylesheet alone was render-blocking on the home page. Injecting
 * them at the moment they're first needed keeps them off the critical path
 * without changing behaviour where they are used.
 *
 * Each URL is loaded at most once; concurrent callers share one promise, and a
 * failed load is evicted so a later attempt can retry.
 */
@Injectable({ providedIn: 'root' })
export class ScriptLoaderService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly pending = new Map<string, Promise<void>>();

  loadScript(src: string): Promise<void> {
    return this.load(src, () => {
      const el = document.createElement('script');
      el.src = src;
      el.async = true;
      return el;
    });
  }

  loadStylesheet(href: string): Promise<void> {
    return this.load(href, () => {
      const el = document.createElement('link');
      el.rel = 'stylesheet';
      el.href = href;
      return el;
    });
  }

  private load(url: string, create: () => HTMLScriptElement | HTMLLinkElement): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return Promise.resolve(); // no DOM on the server — callers are all click-driven
    }
    const existing = this.pending.get(url);
    if (existing) return existing;

    const promise = new Promise<void>((resolve, reject) => {
      const el = create();
      el.addEventListener('load', () => resolve(), { once: true });
      el.addEventListener('error', () => {
        this.pending.delete(url); // allow a retry on the next user attempt
        reject(new Error(`Failed to load ${url}`));
      }, { once: true });
      document.head.appendChild(el);
    });

    this.pending.set(url, promise);
    return promise;
  }
}
