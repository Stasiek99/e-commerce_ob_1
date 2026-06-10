import { Component, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Location } from '@angular/common';
import { Router } from '@angular/router';
import { TuiButton, TuiLabel, TuiTextfield, TuiTitle, TuiIcon } from '@taiga-ui/core';
import { TuiCard, TuiForm, TuiHeader } from '@taiga-ui/layout';
import { TuiInputPhoneInternational } from '@taiga-ui/experimental';
import { tuiInputPhoneInternationalOptionsProvider } from '@taiga-ui/kit';
import { type TuiCountryIsoCode } from '@taiga-ui/i18n/types';
import { getCountries } from 'libphonenumber-js/min';
import { parsePhoneNumber } from 'libphonenumber-js';
import { nameValidator, phoneValidator } from '../../../shared/validators/form.validators';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { environment } from '../../../../environments/environment';

function formatPhone(raw: string): string {
  if (!raw) return '—';
  try {
    return parsePhoneNumber(raw)?.formatInternational() ?? raw;
  } catch {
    return raw;
  }
}

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TuiButton, TuiLabel, TuiTextfield, TuiTitle, TuiIcon,
    TuiCard, TuiForm, TuiHeader,
    TuiInputPhoneInternational,
  ],
  providers: [
    tuiInputPhoneInternationalOptionsProvider({
      metadata: import('libphonenumber-js/min/metadata').then((m) => m.default),
    }),
  ],
  template: `
    <div class="page">
      <button tuiButton appearance="flat" size="s" type="button" class="back-btn" (click)="back()">
        <tui-icon icon="@tui.chevron-left" />
        Wróć
      </button>
      <h1>Mój profil</h1>

      <!-- ── View mode ─────────────────────────────────── -->
      @if (!editing()) {
        <div tuiCardLarge class="profile-card">
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
            <span class="info-value">{{ formatPhone(auth.currentUser()?.phone ?? '') }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">NIP (firma)</span>
            <span class="info-value">{{ auth.currentUser()?.nip || '—' }}</span>
          </div>
        </div>
      }

      <!-- ── Edit mode ──────────────────────────────────── -->
      @if (editing()) {
        <form tuiCardLarge tuiForm class="profile-edit-card" [formGroup]="form" (ngSubmit)="save()">
          <div class="info-row info-row--top">
            <span class="info-label">Email</span>
            <span class="info-value info-value--muted">{{ auth.currentUser()?.email ?? '—' }}</span>
          </div>

          <div class="name-row">
            <div class="name-col">
              <tui-textfield>
                <label tuiLabel>Imię</label>
                <input tuiTextfield type="text" formControlName="firstName" autocomplete="given-name" />
              </tui-textfield>
              @if (nameError('firstName'); as msg) {
                <p class="field-error" role="alert">{{ msg }}</p>
              }
            </div>
            <div class="name-col">
              <tui-textfield>
                <label tuiLabel>Nazwisko</label>
                <input tuiTextfield type="text" formControlName="lastName" autocomplete="family-name" />
              </tui-textfield>
              @if (nameError('lastName'); as msg) {
                <p class="field-error" role="alert">{{ msg }}</p>
              }
            </div>
          </div>

          <tui-textfield>
            <label tuiLabel>Telefon</label>
            <input
              tuiInputPhoneInternational
              formControlName="phone"
              [countries]="countries"
              [countryIsoCode]="countryIsoCode"
              [countrySearch]="true"
              (countryIsoCodeChange)="countryIsoCode = $event"
            />
          </tui-textfield>

          @if (form.controls.phone.errors?.['invalidPhone'] && (form.controls.phone.dirty || form.controls.phone.touched)) {
            <p class="field-error" role="alert">Wprowadź poprawny numer telefonu</p>
          }

          <tui-textfield>
            <label tuiLabel>NIP (opcjonalnie, dla faktur firmowych)</label>
            <input tuiTextfield type="text" formControlName="nip" autocomplete="off" placeholder="10 cyfr" />
          </tui-textfield>
          @if (form.controls.nip.errors?.['pattern'] && (form.controls.nip.dirty || form.controls.nip.touched)) {
            <p class="field-error" role="alert">NIP musi zawierać dokładnie 10 cyfr</p>
          }

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

      <!-- ── Danger zone ─────────────────────────────────── -->
      <div class="danger-zone">
        <h3 class="danger-title">Strefa niebezpieczna</h3>

        @if (!confirmingDelete()) {
          <div class="danger-card">
            <div class="danger-info">
              <strong>Usuń konto</strong>
              <p>Trwale usuwa Twoje konto, dane osobowe i historię zakupów. Tej operacji nie można cofnąć.</p>
            </div>
            <button
              tuiButton
              appearance="secondary"
              size="s"
              type="button"
              class="btn-danger"
              (click)="startDeleteConfirm()"
            >
              Usuń konto
            </button>
          </div>
        } @else {
          <div class="danger-card danger-card--warning">
            <p class="danger-warning">
              <tui-icon icon="@tui.triangle-alert" class="danger-icon" />
              <strong>Czy na pewno chcesz usunąć konto?</strong><br>
              Wszystkie Twoje dane zostaną trwale usunięte. Zamówienia zostaną zanonimizowane zgodnie z RODO.
            </p>
            <div class="danger-actions">
              <button
                tuiButton
                appearance="secondary"
                size="s"
                type="button"
                [disabled]="deleting()"
                (click)="cancelDeleteConfirm()"
              >
                Anuluj
              </button>
              <button
                tuiButton
                appearance="secondary"
                size="s"
                type="button"
                class="btn-danger"
                [disabled]="deleting()"
                (click)="deleteAccount()"
              >
                {{ deleting() ? 'Usuwanie…' : 'Tak, usuń konto' }}
              </button>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .page { padding: 32px 0; max-width: 520px; margin: 0 auto; }
    .back-btn { margin-bottom: 8px; }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 24px; }

    .profile-card { display: block; border: 1px solid var(--color-border) !important; }
    .profile-edit-card { border: 1px solid var(--color-border) !important; }

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
    .name-col { display: flex; flex-direction: column; }

    .field-error { font-size: 12px; color: var(--tui-status-negative); margin-top: 4px; }

    .form-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 8px; }

    .danger-zone { margin-top: 40px; }
    .danger-title { font-size: 14px; font-weight: 600; color: var(--tui-status-negative); margin-bottom: 12px; }
    .danger-card {
      border: 1px solid var(--tui-status-negative);
      border-radius: 8px;
      padding: 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .danger-card--warning { flex-direction: column; align-items: flex-start; }
    .danger-info strong { font-size: 14px; display: block; margin-bottom: 4px; }
    .danger-info p { font-size: 13px; color: var(--color-secondary); margin: 0; }
    .danger-warning { font-size: 13px; line-height: 1.6; margin: 0 0 16px; display: flex; gap: 8px; align-items: flex-start; }
    .danger-icon { color: var(--tui-status-negative); flex-shrink: 0; margin-top: 2px; }
    .danger-actions { display: flex; gap: 12px; }
    .btn-danger { color: var(--tui-status-negative) !important; border-color: var(--tui-status-negative) !important; }
  `],
})
export class ProfileComponent {
  readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  readonly editing = signal(false);
  readonly saving = signal(false);
  readonly confirmingDelete = signal(false);
  readonly deleting = signal(false);

  readonly countries: readonly TuiCountryIsoCode[] = [
    'PL',
    ...getCountries().filter((c) => c !== 'PL'),
  ];
  countryIsoCode: TuiCountryIsoCode = 'PL';

  readonly formatPhone = formatPhone;

  readonly form = this.fb.group({
    firstName: [this.auth.currentUser()?.firstName ?? '', [Validators.maxLength(50), nameValidator]],
    lastName:  [this.auth.currentUser()?.lastName  ?? '', [Validators.maxLength(50), nameValidator]],
    phone:     [this.auth.currentUser()?.phone     ?? '', [phoneValidator]],
    nip:       [this.auth.currentUser()?.nip       ?? '', [Validators.pattern(/^\d{10}$/)]],
  });

  back(): void { this.location.back(); }

  startEdit(): void {
    const u = this.auth.currentUser();
    this.form.setValue({ firstName: u?.firstName ?? '', lastName: u?.lastName ?? '', phone: u?.phone ?? '', nip: u?.nip ?? '' });
    this.editing.set(true);
  }

  cancelEdit(): void {
    this.editing.set(false);
    this.form.markAsPristine();
  }

  nameError(field: 'firstName' | 'lastName'): string | null {
    const ctrl = this.form.controls[field];
    if (!ctrl.dirty && !ctrl.touched) return null;
    if (ctrl.errors?.['nameTooShort']) return 'Minimum 2 znaki';
    if (ctrl.errors?.['nameInvalid']) return 'Tylko litery, myślniki i apostrofy';
    if (ctrl.errors?.['maxlength']) return 'Maksymalnie 50 znaków';
    return null;
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

  startDeleteConfirm(): void {
    this.confirmingDelete.set(true);
  }

  cancelDeleteConfirm(): void {
    this.confirmingDelete.set(false);
  }

  deleteAccount(): void {
    this.deleting.set(true);
    this.http.delete(`${environment.apiUrl}/users/me`).subscribe({
      next: () => {
        this.auth.clearSession();
        this.router.navigate(['/']);
        this.toast.success('Konto zostało usunięte');
      },
      error: () => {
        this.toast.error('Błąd usuwania konta. Spróbuj ponownie.');
        this.deleting.set(false);
      },
    });
  }
}
