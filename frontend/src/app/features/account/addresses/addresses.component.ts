import {
  Component, DestroyRef, OnInit, WritableSignal, inject, signal,
} from '@angular/core';
import { AbstractControl, FormGroup, ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Location } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, distinctUntilChanged, filter, finalize, map, merge, of, switchMap, tap } from 'rxjs';
import { TuiButton, TuiLabel, TuiTextfield, TuiIcon } from '@taiga-ui/core';
import { TuiCard, TuiForm } from '@taiga-ui/layout';
import { TuiChip, TuiInputPhoneInternational, tuiInputPhoneInternationalOptionsProvider } from '@taiga-ui/kit';
import { type TuiCountryIsoCode } from '@taiga-ui/i18n/types';
import { getCountries } from 'libphonenumber-js/min';
import { parsePhoneNumber } from 'libphonenumber-js';
import { nameValidator, phoneValidator, streetValidator } from '../../../shared/validators/form.validators';
import { ToastService } from '../../../core/services/toast.service';
import { environment } from '../../../../environments/environment';

interface Address {
  id: string;
  firstName: string;
  lastName: string;
  company?: string;
  street: string;
  postalCode: string;
  city: string;
  phone: string;
  isDefault: boolean;
}


@Component({
  selector: 'app-addresses',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TuiButton, TuiChip, TuiLabel, TuiTextfield, TuiIcon, TuiCard, TuiForm,
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
      <div class="page-header">
        <h1>Adresy dostawy</h1>
        @if (!showAddForm()) {
          <button tuiButton appearance="accent" size="s" type="button" (click)="openAddForm()">
            + Dodaj adres
          </button>
        }
      </div>

      <!-- ── Add form ──────────────────────────────────── -->
      @if (showAddForm()) {
        <form tuiCardLarge tuiForm appearance="elevated" data-size="l" data-space="normal"
              class="addr-form" [formGroup]="addForm" (ngSubmit)="submitAdd()">

          <div class="name-row">
            <div class="name-col">
              <tui-textfield>
                <label tuiLabel>Imię *</label>
                <input tuiTextfield type="text" formControlName="firstName" autocomplete="given-name" />
              </tui-textfield>
              @if (fieldError(addForm.controls.firstName); as msg) {
                <p class="field-error" role="alert">{{ msg }}</p>
              }
            </div>
            <div class="name-col">
              <tui-textfield>
                <label tuiLabel>Nazwisko *</label>
                <input tuiTextfield type="text" formControlName="lastName" autocomplete="family-name" />
              </tui-textfield>
              @if (fieldError(addForm.controls.lastName); as msg) {
                <p class="field-error" role="alert">{{ msg }}</p>
              }
            </div>
          </div>

          <tui-textfield>
            <label tuiLabel>Firma</label>
            <input tuiTextfield type="text" formControlName="company" autocomplete="organization" />
          </tui-textfield>

          <div>
            <tui-textfield>
              <label tuiLabel>Ulica i numer budynku *</label>
              <input tuiTextfield type="text" formControlName="street" autocomplete="street-address"
                placeholder="np. ul. Marszałkowska 12/4" />
            </tui-textfield>
            @if (fieldError(addForm.controls.street); as msg) {
              <p class="field-error" role="alert">{{ msg }}</p>
            }
            @if (!addForm.controls.street.errors) {
              @switch (addStreetStatus()) {
                @case ('checking') { <p class="street-hint street-hint--checking">Weryfikuję adres…</p> }
                @case ('found')    { <p class="street-hint street-hint--found">✓ Adres potwierdzony</p> }
                @case ('not-found') { <p class="street-hint street-hint--warning">⚠ Nie znaleziono adresu — sprawdź poprawność danych</p> }
              }
            }
          </div>

          <div class="name-row">
            <div>
              <tui-textfield>
                <label tuiLabel>Kod pocztowy *</label>
                <input tuiTextfield type="text" formControlName="postalCode" placeholder="00-000"
                  autocomplete="postal-code" />
              </tui-textfield>
              @if (fieldError(addForm.controls.postalCode); as msg) {
                <p class="field-error" role="alert">{{ msg }}</p>
              }
            </div>
            <div class="name-col">
              <tui-textfield>
                <label tuiLabel>Miasto *</label>
                <input tuiTextfield type="text" formControlName="city" autocomplete="address-level2" />
              </tui-textfield>
              @if (addCityLoading()) {
                <p class="city-hint">Szukam miejscowości…</p>
              }
              @if (addCities.length > 1) {
                <div class="city-suggestions">
                  @for (city of addCities; track city) {
                    <button type="button" tuiChip size="s" (click)="selectAddCity(city)">{{ city }}</button>
                  }
                </div>
              }
              @if (fieldError(addForm.controls.city); as msg) {
                <p class="field-error" role="alert">{{ msg }}</p>
              }
            </div>
          </div>

          <!-- Country — disabled; selectable in a future release -->
          <tui-textfield class="field-disabled">
            <label tuiLabel>Kraj</label>
            <input tuiTextfield value="Polska" [attr.disabled]="true" tabindex="-1" />
          </tui-textfield>

          <div>
            <tui-input-phone-international
              formControlName="phone"
              [countries]="countries"
              [countryIsoCode]="addIsoCode"
              [countrySearch]="true"
              (countryIsoCodeChange)="addIsoCode = $event"
            >
              Telefon *
            </tui-input-phone-international>
            @if (fieldError(addForm.controls.phone); as msg) {
              <p class="field-error" role="alert">{{ msg }}</p>
            }
          </div>

          <div class="form-actions">
            <button tuiButton appearance="secondary" size="s" type="button" [disabled]="adding()" (click)="cancelAdd()">
              Anuluj
            </button>
            <button tuiButton size="s" type="submit" [disabled]="addForm.invalid || adding()">
              {{ adding() ? 'Zapisywanie…' : 'Zapisz adres' }}
            </button>
          </div>
        </form>
      }

      <!-- ── Address cards ─────────────────────────────── -->
      @for (addr of addressList; track addr.id) {
        @if (editingId() === addr.id) {
          <form tuiCardLarge tuiForm appearance="elevated" data-size="l" data-space="normal"
                class="addr-form" [formGroup]="editForm" (ngSubmit)="submitEdit(addr.id)">

            <div class="name-row">
              <div class="name-col">
                <tui-textfield>
                  <label tuiLabel>Imię *</label>
                  <input tuiTextfield type="text" formControlName="firstName" autocomplete="given-name" />
                </tui-textfield>
                @if (fieldError(editForm.controls.firstName); as msg) {
                  <p class="field-error" role="alert">{{ msg }}</p>
                }
              </div>
              <div class="name-col">
                <tui-textfield>
                  <label tuiLabel>Nazwisko *</label>
                  <input tuiTextfield type="text" formControlName="lastName" autocomplete="family-name" />
                </tui-textfield>
                @if (fieldError(editForm.controls.lastName); as msg) {
                  <p class="field-error" role="alert">{{ msg }}</p>
                }
              </div>
            </div>

            <tui-textfield>
              <label tuiLabel>Firma</label>
              <input tuiTextfield type="text" formControlName="company" autocomplete="organization" />
            </tui-textfield>

            <div>
              <tui-textfield>
                <label tuiLabel>Ulica i numer budynku *</label>
                <input tuiTextfield type="text" formControlName="street" autocomplete="street-address"
                  placeholder="np. ul. Marszałkowska 12/4" />
              </tui-textfield>
              @if (fieldError(editForm.controls.street); as msg) {
                <p class="field-error" role="alert">{{ msg }}</p>
              }
            </div>

            <div class="name-row">
              <div>
                <tui-textfield>
                  <label tuiLabel>Kod pocztowy *</label>
                  <input tuiTextfield type="text" formControlName="postalCode" placeholder="00-000"
                    autocomplete="postal-code" />
                </tui-textfield>
                @if (fieldError(editForm.controls.postalCode); as msg) {
                  <p class="field-error" role="alert">{{ msg }}</p>
                }
              </div>
              <div class="name-col">
                <tui-textfield>
                  <label tuiLabel>Miasto *</label>
                  <input tuiTextfield type="text" formControlName="city" autocomplete="address-level2" />
                </tui-textfield>
                @if (editCityLoading()) {
                  <p class="city-hint">Szukam miejscowości…</p>
                }
                @if (editCities.length > 1) {
                  <div class="city-suggestions">
                    @for (city of editCities; track city) {
                      <button type="button" tuiChip size="s" (click)="selectEditCity(city)">{{ city }}</button>
                    }
                  </div>
                }
                @if (fieldError(editForm.controls.city); as msg) {
                  <p class="field-error" role="alert">{{ msg }}</p>
                }
              </div>
            </div>

            <!-- Country — read-only -->
            <tui-textfield>
              <label tuiLabel>Kraj</label>
              <input tuiTextfield value="Polska" readonly tabindex="-1" class="readonly-input" />
            </tui-textfield>

            <div>
              <tui-input-phone-international
                formControlName="phone"
                [countries]="countries"
                [countryIsoCode]="editIsoCode"
                [countrySearch]="true"
                (countryIsoCodeChange)="editIsoCode = $event"
              >
                Telefon *
              </tui-input-phone-international>
              @if (fieldError(editForm.controls.phone); as msg) {
                <p class="field-error" role="alert">{{ msg }}</p>
              }
            </div>

            <div class="form-actions">
              <button tuiButton appearance="secondary" size="s" type="button" [disabled]="saving()" (click)="cancelEdit()">
                Anuluj
              </button>
              <button tuiButton size="s" type="submit" [disabled]="editForm.invalid || saving()">
                {{ saving() ? 'Zapisywanie…' : 'Zapisz zmiany' }}
              </button>
            </div>
          </form>
        } @else {
          <div tuiCardLarge appearance="elevated" class="addr-card" [class.addr-card--default]="addr.isDefault">
            <div class="addr-card__top">
              <p class="addr-name">{{ addr.firstName }} {{ addr.lastName }}</p>
              @if (addr.isDefault) {
                <span class="default-badge">Domyślny</span>
              }
            </div>
            @if (addr.company) { <p class="addr-detail">{{ addr.company }}</p> }
            <p class="addr-detail">{{ addr.street }}</p>
            <p class="addr-detail">{{ addr.postalCode }} {{ addr.city }}</p>
            <p class="addr-detail">Tel: {{ addr.phone }}</p>
            @if (confirmingDeleteId() === addr.id) {
              <div class="confirm-box">
                <p>Czy na pewno chcesz usunąć ten adres?</p>
                <div class="confirm-actions">
                  <button tuiButton appearance="negative" size="s" type="button"
                          [disabled]="working() === addr.id" (click)="confirmDelete(addr.id)">
                    {{ working() === addr.id ? 'Usuwanie…' : 'Tak, usuń' }}
                  </button>
                  <button tuiButton appearance="secondary" size="s" type="button"
                          [disabled]="working() === addr.id" (click)="cancelDeleteConfirm()">
                    Anuluj
                  </button>
                </div>
              </div>
            } @else {
              <div class="addr-actions">
                @if (!addr.isDefault) {
                  <button tuiButton appearance="flat" size="s" type="button"
                    [disabled]="!!working()" (click)="setDefault(addr.id)">
                    Ustaw jako domyślny
                  </button>
                }
                <button tuiButton appearance="secondary" size="s" type="button"
                  [disabled]="!!working()" (click)="startEdit(addr)">
                  Edytuj
                </button>
                <button tuiButton appearance="secondary" size="s" type="button"
                  class="btn-delete" [disabled]="!!working()" (click)="startDeleteConfirm(addr.id)">
                  Usuń
                </button>
              </div>
            }
          </div>
        }
      } @empty {
        @if (!showAddForm()) {
          <p class="empty">Nie masz jeszcze żadnych zapisanych adresów.</p>
        }
      }
    </div>
  `,
  styles: [`
    .page { padding: 32px 0; max-width: 560px; margin: 0 auto; }
    .back-btn { margin-bottom: 8px; }
    .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
    h1 { font-size: 24px; font-weight: 700; }

    .addr-form { display: flex; flex-direction: column; gap: 1rem; margin-bottom: 16px; border: 1px solid var(--color-border) !important; }

    .addr-card { display: block; margin-bottom: 12px; border: 1px solid var(--color-border) !important; }
    .addr-card--default { outline: 2px solid var(--color-primary); }
    .addr-card__top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }

    .default-badge {
      display: inline-block;
      background: var(--color-primary);
      color: white;
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
    }
    .addr-name   { font-weight: 600; font-size: 15px; margin: 0; }
    .addr-detail { font-size: 14px; color: var(--color-secondary); margin: 2px 0; }

    .addr-actions {
      display: flex;
      gap: 8px;
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px solid var(--color-border);
      flex-wrap: wrap;
    }
    .btn-delete { margin-left: auto; color: var(--color-error) !important; }

    .name-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .name-col { display: flex; flex-direction: column; }
    .form-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 8px; }

    .field-error { font-size: 12px; color: var(--tui-status-negative); margin-top: 4px; }
    .city-hint { font-size: 12px; color: var(--color-secondary); margin-top: 4px; }
    .city-suggestions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }

    .confirm-box {
      padding: 16px;
      background: #fff7ed;
      border: 1px solid #fdba74;
      border-radius: var(--border-radius-md);
      margin-top: 14px;
    }
    .confirm-box p { font-size: 14px; margin: 0 0 12px; }
    .confirm-actions { display: flex; gap: 10px; }

    .field-disabled { opacity: 0.6; pointer-events: none; }

    .street-hint { font-size: 12px; margin-top: 4px; }
    .street-hint--checking { color: var(--color-primary); }
    .street-hint--found    { color: #2a9d4e; }
    .street-hint--warning  { color: #c47a00; }

    .empty { color: var(--color-secondary); font-size: 14px; }
  `],
})
export class AddressesComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly location = inject(Location);
  private readonly destroyRef = inject(DestroyRef);

  readonly addresses          = signal<Address[]>([]);
  readonly showAddForm        = signal(false);
  readonly editingId          = signal<string | null>(null);
  readonly confirmingDeleteId = signal<string | null>(null);
  readonly adding             = signal(false);
  readonly saving             = signal(false);
  readonly working            = signal<string | null>(null);

  // City suggestion state — separate for add and edit since both can exist in DOM
  readonly addCitySuggestions  = signal<string[]>([]);
  readonly addCityLoading      = signal(false);
  readonly editCitySuggestions = signal<string[]>([]);
  readonly editCityLoading     = signal(false);

  get addCities(): string[] { return this.addCitySuggestions(); }
  get editCities(): string[] { return this.editCitySuggestions(); }
  get addressList(): Address[] { return this.addresses(); }

  // Street existence check state (soft — never blocks submission)
  readonly addStreetStatus  = signal<'idle' | 'checking' | 'found' | 'not-found'>('idle');
  readonly editStreetStatus = signal<'idle' | 'checking' | 'found' | 'not-found'>('idle');

  readonly countries: readonly TuiCountryIsoCode[] = [
    'PL',
    ...getCountries().filter((c) => c !== 'PL'),
  ];
  addIsoCode: TuiCountryIsoCode  = 'PL';
  editIsoCode: TuiCountryIsoCode = 'PL';

  readonly addForm  = this.buildForm();
  readonly editForm = this.buildForm();

  private buildForm() {
    return this.fb.group({
      firstName:  ['', [Validators.required, Validators.maxLength(50), nameValidator]],
      lastName:   ['', [Validators.required, Validators.maxLength(50), nameValidator]],
      company:    [''],
      street:     ['', [Validators.required, Validators.maxLength(200), streetValidator]],
      postalCode: ['', [Validators.required, Validators.pattern(/^\d{2}-\d{3}$/)]],
      city:       ['', [Validators.required, Validators.minLength(2)]],
      phone:      ['', [Validators.required, phoneValidator]],
    });
  }

  fieldError(ctrl: AbstractControl | null): string | null {
    if (!ctrl || (!ctrl.dirty && !ctrl.touched)) return null;
    const e = ctrl.errors;
    if (!e) return null;
    if (e['required'])      return 'To pole jest wymagane';
    if (e['nameTooShort'])  return 'Minimum 2 znaki';
    if (e['nameInvalid'])   return 'Tylko litery, myślniki i apostrofy';
    if (e['streetInvalid']) return 'Podaj ulicę i numer budynku';
    if (e['invalidPhone'])  return 'Wprowadź poprawny numer telefonu';
    if (e['pattern'])       return 'Wymagany format: 00-000';
    if (e['minlength'])     return `Minimum ${e['minlength'].requiredLength} znaki`;
    if (e['maxlength'])     return `Maksymalnie ${e['maxlength'].requiredLength} znaków`;
    return 'Nieprawidłowa wartość';
  }

  ngOnInit(): void {
    this.load();
    this.initPostalLookup(this.addForm, this.addCitySuggestions, this.addCityLoading);
    this.initPostalLookup(this.editForm, this.editCitySuggestions, this.editCityLoading);
    this.initStreetCheck(this.addForm, this.addStreetStatus);
    this.initStreetCheck(this.editForm, this.editStreetStatus);
  }

  back(): void { this.location.back(); }

  private load(): void {
    this.http.get<Address[]>(`${environment.apiUrl}/users/me/addresses`)
      .subscribe({ next: (a) => this.addresses.set(a) });
  }

  private initPostalLookup(
    form: FormGroup,
    suggestions: WritableSignal<string[]>,
    loading: WritableSignal<boolean>,
  ): void {
    form.get('postalCode')!.valueChanges.pipe(
      tap((val) => { if (!/^\d{2}-\d{3}$/.test(val ?? '')) suggestions.set([]); }),
      debounceTime(500),
      distinctUntilChanged(),
      filter((val) => /^\d{2}-\d{3}$/.test(val ?? '')),
      tap(() => loading.set(true)),
      switchMap((code) =>
        this.http.get<string[]>(`${environment.apiUrl}/location/postal-code/${code}`).pipe(
          catchError(() => of(null)),
          finalize(() => loading.set(false)),
        ),
      ),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((cities) => {
      if (!cities?.length) return;
      suggestions.set(cities);
      if (cities.length === 1) {
        form.patchValue({ city: cities[0] }, { emitEvent: false });
        form.get('city')!.markAsDirty();
        suggestions.set([]);
      }
    });
  }

  private initStreetCheck(
    form: FormGroup,
    status: WritableSignal<'idle' | 'checking' | 'found' | 'not-found'>,
  ): void {
    // merge fires when EITHER field changes; values are read from the form at
    // debounce time so a city auto-filled with emitEvent:false is still picked up.
    merge(
      form.get('street')!.valueChanges,
      form.get('city')!.valueChanges,
    ).pipe(
      tap(() => status.set('idle')),
      debounceTime(1200),
      map(() => ({
        street: (form.get('street')!.value as string)?.trim() ?? '',
        city:   (form.get('city')!.value   as string)?.trim() ?? '',
      })),
      filter(({ street, city }) => !!street && !!city && form.get('street')!.valid),
      distinctUntilChanged((a, b) => a.street === b.street && a.city === b.city),
      tap(() => status.set('checking')),
      switchMap(({ street, city }) =>
        this.http.get<{ exists: boolean }>(
          `${environment.apiUrl}/location/street-check`,
          { params: { street, city } },
        ).pipe(catchError(() => of({ exists: false }))),
      ),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(({ exists }) => status.set(exists ? 'found' : 'not-found'));
  }

  openAddForm(): void {
    this.addIsoCode = 'PL';
    this.addCitySuggestions.set([]);
    this.addStreetStatus.set('idle');
    this.addForm.reset();
    this.showAddForm.set(true);
  }

  cancelAdd(): void {
    this.addIsoCode = 'PL';
    this.addCitySuggestions.set([]);
    this.addStreetStatus.set('idle');
    this.showAddForm.set(false);
    this.addForm.reset();
  }

  cancelEdit(): void {
    this.editIsoCode = 'PL';
    this.editCitySuggestions.set([]);
    this.editStreetStatus.set('idle');
    this.editingId.set(null);
  }

  selectAddCity(city: string): void {
    this.addForm.patchValue({ city }, { emitEvent: false });
    this.addForm.get('city')!.markAsDirty();
    this.addCitySuggestions.set([]);
  }

  selectEditCity(city: string): void {
    this.editForm.patchValue({ city }, { emitEvent: false });
    this.editForm.get('city')!.markAsDirty();
    this.editCitySuggestions.set([]);
  }

  submitAdd(): void {
    if (this.addForm.invalid) return;
    this.adding.set(true);
    this.http.post<Address>(`${environment.apiUrl}/users/me/addresses`, this.addForm.getRawValue()).subscribe({
      next: (addr) => {
        this.addresses.update((l) => [...l, addr]);
        this.showAddForm.set(false);
        this.addForm.reset();
        this.addIsoCode = 'PL';
        this.addStreetStatus.set('idle');
        this.adding.set(false);
        this.toast.success('Adres zapisany');
      },
      error: () => { this.toast.error('Błąd zapisu adresu'); this.adding.set(false); },
    });
  }

  startEdit(addr: Address): void {
    this.editCitySuggestions.set([]);
    this.editStreetStatus.set('idle');
    this.editIsoCode = 'PL';
    if (addr.phone) {
      try {
        const parsed = parsePhoneNumber(addr.phone);
        if (parsed?.country) this.editIsoCode = parsed.country as TuiCountryIsoCode;
      } catch { /* ignore */ }
    }
    this.editingId.set(addr.id);
    // emitEvent: false prevents postal lookup from re-firing on setValue
    this.editForm.setValue({
      firstName:  addr.firstName,
      lastName:   addr.lastName,
      company:    addr.company ?? '',
      street:     addr.street,
      postalCode: addr.postalCode,
      city:       addr.city,
      phone:      addr.phone,
    }, { emitEvent: false });
  }

  submitEdit(id: string): void {
    if (this.editForm.invalid) return;
    this.saving.set(true);
    this.http.patch<Address>(`${environment.apiUrl}/users/me/addresses/${id}`, this.editForm.getRawValue()).subscribe({
      next: (updated) => {
        this.addresses.update((l) => l.map((a) => (a.id === id ? updated : a)));
        this.editingId.set(null);
        this.saving.set(false);
        this.toast.success('Adres zaktualizowany');
      },
      error: () => { this.toast.error('Błąd aktualizacji adresu'); this.saving.set(false); },
    });
  }

  setDefault(id: string): void {
    this.working.set(id);
    this.http.patch<Address>(`${environment.apiUrl}/users/me/addresses/${id}`, { isDefault: true }).subscribe({
      next: () => {
        this.addresses.update((l) => {
          const updated = l.map((a) => ({ ...a, isDefault: a.id === id }));
          // Mirror backend order: default first, then by original createdAt
          return [
            ...updated.filter((a) => a.isDefault),
            ...updated.filter((a) => !a.isDefault),
          ];
        });
        this.working.set(null);
        this.toast.success('Adres domyślny zaktualizowany');
      },
      error: () => { this.toast.error('Błąd aktualizacji'); this.working.set(null); },
    });
  }

  startDeleteConfirm(id: string): void {
    this.confirmingDeleteId.set(id);
  }

  cancelDeleteConfirm(): void {
    this.confirmingDeleteId.set(null);
  }

  confirmDelete(id: string): void {
    this.working.set(id);
    this.http.delete(`${environment.apiUrl}/users/me/addresses/${id}`).subscribe({
      next: () => {
        this.addresses.update((l) => l.filter((a) => a.id !== id));
        this.confirmingDeleteId.set(null);
        this.working.set(null);
        this.toast.success('Adres usunięty');
      },
      error: () => {
        this.toast.error('Błąd usuwania adresu');
        this.working.set(null);
      },
    });
  }
}
