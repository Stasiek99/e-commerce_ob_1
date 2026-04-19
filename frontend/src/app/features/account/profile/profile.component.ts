import { Component, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <div class="page">
      <h1>Mój profil</h1>

      <form [formGroup]="form" (ngSubmit)="save()" class="card">
        <div class="field">
          <label>Email</label>
          <input [value]="auth.currentUser()?.email ?? ''" disabled class="input input--disabled" />
        </div>
        <div class="row">
          <div class="field">
            <label>Imię</label>
            <input formControlName="firstName" class="input" />
          </div>
          <div class="field">
            <label>Nazwisko</label>
            <input formControlName="lastName" class="input" />
          </div>
        </div>
        <div class="field">
          <label>Telefon</label>
          <input formControlName="phone" type="tel" class="input" />
        </div>
        <button type="submit" [disabled]="saving() || form.invalid" class="btn">
          {{ saving() ? 'Zapisywanie…' : 'Zapisz zmiany' }}
        </button>
      </form>
    </div>
  `,
  styles: [`
    .page { padding: 32px 0; max-width: 480px; }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 24px; }
    .card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 28px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .field { margin-bottom: 16px; }
    label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 5px; }
    .input { width: 100%; border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 10px 12px; font-size: 14px; outline: none; box-sizing: border-box; }
    .input:focus { border-color: var(--color-primary); }
    .input--disabled { background: #f5f5f5; color: var(--color-secondary); cursor: not-allowed; }
    .btn { background: var(--color-primary); color: white; border: none; padding: 11px 24px; border-radius: var(--radius-md); font-size: 14px; font-weight: 600; cursor: pointer; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  `],
})
export class ProfileComponent {
  readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  readonly saving = signal(false);

  readonly form = this.fb.group({
    firstName: [this.auth.currentUser()?.firstName ?? '', Validators.maxLength(50)],
    lastName: [this.auth.currentUser()?.lastName ?? '', Validators.maxLength(50)],
    phone: [this.auth.currentUser()?.phone ?? '', Validators.maxLength(20)],
  });

  save() {
    if (this.form.invalid) return;
    this.saving.set(true);

    this.http
      .patch<any>(`${environment.apiUrl}/users/me`, this.form.getRawValue())
      .subscribe({
        next: (user) => {
          this.auth.updateCurrentUser(user);
          this.toast.success('Profil zaktualizowany');
          this.saving.set(false);
        },
        error: () => {
          this.toast.error('Błąd zapisu profilu');
          this.saving.set(false);
        },
      });
  }
}
