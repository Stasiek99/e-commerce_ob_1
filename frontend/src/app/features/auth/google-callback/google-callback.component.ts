import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-google-callback',
  standalone: true,
  template: `<p>Logowanie...</p>`,
})
export class GoogleCallbackComponent implements OnInit {
  private readonly auth   = inject(AuthService);
  private readonly router = inject(Router);

  ngOnInit() {
    this.auth.exchangeOAuthToken().subscribe({
      next: () => {
        const returnTo = sessionStorage.getItem('auth_return_to') ?? '/';
        sessionStorage.removeItem('auth_return_to');
        this.router.navigateByUrl(returnTo);
      },
      error: () => {
        this.router.navigate(['/auth/login']);
      },
    });
  }
}
