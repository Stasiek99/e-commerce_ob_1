import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [RouterLink],
  template: `
    <footer class="footer">
      <div class="footer__inner">
        <div class="footer__brand">
          <img src="assets/images/logo_full_white.webp" alt="Aromaterie" class="footer__logo-img"
               width="636" height="300" loading="lazy" decoding="async" />
          <p>Wysokiej jakości perfumy i zapachy do domu.</p>
        </div>
        <nav class="footer__nav" aria-label="Nawigacja sklepu">
          <a routerLink="/products">Wszystkie produkty</a>
          <a routerLink="/category/perfume">Perfumy</a>
          <a routerLink="/category/diffusers">Dyfuzory</a>
          <a routerLink="/category/gels">Żele pod prysznic</a>
          <a routerLink="/account">Moje konto</a>
        </nav>
        <nav class="footer__legal" aria-label="Informacje prawne">
          <a routerLink="/legal/terms">Regulamin</a>
          <a routerLink="/legal/privacy">Polityka prywatności</a>
          <a routerLink="/legal/withdrawal">Prawo odstąpienia</a>
          <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noopener">Platforma ODR (rozwiązywanie sporów online)</a>
        </nav>
        <address class="footer__seller" aria-label="Dane sprzedawcy">
          <span class="footer__seller-title">Dane sprzedawcy</span>
          <span>{{ seller.legalName }}</span>
          <span>{{ seller.street }}, {{ seller.postalCode }} {{ seller.city }}</span>
          <span>NIP: {{ seller.nip }} &nbsp;·&nbsp; REGON: {{ seller.regon }}</span>
          <span>KRS/CEIDG: {{ seller.krs }}</span>
          <a [href]="'mailto:' + seller.email">{{ seller.email }}</a>
        </address>
        <p class="footer__copy">&copy; {{ year }} Aromaterie. Wszelkie prawa zastrzeżone.</p>
      </div>
    </footer>
  `,
  styles: [`
    .footer {
      background: var(--color-primary);
      color: rgba(255,255,255,0.7);
      padding: 48px 0 24px;
    }
    .footer__inner {
      max-width: var(--max-width);
      margin: 0 auto;
      padding: 0 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
    }
    .footer__logo-img { height: 128px; width: auto; display: block; margin: -28px auto -16px; }
    .footer__brand p { margin: 6px 0 0; }
    .footer__nav { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px 24px; margin: 24px 0; }
    .footer__nav a { font-size: 14px; color: rgba(255,255,255,0.7); transition: color 0.15s; }
    .footer__nav a:hover { color: white; }
    .footer__legal { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px 20px; margin-bottom: 16px; }
    .footer__legal a { font-size: 12px; color: rgba(255,255,255,0.75); transition: color 0.15s; }
    .footer__legal a:hover { color: white; }
    .footer__seller {
      font-style: normal;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: rgba(255,255,255,0.65);
      border-top: 1px solid rgba(255,255,255,0.1);
      padding-top: 16px;
      margin-top: 8px;
      width: 100%;
    }
    .footer__seller-title { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: rgba(255,255,255,0.65); margin-bottom: 4px; }
    .footer__seller a { color: rgba(255,255,255,0.55); transition: color 0.15s; }
    .footer__seller a:hover { color: white; }
    .footer__copy { font-size: 12px; margin-top: 16px; }
  `],
})
export class FooterComponent {
  readonly year = new Date().getFullYear();
  readonly seller = environment.seller;
}
