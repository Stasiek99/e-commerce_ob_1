import { Component, inject } from "@angular/core";
import { ReactiveFormsModule, FormBuilder, Validators } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { TuiButton, TuiLabel, TuiTitle, TuiInput } from "@taiga-ui/core";
import { TuiCard, TuiForm, TuiHeader } from "@taiga-ui/layout";
import { AuthService } from "../../../core/services/auth.service";

@Component({
  selector: "app-magic-link",
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TuiButton,
    TuiLabel,
    TuiInput,
    TuiTitle,
    TuiCard,
    TuiForm,
    TuiHeader,
  ],
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
          <h1 tuiTitle>Logowanie linkiem</h1>
        </header>

        @if (sent) {
          <p class="info-text">
            Jeśli ten adres email jest zarejestrowany w naszym sklepie, wyślemy
            na niego link logowania. Sprawdź skrzynkę odbiorczą.
          </p>
          <a
            tuiButton
            appearance="secondary"
            [routerLink]="['/auth/login']"
            class="btn-full"
          >
            Wróć do logowania
          </a>
        } @else {
          <p class="info-text">
            Podaj adres email powiązany z Twoim kontem, a wyślemy Ci link,
            dzięki któremu zalogujesz się bez podawania hasła.
          </p>

          <tui-textfield>
            <label tuiLabel>Email</label>
            <input
              tuiInput
              type="email"
              formControlName="email"
              autocomplete="email"
            />
          </tui-textfield>

          <button
            tuiButton
            type="submit"
            [disabled]="form.invalid || loading"
            class="btn-full"
          >
            {{ loading ? "Wysyłanie..." : "Wyślij link logowania" }}
          </button>

          <p class="auth-link">
            <a [routerLink]="['/auth/login']">Wróć do logowania</a>
          </p>
        }
      </form>
    </div>
  `,
  styles: [
    `
      .auth-page {
        display: flex;
        justify-content: center;
        padding: 32px 16px;
      }
      .auth-card {
        width: 100%;
        max-width: 420px;
        box-shadow: var(--shadow-sm) !important;
      }
      .btn-full {
        display: flex;
        width: 100%;
        justify-content: center;
      }
      .info-text {
        font-size: 14px;
        color: var(--color-secondary);
        margin: 0;
        line-height: 1.6;
      }
      .auth-link {
        text-align: center;
        font-size: 14px;
        color: var(--color-secondary);
        margin: 0;
      }
      .auth-link a {
        color: var(--color-primary);
        font-weight: 500;
      }
    `,
  ],
})
export class MagicLinkComponent {
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);

  loading = false;
  sent = false;

  form = this.fb.group({
    email: ["", [Validators.required, Validators.email]],
  });

  submit(): void {
    if (this.form.invalid) return;
    this.loading = true;
    this.auth.requestMagicLink(this.form.getRawValue().email!).subscribe({
      next: () => {
        this.sent = true;
        this.loading = false;
      },
      error: () => {
        // Always show success — backend never reveals if email exists
        this.sent = true;
        this.loading = false;
      },
    });
  }
}
