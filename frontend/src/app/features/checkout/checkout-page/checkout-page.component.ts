import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, distinctUntilChanged, filter, finalize, map, merge, of, switchMap, tap } from 'rxjs';
import { tuiMarkControlAsTouchedAndValidate } from '@taiga-ui/cdk';
import { TuiButton, TuiLabel, TuiTextfield, TuiTitle } from '@taiga-ui/core';
import { tuiInputPhoneInternationalOptionsProvider, TuiSlides, TuiStepper, TuiElasticContainer, TuiStep } from '@taiga-ui/kit';
import { TuiInputPhoneInternational } from '@taiga-ui/experimental';
import { TuiCard, TuiForm, TuiHeader } from '@taiga-ui/layout';
import { type TuiCountryIsoCode } from '@taiga-ui/i18n/types';
import { getCountries } from 'libphonenumber-js/min';
import { parsePhoneNumber } from 'libphonenumber-js';
import { nameValidator, phoneValidator, streetValidator } from '../../../shared/validators/form.validators';

import { CartService } from '../../../core/services/cart.service';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { PricePipe } from '../../../shared/pipes/price.pipe';
import { environment } from '../../../../environments/environment';

const TERMS_VERSION = '1.0';
const enum CarrierCode { INPOST = 'INPOST', DHL = 'DHL', GLS = 'GLS' }

const CARRIERS = [
  { code: CarrierCode.INPOST, name: 'InPost Paczkomat', price: 1499, desc: 'Dostawa do paczkomatu 1-2 dni' },
  { code: CarrierCode.DHL, name: 'DHL Kurier', price: 1999, desc: 'Dostawa pod drzwi 1-2 dni' },
  { code: CarrierCode.GLS, name: 'GLS Kurier', price: 1799, desc: 'Dostawa pod drzwi 2-3 dni' },
];

interface AppliedCoupon {
  code: string;
  discountAmountInCents: number;
  isFreeShipping: boolean;
}

@Component({
  selector: 'app-checkout-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    PricePipe,
    TuiButton, TuiLabel, TuiTextfield,
    TuiTitle,
    TuiStepper,
    TuiCard,
    TuiElasticContainer,
    TuiForm,
    TuiHeader,
    TuiSlides,
    TuiStep,
    TuiInputPhoneInternational,
  ],
  providers: [
    tuiInputPhoneInternationalOptionsProvider({
      metadata: import('libphonenumber-js/min/metadata').then((m) => m.default),
    }),
  ],
  template: `
    <div class="checkout">
      <h1>Zamówienie</h1>

      <!-- ── Stepper ─────────────────────────────────────────────── -->
      <tui-stepper
        class="checkout__stepper"
        [activeItemIndex]="index"
        (activeItemIndexChange)="onStep($event)"
      >
        <button tuiStep>Adres dostawy</button>
        <button tuiStep>Sposób dostawy</button>
        <button tuiStep>Podsumowanie</button>
      </tui-stepper>

      <!-- ── Step content ───────────────────────────────────────── -->
      <tui-elastic-container>
        <section [tuiSlides]="direction" class="checkout__slides">

          <!-- Step 0: Address -->
          @if (index === 0) {
            <form
              tuiCardLarge
              tuiForm=""
              class="checkout-card addr-form"
              [formGroup]="addressForm"
              (ngSubmit)="onNext()"
            >
              <header tuiHeader>
                <h2 tuiTitle>Adres dostawy</h2>
              </header>

              @if (savedAddresses().length > 0) {
                <div class="addr-picker">
                  @for (addr of savedAddresses(); track addr.id) {
                    <button
                      type="button"
                      class="addr-pill"
                      [class.addr-pill--active]="selectedSavedId() === addr.id"
                      [attr.aria-label]="addr.firstName + ' ' + addr.lastName + ', ' + addr.city + (addr.isDefault ? ' (domyślny)' : '')"
                      [attr.aria-pressed]="selectedSavedId() === addr.id"
                      (click)="selectSavedAddress(addr)">
                      <span class="addr-pill__name" aria-hidden="true">{{ addr.firstName }} {{ addr.lastName }}</span>
                      <span class="addr-pill__city" aria-hidden="true">{{ addr.city }}</span>
                      @if (addr.isDefault) { <span class="addr-pill__badge" aria-hidden="true">★</span> }
                    </button>
                  }
                  <button
                    type="button"
                    class="addr-pill addr-pill--new"
                    [class.addr-pill--active]="selectedSavedId() === null"
                    (click)="useNewAddress()">
                    + Nowy adres
                  </button>
                </div>
              }

              <!-- Name -->
              <div class="name-row">
                <div class="name-col">
                  <tui-textfield>
                    <label tuiLabel>Imię *</label>
                    <input tuiTextfield type="text" formControlName="firstName" autocomplete="given-name" />
                  </tui-textfield>
                  @if (errorMsg('firstName'); as msg) { <p class="field-error">{{ msg }}</p> }
                </div>
                <div class="name-col">
                  <tui-textfield>
                    <label tuiLabel>Nazwisko *</label>
                    <input tuiTextfield type="text" formControlName="lastName" autocomplete="family-name" />
                  </tui-textfield>
                  @if (errorMsg('lastName'); as msg) { <p class="field-error">{{ msg }}</p> }
                </div>
              </div>

              <!-- Company -->
              <tui-textfield>
                <label tuiLabel>Firma</label>
                <input tuiTextfield type="text" formControlName="company" autocomplete="organization" />
              </tui-textfield>

              <!-- Street -->
              <div>
                <tui-textfield>
                  <label tuiLabel>Ulica i numer budynku *</label>
                  <input tuiTextfield type="text" formControlName="street" autocomplete="street-address"
                    placeholder="np. ul. Marszałkowska 12/4" />
                </tui-textfield>
                @if (errorMsg('street'); as msg) {
                  <p class="field-error">{{ msg }}</p>
                } @else {
                  @switch (streetStatus()) {
                    @case ('checking')  { <p class="street-hint street-hint--checking">Weryfikuję adres…</p> }
                    @case ('found')     { <p class="street-hint street-hint--found">✓ Adres potwierdzony</p> }
                    @case ('not-found') { <p class="street-hint street-hint--warning">⚠ Nie znaleziono adresu — sprawdź poprawność danych</p> }
                  }
                }
              </div>

              <!-- Postal code + city + country (3-column) -->
              <div class="addr-row-3">
                <div>
                  <tui-textfield>
                    <label tuiLabel>Kod pocztowy *</label>
                    <input tuiTextfield type="text" formControlName="postalCode" placeholder="00-000"
                      autocomplete="postal-code" />
                  </tui-textfield>
                  @if (errorMsg('postalCode'); as msg) { <p class="field-error">{{ msg }}</p> }
                </div>
                <div class="name-col">
                  <tui-textfield>
                    <label tuiLabel>Miasto *</label>
                    <input tuiTextfield type="text" formControlName="city" autocomplete="address-level2" />
                  </tui-textfield>
                  @if (cityLoading()) { <p class="city-hint">Szukam miejscowości…</p> }
                  @if (citySuggestions().length > 1) {
                    <div class="city-suggestions">
                      @for (city of citySuggestions(); track city) {
                        <button type="button" class="city-chip" (click)="selectCity(city)">{{ city }}</button>
                      }
                    </div>
                  }
                  @if (errorMsg('city'); as msg) { <p class="field-error">{{ msg }}</p> }
                </div>
                <div>
                  <tui-textfield class="field-disabled">
                    <label tuiLabel>Kraj</label>
                    <input tuiTextfield value="Polska" [attr.disabled]="true" tabindex="-1" />
                  </tui-textfield>
                </div>
              </div>

              <!-- Phone + email (2-column) -->
              <div class="addr-row-2">
                <div>
                  <tui-textfield>
                    <label tuiLabel>Telefon *</label>
                    <input tuiInputPhoneInternational
                           formControlName="phone"
                           [countries]="countries"
                           [countryIsoCode]="countryIsoCode"
                           [countrySearch]="true"
                           (countryIsoCodeChange)="countryIsoCode = $event" />
                  </tui-textfield>
                  @if (errorMsg('phone'); as msg) { <p class="field-error">{{ msg }}</p> }
                </div>
                <div>
                  <tui-textfield>
                    <label tuiLabel>Email *</label>
                    <input tuiTextfield type="email" formControlName="email" autocomplete="email" />
                  </tui-textfield>
                  @if (errorMsg('email'); as msg) { <p class="field-error">{{ msg }}</p> }
                </div>
              </div>

              @if (auth.currentUser() && selectedSavedId() === null) {
                <label class="save-addr-label">
                  <input type="checkbox" [checked]="saveAddress()" (change)="saveAddress.set($any($event.target).checked)" />
                  {{ savedAddresses().length === 0 ? 'Zapisz jako domyślny adres dostawy' : 'Zapisz adres w adresach dostawy' }}
                </label>
              }
            </form>
          }

          <!-- Step 1: Carrier -->
          @if (index === 1) {
            <div tuiCardLarge class="step-card checkout-card">
              <header tuiHeader>
                <h2 tuiTitle>Sposób dostawy</h2>
              </header>
              <fieldset class="carrier-list">
                <legend class="sr-only">Wybierz sposób dostawy</legend>
                @for (c of carriers; track c.code) {
                  <label
                    class="carrier-option"
                    [class.carrier-option--selected]="selectedCarrier()?.code === c.code">
                    <input
                      type="radio"
                      name="carrier"
                      [id]="'carrier-' + c.code"
                      [value]="c.code"
                      [checked]="selectedCarrier()?.code === c.code"
                      (change)="selectedCarrier.set(c)"
                      class="sr-only"
                    />
                    <div class="carrier-option__name">{{ c.name }}</div>
                    <div class="carrier-option__desc">{{ c.desc }}</div>
                    <div class="carrier-option__price">{{ c.price | price }}</div>
                  </label>
                }
              </fieldset>
              @if (selectedCarrier()?.code === 'INPOST') {
                <div class="inpost-section">
                  <tui-textfield>
                    <label tuiLabel>Kod paczkomatu</label>
                    <input tuiTextfield type="text"
                      [value]="lockerCode() ?? ''"
                      (input)="lockerCode.set($any($event.target).value)"
                      placeholder="np. POL001" />
                  </tui-textfield>
                  <p class="hint">Pełna mapa paczkomatów będzie dostępna wkrótce.</p>
                </div>
              }
            </div>
          }

          <!-- Step 2: Summary -->
          @if (index === 2) {
            <div tuiCardLarge class="step-card checkout-card">
              <header tuiHeader>
                <h2 tuiTitle>Podsumowanie zamówienia</h2>
              </header>

              <div class="summary-section">
                <h3>Adres</h3>
                <p>{{ addressForm.value.firstName }} {{ addressForm.value.lastName }}</p>
                <p>{{ addressForm.value.street }}</p>
                <p>{{ addressForm.value.postalCode }} {{ addressForm.value.city }}</p>
                <p>Tel: {{ addressForm.value.phone }}</p>
              </div>

              <div class="summary-section">
                <h3>Dostawa</h3>
                <p>{{ selectedCarrier()?.name }} — {{ selectedCarrier()?.price | price }}</p>
                @if (lockerCode()) { <p>Paczkomat: {{ lockerCode() }}</p> }
              </div>

              <div class="summary-section">
                <h3>Produkty</h3>
                @for (item of cart.items(); track item.productVariantId) {
                  <div class="order-item">
                    <span>{{ item.productName }} {{ item.variantLabel }} × {{ item.quantity }}</span>
                    <span>{{ item.priceInCents * item.quantity | price }}</span>
                  </div>
                }
              </div>

              <!-- Coupon -->
              <div class="coupon-section">
                @if (!appliedCoupon()) {
                  @if (!couponExpanded()) {
                    <button type="button" class="coupon-toggle" (click)="couponExpanded.set(true)">
                      Masz kod promocyjny?
                    </button>
                  } @else {
                    <tui-textfield>
                      <label tuiLabel>Kod rabatowy</label>
                      <input
                        tuiTextfield
                        type="text"
                        [value]="couponCodeInput()"
                        (input)="couponCodeInput.set($any($event.target).value.toUpperCase())"
                        (keydown.enter)="applyCoupon()"
                        placeholder="np. WELCOME15"
                        autocomplete="off"
                      />
                    </tui-textfield>
                    @if (couponError()) {
                      <p class="field-error">{{ couponError() }}</p>
                    }
                    <div class="coupon-actions">
                      <button
                        tuiButton
                        type="button"
                        appearance="secondary"
                        size="s"
                        [disabled]="couponValidating() || !couponCodeInput()"
                        (click)="applyCoupon()"
                      >
                        {{ couponValidating() ? 'Sprawdzam…' : 'Zastosuj' }}
                      </button>
                    </div>
                  }
                } @else {
                  <div class="coupon-applied">
                    <span class="coupon-applied__badge">✓ {{ appliedCoupon()!.code }}</span>
                    <button type="button" class="coupon-remove" (click)="removeCoupon()">Usuń</button>
                  </div>
                }
              </div>

              <div class="summary-total">
                <div class="total-row">
                  <span>Produkty</span>
                  <span>{{ cart.totalInCents() | price }}</span>
                </div>
                <div class="total-row">
                  <span>Dostawa</span>
                  @if (appliedCoupon()?.isFreeShipping) {
                    <span class="discount-value">Gratis</span>
                  } @else {
                    <span>{{ selectedCarrier()?.price | price }}</span>
                  }
                </div>
                @if (appliedCoupon() && !appliedCoupon()!.isFreeShipping) {
                  <div class="total-row total-row--discount">
                    <span>Rabat ({{ appliedCoupon()!.code }})</span>
                    <span class="discount-value">−{{ appliedCoupon()!.discountAmountInCents | price }}</span>
                  </div>
                }
                <div class="total-row total-row--final">
                  <span>Łącznie</span>
                  <span>{{ effectiveTotal() | price }}</span>
                </div>
              </div>

              <label class="consent-label">
                <input
                  type="checkbox"
                  [checked]="termsAccepted()"
                  (change)="termsAccepted.set($any($event.target).checked)"
                  class="consent-checkbox" />
                <span>
                  Akceptuję <a routerLink="/legal/terms" target="_blank">regulamin sklepu</a>
                  i&nbsp;<a routerLink="/legal/privacy" target="_blank">politykę prywatności</a>. *
                </span>
              </label>
            </div>
          }

        </section>
      </tui-elastic-container>

      <!-- ── Navigation ─────────────────────────────────────────── -->
      <footer class="checkout__nav">
        <button
          tuiButton
          appearance="secondary"
          type="button"
          (click)="goBack()"
        >
          {{ index === 0 ? 'Koszyk' : 'Wróć' }}
        </button>
        <button
          tuiButton
          type="button"
          [disabled]="placing() || (index === 2 && !termsAccepted())"
          (click)="onNext()"
        >
          {{ index === 2 ? (placing() ? 'Przekierowanie...' : 'Przejdź do płatności') : 'Dalej' }}
        </button>
      </footer>
    </div>
  `,
  styles: [`
    .checkout { max-width: 640px; margin: 0 auto; padding: 32px 16px; }
    h1 { font-size: clamp(22px, 5vw, 28px); font-weight: 700; margin-bottom: 32px; }

    .checkout__stepper { margin-bottom: 32px; }
    .checkout__slides { display: block; }

    /* Form / card content */
    h2 { font-size: 20px; font-weight: 700; margin: 0; }
    h3 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-secondary); margin: 0 0 8px; }
    .step-card { display: block; }

    /* Address form — Taiga UI style matching /account/addresses */
    .checkout-card { border: 1px solid var(--color-border) !important; }
    .addr-form { display: flex; flex-direction: column; gap: 1rem; }
    .addr-form [tuiHeader] { margin-bottom: 0; }
    .name-row  { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
    .addr-row-3 { display: grid; grid-template-columns: 9rem 1fr 7rem; gap: 12px; align-items: start; }
    .addr-row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
    .name-col { display: flex; flex-direction: column; }
    .field-disabled { opacity: 0.6; pointer-events: none; }

    .field-error { font-size: 12px; color: var(--tui-status-negative); margin-top: 4px; }
    .city-hint { font-size: 12px; color: var(--color-secondary); margin-top: 4px; }
    .city-suggestions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
    .city-chip {
      background: #f0f0f5;
      border: 1px solid var(--color-border);
      border-radius: 999px;
      padding: 3px 12px;
      font-size: 12px;
      cursor: pointer;
      transition: border-color 0.15s, background 0.15s;
    }
    .city-chip:hover { border-color: var(--color-primary); background: #e8e8f0; }
    .street-hint { font-size: 12px; margin-top: 4px; }
    .street-hint--checking { color: var(--color-primary); }
    .street-hint--found    { color: #2a9d4e; }
    .street-hint--warning  { color: #c47a00; }

    /* Carrier */
    .carrier-list { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; border: none; padding: 0; }
    .carrier-option { border: 1px solid var(--color-border); border-radius: var(--border-radius-md); padding: 16px; cursor: pointer; transition: all 0.15s; display: flex; align-items: center; gap: 12px; }
    .carrier-option:hover { border-color: var(--color-primary); }
    .carrier-option:has(input:focus-visible) { outline: 3px solid var(--color-accent); outline-offset: 1px; }
    .carrier-option--selected { border-color: var(--color-primary); background: #f8f8f8; }
    .carrier-option__name { font-weight: 600; flex: 1; }
    .carrier-option__desc { font-size: 12px; color: var(--color-secondary); }
    .carrier-option__price { font-weight: 600; }
    .inpost-section { padding: 16px 0 0; display: flex; flex-direction: column; gap: 8px; }
    .hint { font-size: 12px; color: var(--color-secondary); margin: 0; }

    /* Summary */
    .summary-section { margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid var(--color-border); }
    .summary-section p { font-size: 14px; margin: 2px 0; }
    .order-item { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 4px; }
    .summary-total { padding-top: 8px; margin-bottom: 24px; }
    .total-row { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 8px; }
    .total-row--final { font-size: 18px; font-weight: 700; margin-top: 12px; padding-top: 12px; border-top: 2px solid var(--color-primary); }

    /* Consent */
    .consent-label { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; }
    .consent-checkbox { margin-top: 2px; width: 16px; height: 16px; flex-shrink: 0; cursor: pointer; accent-color: var(--color-primary); }
    .consent-label span { font-size: 13px; line-height: 1.5; color: var(--color-primary); }
    .consent-label a { color: var(--color-primary); text-decoration: underline; }

    /* Save address */
    .save-addr-label { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--color-secondary); margin-bottom: 0; cursor: pointer; }
    .save-addr-label input { width: 15px; height: 15px; accent-color: var(--color-primary); cursor: pointer; }

    /* Address picker */
    .addr-picker { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 0; padding-bottom: 16px; border-bottom: 1px solid var(--color-border); }
    .addr-pill { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--border-radius-md); padding: 8px 12px; cursor: pointer; font-size: 12px; transition: border-color 0.15s; }
    .addr-pill:hover { border-color: var(--color-primary); }
    .addr-pill--active { border-color: var(--color-primary); background: #f0f0ff; }
    .addr-pill--new { color: var(--color-primary); font-weight: 600; justify-content: center; }
    .addr-pill__name { font-weight: 600; font-size: 13px; }
    .addr-pill__city { color: var(--color-secondary); }
    .addr-pill__badge { color: var(--color-primary); font-size: 10px; }

    /* Coupon — follows the same column+gap pattern as .inpost-section and .form-actions */
    .coupon-section { margin-bottom: 20px; display: flex; flex-direction: column; gap: 8px; }
    .coupon-toggle { background: none; border: none; padding: 0; font-size: 13px; color: var(--color-primary); text-decoration: underline; cursor: pointer; align-self: flex-start; }
    .coupon-actions { display: flex; justify-content: flex-end; }
    .coupon-applied { display: flex; align-items: center; gap: 12px; }
    .coupon-applied__badge { background: #e8f5e9; color: #2a9d4e; border: 1px solid #a5d6a7; border-radius: 999px; padding: 4px 12px; font-size: 13px; font-weight: 600; }
    .coupon-remove { background: none; border: none; font-size: 12px; color: var(--color-secondary); text-decoration: underline; cursor: pointer; padding: 0; }
    .total-row--discount { color: #2a9d4e; }
    .discount-value { font-weight: 600; color: #2a9d4e; }

    /* Footer nav */
    .checkout__nav { display: flex; justify-content: space-between; margin-top: 24px; }

    @media (max-width: 540px) {
      .name-row  { grid-template-columns: 1fr; }
      .addr-row-2 { grid-template-columns: 1fr; }
      .addr-row-3 { grid-template-columns: 1fr 1fr; }
      .addr-row-3 > div:last-child { grid-column: 1 / -1; }
      .carrier-option { flex-wrap: wrap; }
      .carrier-option__desc { width: 100%; order: 3; }
    }
  `],
})
export class CheckoutPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly toast = inject(ToastService);

  readonly cart = inject(CartService);
  readonly auth = inject(AuthService);

  index = 0;
  direction = 0;

  private readonly destroyRef = inject(DestroyRef);

  readonly selectedCarrier = signal<(typeof CARRIERS)[0] | null>(null);
  readonly lockerCode = signal<string | null>(null);
  readonly placing = signal(false);
  readonly termsAccepted = signal(false);
  readonly saveAddress = signal(false);
  readonly savedAddresses = signal<any[]>([]);
  readonly selectedSavedId = signal<string | null>(null);
  readonly citySuggestions = signal<string[]>([]);
  readonly cityLoading = signal(false);
  readonly streetStatus = signal<'idle' | 'checking' | 'found' | 'not-found'>('idle');

  readonly couponExpanded = signal(false);
  readonly couponCodeInput = signal('');
  readonly couponValidating = signal(false);
  readonly couponError = signal<string | null>(null);
  readonly appliedCoupon = signal<AppliedCoupon | null>(null);

  readonly effectiveTotal = computed(() => {
    const items = this.cart.totalInCents();
    const shipping = this.selectedCarrier()?.price ?? 0;
    const coupon = this.appliedCoupon();
    if (!coupon) return items + shipping;
    if (coupon.isFreeShipping) return items;
    return Math.max(0, items + shipping - coupon.discountAmountInCents);
  });

  readonly carriers = CARRIERS;

  readonly countries: readonly TuiCountryIsoCode[] = [
    'PL',
    ...getCountries().filter((c) => c !== 'PL'),
  ];
  countryIsoCode: TuiCountryIsoCode = 'PL';

  readonly addressForm = this.fb.group({
    firstName: ['', [Validators.required, Validators.maxLength(50), nameValidator]],
    lastName: ['', [Validators.required, Validators.maxLength(50), nameValidator]],
    company: [''],
    street: ['', [Validators.required, Validators.maxLength(100), streetValidator]],
    postalCode: ['', [Validators.required, Validators.pattern(/^\d{2}-\d{3}$/)]],
    city: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(60)]],
    phone: ['', [Validators.required, phoneValidator]],
    email: [this.auth.currentUser()?.email ?? '', [Validators.required, Validators.email]],
  });

  ngOnInit(): void {
    this.addressForm.controls.postalCode.valueChanges.pipe(
      tap((val) => { if (!/^\d{2}-\d{3}$/.test(val ?? '')) this.citySuggestions.set([]); }),
      debounceTime(500),
      distinctUntilChanged(),
      filter((val) => /^\d{2}-\d{3}$/.test(val ?? '')),
      tap(() => this.cityLoading.set(true)),
      switchMap((code) =>
        this.http.get<string[]>(`${environment.apiUrl}/location/postal-code/${code}`).pipe(
          catchError(() => of(null)),
          finalize(() => this.cityLoading.set(false)),
        ),
      ),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((cities) => {
      if (!cities?.length) return;
      this.citySuggestions.set(cities);
      if (cities.length === 1) {
        this.addressForm.patchValue({ city: cities[0] }, { emitEvent: false });
        this.addressForm.controls.city.markAsDirty();
        this.citySuggestions.set([]);
      }
    });

    merge(
      this.addressForm.controls.street.valueChanges,
      this.addressForm.controls.city.valueChanges,
    ).pipe(
      tap(() => this.streetStatus.set('idle')),
      debounceTime(1200),
      map(() => ({
        street: this.addressForm.controls.street.value?.trim() ?? '',
        city: this.addressForm.controls.city.value?.trim() ?? '',
      })),
      filter(({ street, city }) => !!street && !!city && this.addressForm.controls.street.valid),
      distinctUntilChanged((a, b) => a.street === b.street && a.city === b.city),
      tap(() => this.streetStatus.set('checking')),
      switchMap(({ street, city }) =>
        this.http.get<{ exists: boolean }>(
          `${environment.apiUrl}/location/street-check`,
          { params: { street, city } },
        ).pipe(catchError(() => of({ exists: false }))),
      ),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(({ exists }) => this.streetStatus.set(exists ? 'found' : 'not-found'));

    // Auto-apply coupon from URL param (?coupon=CODE) for email/influencer links
    const urlCoupon = this.route.snapshot.queryParamMap.get('coupon');
    if (urlCoupon) {
      this.couponCodeInput.set(urlCoupon.toUpperCase());
      this.couponExpanded.set(true);
    }

    if (!this.auth.currentUser()) return;
    this.http.get<any[]>(`${environment.apiUrl}/users/me/addresses`).subscribe({
      next: (addrs) => {
        this.savedAddresses.set(addrs);
        const def = addrs.find((a) => a.isDefault) ?? addrs[0];
        if (def) this.selectSavedAddress(def);
      },
    });
  }

  applyCoupon(): void {
    const code = this.couponCodeInput().trim();
    if (!code) return;
    this.couponValidating.set(true);
    this.couponError.set(null);

    const variantIds = this.cart.items().map((i) => i.productVariantId);

    this.http.post<any>(`${environment.apiUrl}/coupons/validate`, {
      code,
      cartTotalInCents: this.cart.totalInCents(),
      variantIds,
    }).subscribe({
      next: (res) => {
        this.couponValidating.set(false);
        if (!res.valid) {
          this.couponError.set(res.message ?? 'Nieprawidłowy kod rabatowy.');
          return;
        }
        const isFreeShipping = res.discountType === 'FREE_SHIPPING';
        this.appliedCoupon.set({
          code,
          discountAmountInCents: isFreeShipping ? (this.selectedCarrier()?.price ?? 0) : (res.discountAmountInCents ?? 0),
          isFreeShipping,
        });
        this.couponExpanded.set(false);
      },
      error: () => {
        this.couponValidating.set(false);
        this.couponError.set('Błąd podczas weryfikacji kodu.');
      },
    });
  }

  removeCoupon(): void {
    this.appliedCoupon.set(null);
    this.couponCodeInput.set('');
    this.couponError.set(null);
    this.couponExpanded.set(false);
  }

  selectCity(city: string): void {
    this.addressForm.patchValue({ city }, { emitEvent: false });
    this.addressForm.controls.city.markAsDirty();
    this.citySuggestions.set([]);
  }

  stepState(i: number): 'pass' | 'normal' | 'error' {
    if (i < this.index) return 'pass';
    if (i === 0 && this.addressForm.invalid && this.addressForm.touched) return 'error';
    return 'normal';
  }

  onStep(newIndex: number): void {
    if (newIndex >= this.index) return;
    this.direction = newIndex - this.index;
    this.index = newIndex;
  }

  goBack(): void {
    if (this.index === 0) {
      this.router.navigate(['/cart']);
      return;
    }
    this.direction = -1;
    this.index--;
  }

  onNext(): void {
    if (this.index === 0) {
      tuiMarkControlAsTouchedAndValidate(this.addressForm);
      if (this.addressForm.invalid) return;
    }
    if (this.index === 1) {
      if (!this.selectedCarrier()) return;
      if (this.selectedCarrier()!.code === CarrierCode.INPOST && !this.lockerCode()) return;
    }
    if (this.index === 2) {
      if (!this.termsAccepted()) return;
      this.placeOrder();
      return;
    }
    this.direction = 1;
    this.index = Math.min(this.index + 1, 2);
  }

  isInvalid(field: string): boolean {
    const ctrl = this.addressForm.get(field);
    return !!(ctrl?.invalid && ctrl.touched);
  }

  errorMsg(field: string): string | null {
    const ctrl = this.addressForm.get(field);
    if (!ctrl?.touched || ctrl.valid) return null;
    const e = ctrl.errors!;
    if (e['required']) return 'To pole jest wymagane';
    if (e['nameTooShort']) return 'Minimum 2 znaki';
    if (e['nameInvalid']) return 'Tylko litery, myślniki i apostrofy';
    if (e['streetInvalid']) return 'Podaj ulicę i numer budynku';
    if (e['invalidPhone']) return 'Wprowadź poprawny numer telefonu';
    if (e['email']) return 'Podaj prawidłowy adres e-mail';
    if (e['pattern']) return 'Wymagany format: 00-000';
    if (e['minlength']) return `Minimum ${e['minlength'].requiredLength} znaki`;
    if (e['maxlength']) return `Maksymalnie ${e['maxlength'].requiredLength} znaków`;
    return 'Nieprawidłowa wartość';
  }

  selectSavedAddress(addr: any): void {
    this.selectedSavedId.set(addr.id);
    this.citySuggestions.set([]);
    if (addr.phone) {
      try {
        const parsed = parsePhoneNumber(addr.phone);
        if (parsed?.country) this.countryIsoCode = parsed.country as TuiCountryIsoCode;
      } catch { /* ignore */ }
    }
    // emitEvent: false — prevents postal lookup from firing on a pre-filled address
    this.addressForm.patchValue({
      firstName: addr.firstName,
      lastName: addr.lastName,
      company: addr.company ?? '',
      street: addr.street,
      postalCode: addr.postalCode,
      city: addr.city,
      phone: addr.phone,
    }, { emitEvent: false });
  }

  useNewAddress(): void {
    this.selectedSavedId.set(null);
    this.countryIsoCode = 'PL';
    this.citySuggestions.set([]);
    this.streetStatus.set('idle');
    this.addressForm.reset({ email: this.auth.currentUser()?.email ?? '' });
  }

  placeOrder(): void {
    this.placing.set(true);
    const a = this.addressForm.getRawValue();
    const carrier = this.selectedCarrier()!;
    const addrPayload = {
      firstName: a.firstName!,
      lastName: a.lastName!,
      company: a.company || undefined,
      street: a.street!,
      city: a.city!,
      postalCode: a.postalCode!,
      phone: a.phone!,
    };

    this.http.post<any>(
      `${environment.apiUrl}/orders`,
      {
        newAddress: addrPayload,
        carrierCode: carrier.code,
        inpostLockerCode: this.lockerCode() ?? undefined,
        guestEmail: a.email,
        termsVersion: TERMS_VERSION,
        termsAcceptedAt: new Date().toISOString(),
        couponCode: this.appliedCoupon()?.code ?? undefined,
      },
      { headers: new HttpHeaders({ 'x-session-id': this.cart.getSessionId() }) },
    ).subscribe({
      next: (res) => {
        if (this.saveAddress() && this.auth.currentUser() && this.selectedSavedId() === null) {
          const isDefault = this.savedAddresses().length === 0;
          this.http.post(`${environment.apiUrl}/users/me/addresses`, { ...addrPayload, isDefault }).subscribe();
        }
        this.toast.success('Zamówienie złożone! Przekierowujemy do płatności…');
        window.location.href = res.paymentUrl;
      },
      error: (err) => {
        const message: string = err.error?.message ?? 'Błąd tworzenia zamówienia.';
        this.toast.error(message);
        // Coupon was rejected server-side (expired or limit hit between validate and submit).
        // Surface the error in the coupon field so the user knows to re-check the code.
        if (message.toLowerCase().includes('kod')) {
          this.appliedCoupon.set(null);
          this.couponError.set(message);
          this.couponExpanded.set(true);
        }
        this.placing.set(false);
      },
    });
  }
}
