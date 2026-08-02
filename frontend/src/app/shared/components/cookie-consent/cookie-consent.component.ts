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
            <button tuiButton appearance="primary" size="m" type="button" class="btn-accept" (click)="acceptAll()">
              Akceptuj wszystkie
            </button>
            <!-- outline, not flat: as a flat button this rendered as bare text
                 and read as a caption rather than a control. Under GDPR the
                 reject path has to be as easy to find as the accept one. -->
            <button tuiButton appearance="outline" size="m" type="button" class="btn-reject" (click)="rejectNonEssential()">
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
      justify-content: center;
      gap: 16px 32px;
      flex-wrap: wrap;
      text-align: center;
    }

    .banner__text {
      /* Sized to its content rather than flex: 1, so the text and the buttons
         stay centred as a group instead of being pushed to opposite edges. */
      flex: 0 1 auto;
      min-width: 260px;
      max-width: 640px;
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

    /* Side by side rather than stacked: on mobile the banner is fixed to the
       bottom and one button per row made it tall enough to bury the hero's
       "Przewijaj, aby odkryć" hint. */
    .banner__actions {
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: center;
      gap: 12px;
      flex-shrink: 0;
    }

    /* Once the text has wrapped onto its own row the actions get the full
       width, so let the two buttons share it evenly. */
    @media (max-width: 767px) {
      .banner__actions { width: 100%; flex-wrap: wrap; }
      /* A basis of 0 ignored the labels' intrinsic width, so at 360px
         "Akceptuj wszystkie" needed 166px inside a 158px button and was
         clipped. An auto basis starts at the content width; the buttons still
         share the row evenly whenever it fits. */
      .banner__actions > * { flex: 1 1 auto; }
    }

    /* Taiga's outline appearance assumes a light surface — recolour the border
       and label for the dark banner. */
    .btn-reject {
      color: rgba(255, 255, 255, 0.88);
      border-color: rgba(255, 255, 255, 0.45);
    }
    .btn-reject:hover {
      color: #fff;
      border-color: rgba(255, 255, 255, 0.75);
    }
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
