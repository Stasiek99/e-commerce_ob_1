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
      <div class="header">
        <h1>Mój profil</h1>
        @if (!editing()) {
          <button class="btn btn--outline" (click)="startEdit()">Edytuj</button>
        }
      </div>

      <div class="card">
        <div class="field">
          <label>Email</label>
          @if (editing()) {
            <input [value]="auth.currentUser()?.email ?? ''" disabled class="input input--disabled" />
          } @else {
            <p class="value">{{ auth.currentUser()?.email ?? '—' }}</p>
          }
        </div>

        <div class="row">
          <div class="field">
            <label>Imię</label>
            @if (editing()) {
              <input formControlName="firstName" [formControl]="form.controls.firstName" class="input" />
            } @else {
              <p class="value">{{ auth.currentUser()?.firstName || '—' }}</p>
            }
          </div>
          <div class="field">
            <label>Nazwisko</label>
            @if (editing()) {
              <input formControlName="lastName" [formControl]="form.controls.lastName" class="input" />
            } @else {
              <p class="value">{{ auth.currentUser()?.lastName || '—' }}</p>
            }
          </div>
        </div>

        <div class="field">
          <label>Telefon</label>
          @if (editing()) {
            <input formControlName="phone" [formControl]="form.controls.phone" type="tel" class="input" />
          } @else {
            <p class="value">{{ auth.currentUser()?.phone || '—' }}</p>
          }
        </div>

        @if (editing()) {
          <div class="actions">
            <button class="btn btn--outline" type="button" (click)="cancelEdit()" [disabled]="saving()">Anuluj</button>
            <button class="btn" type="button" (click)="save()" [disabled]="saving() || form.invalid">
              {{ saving() ? 'Zapisywanie…' : 'Zapisz zmiany' }}
            </button>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .page { padding: 32px 0; max-width: 480px; }
    .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
    h1 { font-size: 24px; font-weight: 700; }
    .card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 28px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .field { margin-bottom: 16px; }
    label { display: block; font-size: 13px; font-weight: 500; color: var(--color-secondary); margin-bottom: 5px; }
    .value { font-size: 15px; color: var(--color-secondary); padding: 2px 0; }
    .input { width: 100%; border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 10px 12px; font-size: 14px; outline: none; box-sizing: border-box; }
    .input:focus { border-color: var(--color-primary); }
    .input--disabled { background: #f5f5f5; color: var(--color-secondary); cursor: not-allowed; }
    .actions { display: flex; gap: 12px; margin-top: 8px; }
    .btn { background: var(--color-primary); color: white; border: none; padding: 11px 24px; border-radius: var(--radius-md); font-size: 14px; font-weight: 600; cursor: pointer; }
    .btn--outline { background: transparent; color: var(--color-primary); border: 1px solid var(--color-primary); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  `],
})
export class ProfileComponent {
  readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  readonly editing = signal(false);
  readonly saving = signal(false);

  readonly form = this.fb.group({
    firstName: [this.auth.currentUser()?.firstName ?? '', Validators.maxLength(50)],
    lastName: [this.auth.currentUser()?.lastName ?? '', Validators.maxLength(50)],
    phone: [this.auth.currentUser()?.phone ?? '', Validators.maxLength(20)],
  });

  startEdit() {
    const user = this.auth.currentUser();
    this.form.setValue({
      firstName: user?.firstName ?? '',
      lastName: user?.lastName ?? '',
      phone: user?.phone ?? '',
    });
    this.editing.set(true);
  }

  cancelEdit() {
    this.editing.set(false);
    this.form.markAsPristine();
  }

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
          this.editing.set(false);
        },
        error: () => {
          this.toast.error('Błąd zapisu profilu');
          this.saving.set(false);
        },
      });
  }
}
