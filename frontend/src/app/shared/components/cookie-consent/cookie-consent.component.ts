import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TuiButton } from '@taiga-ui/core';
import { ConsentService } from '../../../core/services/consent.service';

@Component({
  selector: 'app-cookie-consent',
  standalone: true,
  imports: [RouterLink, TuiButton],
  template: `
    @if (visible()) {
      <div class="banner" role="dialog" aria-label="Zgoda na pliki cookie" aria-live="polite">
        <div class="banner__inner">
          <p class="banner__text">
            Używamy plików cookie do analizy ruchu i ulepszania sklepu.
            Dane są przetwarzane anonimowo — nie sprzedajemy ich osobom trzecim.
            <a routerLink="/legal/privacy" class="banner__link">Polityka prywatności</a>
          </p>

          <div class="banner__actions">
            <button tuiButton appearance="primary" type="button" class="btn-accept" (click)="acceptAll()">
              Akceptuj wszystkie
            </button>
            <button tuiButton appearance="flat" type="button" class="btn-reject" (click)="rejectNonEssential()">
              Tylko niezbędne
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .banner {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: #1a1a1a;
      color: rgba(255, 255, 255, 0.88);
      z-index: 9999;
      padding: 20px 16px;
      box-shadow: 0 -2px 16px rgba(0, 0, 0, 0.25);
    }

    .banner__inner {
      max-width: var(--max-width, 1200px);
      margin: 0 auto;
      display: flex;
      align-items: center;
      gap: 32px;
      flex-wrap: wrap;
    }

    .banner__text {
      flex: 1;
      min-width: 260px;
      font-size: 13px;
      line-height: 1.6;
      margin: 0;
      color: rgba(255, 255, 255, 0.78);
    }

    .banner__link {
      color: #c9a96e;
      text-decoration: underline;
      white-space: nowrap;
    }

    .banner__actions {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }

    .btn-accept { width: 100%; }

    /* Flat button text is dark by default — override for the dark banner */
    .btn-reject { color: rgba(255, 255, 255, 0.70); font-size: 12px; }
    .btn-reject:hover { color: rgba(255, 255, 255, 0.90); }
  `],
})
export class CookieConsentComponent {
  private readonly consent = inject(ConsentService);

  readonly visible = computed(() => this.consent.bannerVisible());

  acceptAll(): void {
    this.consent.acceptAll();
  }

  rejectNonEssential(): void {
    this.consent.rejectNonEssential();
  }
}
