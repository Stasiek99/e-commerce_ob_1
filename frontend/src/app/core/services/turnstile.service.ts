import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { environment } from '../../../environments/environment';

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      size?: 'invisible' | 'normal' | 'compact';
      execution?: 'render' | 'execute';
      callback?: (token: string) => void;
      'error-callback'?: () => void;
      'expired-callback'?: () => void;
    },
  ): string;
  execute(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window { turnstile?: TurnstileApi; }
}

@Injectable({ providedIn: 'root' })
export class TurnstileService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly siteKey = environment.turnstileSiteKey;
  private container: HTMLDivElement | null = null;
  private widgetId: string | null = null;

  getToken(): Promise<string> {
    if (!isPlatformBrowser(this.platformId)) {
      return Promise.resolve(''); // SSR — challenges cannot run server-side
    }
    if (!this.siteKey) {
      if (environment.production) {
        return Promise.reject(
          new Error(
            '[Turnstile] TURNSTILE_SITE_KEY is not set for production. ' +
            'Set it in Vercel environment variables and trigger a redeploy.',
          ),
        );
      }
      return Promise.resolve(''); // dev bypass
    }
    const api = window.turnstile;
    if (!api) return Promise.resolve('');

    return new Promise<string>((resolve) => {
      if (!this.container) {
        this.container = document.createElement('div');
        this.container.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
        document.body.appendChild(this.container);
      }

      if (this.widgetId !== null) {
        api.remove(this.widgetId);
        this.widgetId = null;
      }

      this.widgetId = api.render(this.container, {
        sitekey: this.siteKey,
        size: 'invisible',
        execution: 'execute',
        callback: (token) => resolve(token),
        'error-callback': () => resolve(''),
        'expired-callback': () => resolve(''),
      });

      api.execute(this.widgetId);
    });
  }
}
