import { Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-google-callback',
  standalone: true,
  template: `<p>Logowanie...</p>`,
})
export class GoogleCallbackComponent implements OnInit {
  private readonly route  = inject(ActivatedRoute);
  private readonly auth   = inject(AuthService);
  private readonly router = inject(Router);

  ngOnInit() {
    const token = this.route.snapshot.queryParamMap.get('token');
    if (token) {
      this.auth.handleGoogleCallback(token);
      const returnTo = sessionStorage.getItem('auth_return_to') ?? '/';
      sessionStorage.removeItem('auth_return_to');
      this.router.navigateByUrl(returnTo);
    } else {
      this.router.navigate(['/auth/login']);
    }
  }
}
