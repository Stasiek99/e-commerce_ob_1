import { Component, inject } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { CartService } from '../../../core/services/cart.service';
import { ToastService } from '../../../core/services/toast.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <div class="auth-page">
      <div class="auth-card">
        <h1>Zaloguj się</h1>

        <form [formGroup]="form" (ngSubmit)="submit()">
          <div class="field">
            <label for="email">Email</label>
            <input id="email" type="email" formControlName="email" autocomplete="email" />
          </div>
          <div class="field">
            <label for="password">Hasło</label>
            <input id="password" type="password" formControlName="password" autocomplete="current-password" />
          </div>
          <button type="submit" [disabled]="form.invalid || loading" class="btn-submit">
            {{ loading ? 'Logowanie...' : 'Zaloguj się' }}
          </button>
        </form>

        <div class="auth-divider"><span>lub</span></div>

        <button (click)="loginWithGoogle()" class="btn-google">
          Zaloguj przez Google
        </button>

        <p class="auth-link">
          Nie masz konta? <a routerLink="/auth/register">Zarejestruj się</a>
        </p>
      </div>
    </div>
  `,
  styles: [`
    .auth-page { display: flex; justify-content: center; padding: 64px 16px; }
    .auth-card { width: 100%; max-width: 400px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 40px; }
    h1 { font-size: 24px; font-weight: 700; margin: 0 0 32px; }
    .field { margin-bottom: 20px; }
    label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 6px; }
    input { width: 100%; border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 10px 12px; font-size: 14px; outline: none; transition: border-color 0.15s; }
    input:focus { border-color: var(--color-primary); }
    .btn-submit { width: 100%; background: var(--color-primary); color: white; border: none; padding: 12px; border-radius: var(--radius-md); font-size: 15px; font-weight: 600; cursor: pointer; transition: opacity 0.15s; }
    .btn-submit:hover:not(:disabled) { opacity: 0.85; }
    .btn-submit:disabled { opacity: 0.5; cursor: not-allowed; }
    .auth-divider { text-align: center; margin: 20px 0; font-size: 13px; color: var(--color-secondary); position: relative; }
    .auth-divider::before { content: ''; position: absolute; top: 50%; left: 0; right: 0; height: 1px; background: var(--color-border); }
    .auth-divider span { background: white; padding: 0 12px; position: relative; }
    .btn-google { width: 100%; background: none; border: 1px solid var(--color-border); padding: 12px; border-radius: var(--radius-md); font-size: 14px; cursor: pointer; transition: background 0.15s; }
    .btn-google:hover { background: #f5f5f5; }
    .auth-link { text-align: center; margin-top: 24px; font-size: 14px; color: var(--color-secondary); }
    .auth-link a { color: var(--color-primary); font-weight: 500; }
  `],
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly cart = inject(CartService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  loading = false;
  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  submit() {
    if (this.form.invalid) return;
    this.loading = true;
    const { email, password } = this.form.getRawValue();
    this.auth.login(email!, password!).subscribe({
      next: () => {
        this.cart.mergeWithServer('').subscribe();
        this.router.navigate(['/']);
      },
      error: () => {
        this.toast.error('Nieprawidłowy email lub hasło.');
        this.loading = false;
      },
    });
  }

  loginWithGoogle() {
    this.auth.loginWithGoogle();
  }
}
