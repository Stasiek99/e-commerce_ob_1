import { Component, inject, OnInit } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TuiButton, TuiLabel, TuiTextfield, TuiTitle } from '@taiga-ui/core';
import { TuiCard, TuiForm, TuiHeader } from '@taiga-ui/layout';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { PASSWORD_RE } from '../../../shared/validators/form.validators';

// Backend's reset-token errors always say "token" (e.g. "Invalid or expired reset token");
// password-complexity 400s never do. Used to avoid showing the expired-link screen
// for a problem that's actually just an invalid password.
function isTokenError(message: unknown): boolean {
  return typeof message === 'string' && message.toLowerCase().includes('token');
}

@Component({
  selector: 'app-reset-password',
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
          <h1 tuiTitle>Nowe hasło</h1>
        </header>

        @if (!token) {
          <p class="info-text error-text">
            Link jest nieprawidłowy lub wygasł. Poproś o nowy link do resetowania hasła.
          </p>
          <a tuiButton appearance="secondary" [routerLink]="['/auth/forgot-password']" class="btn-full">
            Wyślij nowy link
          </a>
        } @else if (done) {
          <p class="info-text">
            Hasło zostało zmienione. Możesz się teraz zalogować.
          </p>
          <a tuiButton [routerLink]="['/auth/login']" class="btn-full">
            Zaloguj się
          </a>
        } @else {
          <tui-textfield>
            <label tuiLabel>Nowe hasło (min. 8 znaków, wielka i mała litera, cyfra)</label>
            <input tuiTextfield type="password" formControlName="password" autocomplete="new-password" />
          </tui-textfield>
          @if (passwordError(); as msg) {
            <p class="info-text error-text">{{ msg }}</p>
          }

          <tui-textfield>
            <label tuiLabel>Powtórz hasło</label>
            <input tuiTextfield type="password" formControlName="confirm" autocomplete="new-password" />
          </tui-textfield>

          @if (form.errors?.['mismatch'] && form.get('confirm')?.dirty) {
            <p class="info-text error-text">Hasła nie są identyczne.</p>
          }

          <button tuiButton type="submit" [disabled]="form.invalid || loading" class="btn-full">
            {{ loading ? 'Zapisywanie...' : 'Ustaw nowe hasło' }}
          </button>
        }
      </form>
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
export class ResetPasswordComponent implements OnInit {
  private readonly auth  = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb    = inject(FormBuilder);

  loading = false;
  done    = false;
  token   = '';

  form = this.fb.group(
    {
      password: ['', [Validators.required, Validators.minLength(8), Validators.pattern(PASSWORD_RE)]],
      confirm:  ['', Validators.required],
    },
    { validators: (g) => g.get('password')!.value === g.get('confirm')!.value ? null : { mismatch: true } },
  );

  ngOnInit() {
    this.token = this.route.snapshot.queryParams['token'] ?? '';
  }

  passwordError(): string | null {
    const ctrl = this.form.controls.password;
    if (!ctrl.dirty && !ctrl.touched) return null;
    if (ctrl.errors?.['minlength']) return 'Minimum 8 znaków';
    if (ctrl.errors?.['pattern']) return 'Hasło musi zawierać wielką literę, małą literę i cyfrę';
    return null;
  }

  submit(): void {
    if (this.form.invalid || !this.token) return;
    this.loading = true;
    this.auth.resetPassword(this.token, this.form.getRawValue().password!).subscribe({
      next: () => {
        this.done    = true;
        this.loading = false;
      },
      error: (err) => {
        this.toast.error(err.error?.message ?? 'Link wygasł lub jest nieprawidłowy.');
        this.loading = false;
        if (isTokenError(err.error?.message)) {
          this.token = '';
        }
      },
    });
  }
}
