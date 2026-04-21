import { Component, inject } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { TuiButton, TuiLabel, TuiTextfield, TuiTitle } from '@taiga-ui/core';
import { TuiCard, TuiForm, TuiHeader } from '@taiga-ui/layout';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';

@Component({
  selector: 'app-register',
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
          <h1 tuiTitle>Utwórz konto</h1>
        </header>

        <div class="name-row">
          <tui-textfield>
            <label tuiLabel>Imię</label>
            <input tuiTextfield type="text" formControlName="firstName" autocomplete="given-name" />
          </tui-textfield>
          <tui-textfield>
            <label tuiLabel>Nazwisko</label>
            <input tuiTextfield type="text" formControlName="lastName" autocomplete="family-name" />
          </tui-textfield>
        </div>

        <tui-textfield>
          <label tuiLabel>Email</label>
          <input tuiTextfield type="email" formControlName="email" autocomplete="email" />
        </tui-textfield>

        <tui-textfield>
          <label tuiLabel>Hasło (min. 8 znaków)</label>
          <input tuiTextfield type="password" formControlName="password" autocomplete="new-password" />
        </tui-textfield>

        <button tuiButton type="submit" [disabled]="form.invalid || loading" class="btn-full">
          {{ loading ? 'Tworzenie konta...' : 'Utwórz konto' }}
        </button>

        <p class="auth-link">
          Masz już konto? <a routerLink="/auth/login">Zaloguj się</a>
        </p>
      </form>
    </div>
  `,
  styles: [`
    .auth-page { display: flex; justify-content: center; padding: 32px 16px; }
    .auth-card { width: 100%; max-width: 440px; }
    .name-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .btn-full { display: flex; width: 100%; justify-content: center; }
    .auth-link { text-align: center; font-size: 14px; color: var(--color-secondary); margin: 0; }
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
    lastName:  [''],
    email:     ['', [Validators.required, Validators.email]],
    password:  ['', [Validators.required, Validators.minLength(8)]],
  });

  submit(): void {
    if (this.form.invalid) return;
    this.loading = true;
    const v = this.form.getRawValue();
    this.auth.register(v.email!, v.password!, v.firstName ?? undefined, v.lastName ?? undefined).subscribe({
      next: () => this.router.navigate(['/']),
      error: (err) => {
        this.toast.error(err.error?.message ?? 'Błąd rejestracji.');
        this.loading = false;
      },
    });
  }
}
