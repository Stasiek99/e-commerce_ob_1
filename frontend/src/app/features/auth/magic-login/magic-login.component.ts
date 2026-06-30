import { Component, OnInit, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { CartService } from '../../../core/services/cart.service';
import { ToastService } from '../../../core/services/toast.service';

@Component({
  selector: 'app-magic-login',
  standalone: true,
  template: `<div class="auth-page"><p class="info-text">Logowanie...</p></div>`,
  styles: [`
    .auth-page { display: flex; justify-content: center; padding: 32px 16px; }
    .info-text { font-size: 14px; color: var(--color-secondary); margin: 0; line-height: 1.6; }
  `],
})
export class MagicLoginComponent implements OnInit {
  private readonly auth       = inject(AuthService);
  private readonly cart       = inject(CartService);
  private readonly toast      = inject(ToastService);
  private readonly router     = inject(Router);
  private readonly route      = inject(ActivatedRoute);
  private readonly platformId = inject(PLATFORM_ID);

  ngOnInit() {
    // The token is single-use — only the real browser may consume it. Without
    // this guard, the SSR render already consumes it server-side, and hydration's
    // repeat call then hits the backend's used-token guard and overwrites the
    // genuine success with an error.
    if (!isPlatformBrowser(this.platformId)) return;

    const token = this.route.snapshot.queryParams['token'] as string | undefined;
    if (!token) {
      this.router.navigate(['/auth/login']);
      return;
    }

    this.auth.verifyMagicLink(token).subscribe({
      next: () => {
        this.cart.mergeWithServer().subscribe();
        this.router.navigateByUrl('/');
      },
      error: () => {
        this.toast.error('Link logowania jest nieprawidłowy lub wygasł.');
        this.router.navigate(['/auth/login']);
      },
    });
  }
}
