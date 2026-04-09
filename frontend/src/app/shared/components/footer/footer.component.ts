import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [RouterLink],
  template: `
    <footer class="footer">
      <div class="footer__inner">
        <div class="footer__brand">
          <span class="footer__logo">Fragrance Store</span>
          <p>Wysokiej jakości perfumy i zapachy do domu.</p>
        </div>
        <nav class="footer__nav">
          <a routerLink="/products">Perfumy</a>
          <a routerLink="/category/dyfuzory">Dyfuzory</a>
          <a routerLink="/account">Moje konto</a>
        </nav>
        <nav class="footer__legal">
          <a routerLink="/legal/terms">Regulamin</a>
          <a routerLink="/legal/privacy">Polityka prywatności</a>
          <a routerLink="/legal/withdrawal">Prawo odstąpienia</a>
        </nav>
        <p class="footer__copy">&copy; {{ year }} Fragrance Store. Wszelkie prawa zastrzeżone.</p>
      </div>
    </footer>
  `,
  styles: [`
    .footer {
      background: var(--color-primary);
      color: rgba(255,255,255,0.7);
      padding: 48px 0 24px;
      margin-top: 64px;
    }
    .footer__inner {
      max-width: var(--max-width);
      margin: 0 auto;
      padding: 0 16px;
    }
    .footer__logo { font-size: 18px; font-weight: 700; color: white; }
    .footer__nav { display: flex; gap: 24px; margin: 24px 0; }
    .footer__nav a { font-size: 14px; color: rgba(255,255,255,0.7); transition: color 0.15s; }
    .footer__nav a:hover { color: white; }
    .footer__legal { display: flex; gap: 20px; margin-bottom: 16px; }
    .footer__legal a { font-size: 12px; color: rgba(255,255,255,0.55); transition: color 0.15s; }
    .footer__legal a:hover { color: white; }
    .footer__copy { font-size: 12px; margin-top: 16px; }
  `],
})
export class FooterComponent {
  readonly year = new Date().getFullYear();
}
