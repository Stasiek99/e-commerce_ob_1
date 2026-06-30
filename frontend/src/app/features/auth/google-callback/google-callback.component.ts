import { Component, OnInit, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { CartService } from '../../../core/services/cart.service';

@Component({
  selector: 'app-google-callback',
  standalone: true,
  template: `<p>Logowanie...</p>`,
})
export class GoogleCallbackComponent implements OnInit {
  private readonly auth       = inject(AuthService);
  private readonly cart       = inject(CartService);
  private readonly router     = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  ngOnInit() {
    if (!isPlatformBrowser(this.platformId)) return;

    this.auth.exchangeOAuthToken().subscribe({
      next: () => {
        const raw = sessionStorage.getItem('auth_return_to') ?? '/';
        sessionStorage.removeItem('auth_return_to');
        const returnTo = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
        this.cart.mergeWithServer().subscribe({ next: () => this.cart.loadCart(), error: () => {} });
        this.router.navigateByUrl(returnTo);
      },
      error: () => {
        this.router.navigate(['/auth/login']);
      },
    });
  }
}
