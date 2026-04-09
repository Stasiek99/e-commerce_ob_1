import { Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

const STORAGE_KEY = 'cookie_consent_accepted';

@Component({
  selector: 'app-cookie-consent',
  standalone: true,
  imports: [RouterLink],
  template: `
    @if (visible()) {
      <div class="cookie-banner" role="dialog" aria-label="Zgoda na pliki cookie" aria-live="polite">
        <div class="cookie-banner__content">
          <p>
            Ta strona używa plików cookie niezbędnych do działania koszyka i sesji użytkownika.
            Szczegóły w <a routerLink="/legal/privacy">Polityce prywatności</a>.
          </p>
          <div class="cookie-banner__actions">
            <button class="btn-accept" (click)="accept()">Akceptuję</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .cookie-banner {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: #1a1a1a;
      color: rgba(255,255,255,0.9);
      z-index: 9999;
      padding: 16px;
      box-shadow: 0 -2px 12px rgba(0,0,0,0.2);
    }
    .cookie-banner__content {
      max-width: var(--max-width, 1200px);
      margin: 0 auto;
      display: flex;
      align-items: center;
      gap: 24px;
      flex-wrap: wrap;
    }
    p {
      font-size: 13px;
      line-height: 1.5;
      margin: 0;
      flex: 1;
      min-width: 240px;
    }
    a { color: #c9a96e; text-decoration: underline; }
    .cookie-banner__actions { display: flex; gap: 10px; flex-shrink: 0; }
    .btn-accept {
      background: var(--color-primary, #2d2d2d);
      color: white;
      border: none;
      padding: 10px 22px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .btn-accept:hover { opacity: 0.85; }
  `],
})
export class CookieConsentComponent {
  readonly visible = signal(!localStorage.getItem(STORAGE_KEY));

  accept(): void {
    localStorage.setItem(STORAGE_KEY, '1');
    this.visible.set(false);
  }
}
