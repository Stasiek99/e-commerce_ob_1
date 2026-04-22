import { Component, inject } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TuiButton, TuiLabel, TuiTextfield, TuiTitle } from '@taiga-ui/core';
import { TuiCard, TuiForm, TuiHeader } from '@taiga-ui/layout';
import { AuthService } from '../../../core/services/auth.service';
import { CartService } from '../../../core/services/cart.service';
import { ToastService } from '../../../core/services/toast.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, TuiButton, TuiLabel, TuiTextfield, TuiTitle, TuiCard, TuiForm, TuiHeader],
  template: `
    <div class="auth-page">
      <form
        tuiCardLarge
        tuiForm
        appearance="elevated"
        class="auth-card"
        [formGroup]="form"
        (ngSubmit)="submit()"
      >
        <header tuiHeader>
          <h1 tuiTitle>Zaloguj się</h1>
        </header>

        <tui-textfield>
          <label tuiLabel>Email</label>
          <input tuiTextfield type="email" formControlName="email" autocomplete="email" />
        </tui-textfield>

        <tui-textfield>
          <label tuiLabel>Hasło</label>
          <input tuiTextfield type="password" formControlName="password" autocomplete="current-password" />
        </tui-textfield>

        <button tuiButton type="submit" [disabled]="form.invalid || loading" class="btn-full">
          {{ loading ? 'Logowanie...' : 'Zaloguj się' }}
        </button>

        <div class="auth-divider"><span>lub</span></div>

        <button tuiButton appearance="secondary" type="button" (click)="loginWithGoogle()" class="btn-full">
          Zaloguj przez Google
        </button>

        <p class="auth-link">
          Nie masz konta? <a routerLink="/auth/register">Zarejestruj się</a>
        </p>
      </form>
    </div>
  `,
  styles: [`
    .auth-page { display: flex; justify-content: center; padding: 32px 16px; }
    .auth-card { width: 100%; max-width: 420px; }
    .btn-full { display: flex; width: 100%; justify-content: center; }
    .auth-divider {
      text-align: center;
      font-size: 13px;
      color: var(--color-secondary);
      position: relative;
    }
    .auth-divider::before {
      content: '';
      position: absolute;
      top: 50%;
      left: 0;
      right: 0;
      height: 1px;
      background: var(--color-border);
    }
    .auth-divider span { background: white; padding: 0 12px; position: relative; }
    .auth-link { text-align: center; font-size: 14px; color: var(--color-secondary); margin: 0; }
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
    email:    ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  submit(): void {
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

  loginWithGoogle(): void {
    this.auth.loginWithGoogle();
  }
}
