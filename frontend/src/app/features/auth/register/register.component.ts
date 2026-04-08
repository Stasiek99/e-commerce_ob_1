import { Component, inject } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <div class="auth-page">
      <div class="auth-card">
        <h1>Utwórz konto</h1>
        <form [formGroup]="form" (ngSubmit)="submit()">
          <div class="row">
            <div class="field">
              <label>Imię</label>
              <input type="text" formControlName="firstName" autocomplete="given-name" />
            </div>
            <div class="field">
              <label>Nazwisko</label>
              <input type="text" formControlName="lastName" autocomplete="family-name" />
            </div>
          </div>
          <div class="field">
            <label>Email</label>
            <input type="email" formControlName="email" autocomplete="email" />
          </div>
          <div class="field">
            <label>Hasło (min. 8 znaków)</label>
            <input type="password" formControlName="password" autocomplete="new-password" />
          </div>
          <button type="submit" [disabled]="form.invalid || loading" class="btn-submit">
            {{ loading ? 'Tworzenie konta...' : 'Utwórz konto' }}
          </button>
        </form>
        <p class="auth-link">Masz już konto? <a routerLink="/auth/login">Zaloguj się</a></p>
      </div>
    </div>
  `,
  styles: [`
    .auth-page { display: flex; justify-content: center; padding: 64px 16px; }
    .auth-card { width: 100%; max-width: 440px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 40px; }
    h1 { font-size: 24px; font-weight: 700; margin: 0 0 32px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .field { margin-bottom: 20px; }
    label { display: block; font-size: 14px; font-weight: 500; margin-bottom: 6px; }
    input { width: 100%; border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 10px 12px; font-size: 14px; outline: none; }
    input:focus { border-color: var(--color-primary); }
    .btn-submit { width: 100%; background: var(--color-primary); color: white; border: none; padding: 12px; border-radius: var(--radius-md); font-size: 15px; font-weight: 600; cursor: pointer; }
    .btn-submit:disabled { opacity: 0.5; cursor: not-allowed; }
    .auth-link { text-align: center; margin-top: 24px; font-size: 14px; color: var(--color-secondary); }
    .auth-link a { color: var(--color-primary); font-weight: 500; }
  `],
})
export class RegisterComponent {
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  loading = false;
  form = this.fb.group({
    firstName: [''],
    lastName: [''],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  submit() {
    if (this.form.invalid) return;
    this.loading = true;
    const v = this.form.getRawValue();
    this.auth
      .register(v.email!, v.password!, v.firstName ?? undefined, v.lastName ?? undefined)
      .subscribe({
        next: () => this.router.navigate(['/']),
        error: (err) => {
          this.toast.error(err.error?.message ?? 'Błąd rejestracji.');
          this.loading = false;
        },
      });
  }
}
