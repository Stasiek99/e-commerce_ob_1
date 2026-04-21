import { Component, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { TuiButton, TuiLabel, TuiTextfield, TuiTitle } from '@taiga-ui/core';
import { TuiCard, TuiForm, TuiHeader } from '@taiga-ui/layout';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [ReactiveFormsModule, TuiButton, TuiLabel, TuiTextfield, TuiTitle, TuiCard, TuiForm, TuiHeader],
  template: `
    <div class="page">
      <h1>Mój profil</h1>

      <!-- ── View mode ─────────────────────────────────── -->
      @if (!editing()) {
        <div tuiCardLarge appearance="elevated" class="profile-card">
          <header tuiHeader>
            <h2 tuiTitle>Dane konta</h2>
            <button tuiButton appearance="secondary" size="s" type="button" (click)="startEdit()">
              Edytuj
            </button>
          </header>

          <div class="info-row">
            <span class="info-label">Email</span>
            <span class="info-value">{{ auth.currentUser()?.email ?? '—' }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Imię</span>
            <span class="info-value">{{ auth.currentUser()?.firstName || '—' }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Nazwisko</span>
            <span class="info-value">{{ auth.currentUser()?.lastName || '—' }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">Telefon</span>
            <span class="info-value">{{ auth.currentUser()?.phone || '—' }}</span>
          </div>
        </div>
      }

      <!-- ── Edit mode ──────────────────────────────────── -->
      @if (editing()) {
        <form tuiCardLarge tuiForm appearance="elevated" [formGroup]="form" (ngSubmit)="save()">
          <div class="info-row info-row--top">
            <span class="info-label">Email</span>
            <span class="info-value info-value--muted">{{ auth.currentUser()?.email ?? '—' }}</span>
          </div>

          <div class="name-row">
            <tui-textfield>
              <label tuiLabel>Imię</label>
              <input tuiTextfield type="text" formControlName="firstName" />
            </tui-textfield>
            <tui-textfield>
              <label tuiLabel>Nazwisko</label>
              <input tuiTextfield type="text" formControlName="lastName" />
            </tui-textfield>
          </div>

          <tui-textfield>
            <label tuiLabel>Telefon</label>
            <input tuiTextfield type="tel" formControlName="phone" />
          </tui-textfield>

          <div class="form-actions">
            <button tuiButton appearance="secondary" size="s" type="button" [disabled]="saving()" (click)="cancelEdit()">
              Anuluj
            </button>
            <button tuiButton size="s" type="submit" [disabled]="saving() || form.invalid">
              {{ saving() ? 'Zapisywanie…' : 'Zapisz zmiany' }}
            </button>
          </div>
        </form>
      }
    </div>
  `,
  styles: [`
    .page { padding: 32px 0; max-width: 520px; margin: 0 auto; }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 24px; }

    .profile-card { display: block; }

    .info-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 0;
      border-bottom: 1px solid var(--color-border);
      font-size: 14px;
    }
    .info-row:last-of-type { border-bottom: none; }
    .info-row--top { margin-bottom: 4px; }
    .info-label { font-weight: 500; color: var(--color-secondary); }
    .info-value { color: var(--color-primary); }
    .info-value--muted { color: var(--color-secondary); }

    .name-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

    .form-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 8px; }
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
    lastName:  [this.auth.currentUser()?.lastName  ?? '', Validators.maxLength(50)],
    phone:     [this.auth.currentUser()?.phone     ?? '', Validators.maxLength(20)],
  });

  startEdit(): void {
    const u = this.auth.currentUser();
    this.form.setValue({ firstName: u?.firstName ?? '', lastName: u?.lastName ?? '', phone: u?.phone ?? '' });
    this.editing.set(true);
  }

  cancelEdit(): void {
    this.editing.set(false);
    this.form.markAsPristine();
  }

  save(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    this.http.patch<any>(`${environment.apiUrl}/users/me`, this.form.getRawValue()).subscribe({
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
