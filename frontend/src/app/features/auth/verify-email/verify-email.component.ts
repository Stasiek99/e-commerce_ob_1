import { Component, inject, OnInit, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { TuiButton, TuiTitle } from '@taiga-ui/core';
import { TuiCard, TuiHeader } from '@taiga-ui/layout';
import { AuthService } from '../../../core/services/auth.service';

type State = 'pending' | 'success' | 'error';

@Component({
  selector: 'app-verify-email',
  standalone: true,
  imports: [RouterLink, TuiButton, TuiTitle, TuiCard, TuiHeader],
  template: `
    <div class="auth-page">
      <div tuiCardLarge appearance="elevated" class="auth-card">
        <header tuiHeader>
          <h1 tuiTitle>Weryfikacja email</h1>
        </header>

        @if (state === 'pending') {
          <p class="info-text">Trwa weryfikacja adresu email…</p>
        }
        @if (state === 'success') {
          <p class="info-text">
            Adres email został potwierdzony. Możesz teraz w pełni korzystać ze swojego konta.
          </p>
          <a tuiButton [routerLink]="['/account']" class="btn-full">Przejdź do konta</a>
        }
        @if (state === 'error') {
          <p class="info-text error-text">
            Link weryfikacyjny jest nieprawidłowy lub wygasł.
          </p>
          <a tuiButton appearance="secondary" [routerLink]="['/account']" class="btn-full">
            Wyślij nowy link z poziomu konta
          </a>
        }
      </div>
    </div>
  `,
  styles: [`
    .auth-page { display: flex; justify-content: center; padding: 32px 16px; }
    .auth-card { width: 100%; max-width: 420px; box-shadow: var(--shadow-sm) !important; }
    .btn-full { display: flex; width: 100%; justify-content: center; }
    .info-text { font-size: 14px; color: var(--color-secondary); margin: 0; line-height: 1.6; }
    .error-text { color: var(--tui-status-negative); }
  `],
})
export class VerifyEmailComponent implements OnInit {
  private readonly auth       = inject(AuthService);
  private readonly route      = inject(ActivatedRoute);
  private readonly platformId = inject(PLATFORM_ID);

  state: State = 'pending';

  ngOnInit() {
    // The token is single-use — only the real browser may consume it. Without
    // this guard, the SSR render already consumes it server-side, and hydration's
    // repeat call then hits the backend's used-token guard and overwrites the
    // genuine success with an error.
    if (!isPlatformBrowser(this.platformId)) return;

    const token = this.route.snapshot.queryParams['token'] as string | undefined;
    if (!token) { this.state = 'error'; return; }

    this.auth.verifyEmail(token).subscribe({
      next: () => {
        this.state = 'success';
        // Refresh the in-memory user so the dashboard banner disappears
        this.auth.loadCurrentUser();
      },
      error: () => { this.state = 'error'; },
    });
  }
}
