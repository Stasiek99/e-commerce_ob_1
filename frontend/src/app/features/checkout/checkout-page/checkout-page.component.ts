import { Component, OnInit, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { tuiMarkControlAsTouchedAndValidate } from '@taiga-ui/cdk';
import { TuiButton, TuiTitle } from '@taiga-ui/core';
import { TuiSlides, TuiStepper, TuiElasticContainer, TuiStep } from '@taiga-ui/kit';
import { TuiCard, TuiForm, TuiHeader } from '@taiga-ui/layout';
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

@Component({
  selector: 'app-checkout-page',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    PricePipe,
    TuiButton,
    TuiTitle,
    TuiStepper,
    TuiCard,
    TuiElasticContainer,
    TuiForm,
    TuiHeader,
    TuiSlides,
    TuiSlides,
    TuiStep
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
              appearance="elevated"
              class="checkout-card checkout-form"
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
                      (click)="selectSavedAddress(addr)">
                      <span class="addr-pill__name">{{ addr.firstName }} {{ addr.lastName }}</span>
                      <span class="addr-pill__city">{{ addr.city }}</span>
                      @if (addr.isDefault) { <span class="addr-pill__badge">★</span> }
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

              <div class="row">
                <div class="field">
                  <label>Imię *</label>
                  <input formControlName="firstName" [class.invalid]="isInvalid('firstName')" />
                </div>
                <div class="field">
                  <label>Nazwisko *</label>
                  <input formControlName="lastName" [class.invalid]="isInvalid('lastName')" />
                </div>
              </div>
              <div class="field">
                <label>Firma</label>
                <input formControlName="company" />
              </div>
              <div class="field">
                <label>Ulica i numer *</label>
                <input formControlName="street" [class.invalid]="isInvalid('street')" />
              </div>
              <div class="row">
                <div class="field">
                  <label>Kod pocztowy *</label>
                  <input formControlName="postalCode" placeholder="00-000" [class.invalid]="isInvalid('postalCode')" />
                </div>
                <div class="field">
                  <label>Miasto *</label>
                  <input formControlName="city" [class.invalid]="isInvalid('city')" />
                </div>
              </div>
              <div class="field">
                <label>Telefon *</label>
                <input formControlName="phone" type="tel" [class.invalid]="isInvalid('phone')" />
              </div>
              <div class="field">
                <label>Email (do potwierdzenia zamówienia) *</label>
                <input formControlName="email" type="email" [class.invalid]="isInvalid('email')" />
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
            <div tuiCardLarge appearance="elevated" class="step-card checkout-card">
              <header tuiHeader>
                <h2 tuiTitle>Sposób dostawy</h2>
              </header>
              <div class="carrier-list">
                @for (c of carriers; track c.code) {
                  <div
                    class="carrier-option"
                    [class.carrier-option--selected]="selectedCarrier()?.code === c.code"
                    (click)="selectedCarrier.set(c)">
                    <div class="carrier-option__name">{{ c.name }}</div>
                    <div class="carrier-option__desc">{{ c.desc }}</div>
                    <div class="carrier-option__price">{{ c.price | price }}</div>
                  </div>
                }
              </div>
              @if (selectedCarrier()?.code === 'INPOST') {
                <div class="inpost-section">
                  <p>Wybierz paczkomat:</p>
                  <input
                    type="text"
                    [value]="lockerCode() ?? ''"
                    (input)="lockerCode.set($any($event.target).value)"
                    placeholder="Wpisz kod paczkomatu (np. KRA001)"
                    class="locker-input" />
                  <p class="hint">Pełna mapa paczkomatów będzie dostępna wkrótce.</p>
                </div>
              }
            </div>
          }

          <!-- Step 2: Summary -->
          @if (index === 2) {
            <div tuiCardLarge appearance="elevated" class="step-card checkout-card">
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

              <div class="summary-total">
                <div class="total-row">
                  <span>Produkty</span>
                  <span>{{ cart.totalInCents() | price }}</span>
                </div>
                <div class="total-row">
                  <span>Dostawa</span>
                  <span>{{ selectedCarrier()?.price | price }}</span>
                </div>
                <div class="total-row total-row--final">
                  <span>Łącznie</span>
                  <span>{{ cart.totalInCents() + (selectedCarrier()?.price ?? 0) | price }}</span>
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
          [disabled]="!index"
          (click)="goBack()"
        >
          Wróć
        </button>
        <button
          tuiButton
          type="button"
          [disabled]="placing()"
          (click)="onNext()"
        >
          {{ index === 2 ? (placing() ? 'Przekierowanie...' : 'Przejdź do płatności') : 'Dalej' }}
        </button>
      </footer>
    </div>
  `,
  styles: [`
    .checkout { max-width: 640px; margin: 0 auto; padding: 32px 24px; }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 32px; }

    .checkout__stepper { margin-bottom: 32px; }
    .checkout__slides { display: block; }

    /* Form / card content */
    h2 { font-size: 20px; font-weight: 700; margin: 0; }
    h3 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-secondary); margin: 0 0 8px; }
    .step-card { display: block; }

    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .field { margin-bottom: 16px; }
    label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 5px; }
    input:not([type=checkbox]) {
      width: 100%;
      border: 1px solid var(--color-border);
      border-radius: 6px;
      padding: 10px 12px;
      font-size: 14px;
      outline: none;
      transition: border-color 0.15s;
    }
    input:not([type=checkbox]):focus { border-color: var(--color-primary); }
    input.invalid { border-color: var(--color-error); }

    /* Carrier */
    .carrier-list { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
    .carrier-option { border: 1px solid var(--color-border); border-radius: 6px; padding: 16px; cursor: pointer; transition: all 0.15s; display: flex; align-items: center; gap: 12px; }
    .carrier-option:hover { border-color: var(--color-primary); }
    .carrier-option--selected { border-color: var(--color-primary); background: #f8f8f8; }
    .carrier-option__name { font-weight: 600; flex: 1; }
    .carrier-option__desc { font-size: 12px; color: var(--color-secondary); }
    .carrier-option__price { font-weight: 600; }
    .inpost-section { padding: 16px 0 0; }
    .locker-input { margin: 8px 0; }
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
    .consent-label span { font-size: 13px; line-height: 1.5; color: #444; }
    .consent-label a { color: var(--color-primary); text-decoration: underline; }

    /* Save address */
    .save-addr-label { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--color-secondary); margin-bottom: 20px; cursor: pointer; }
    .save-addr-label input { width: 15px; height: 15px; accent-color: var(--color-primary); cursor: pointer; }

    /* Address picker */
    .addr-picker { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid var(--color-border); }
    .addr-pill { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 6px; padding: 8px 12px; cursor: pointer; font-size: 12px; transition: border-color 0.15s; }
    .addr-pill:hover { border-color: var(--color-primary); }
    .addr-pill--active { border-color: var(--color-primary); background: #f0f0ff; }
    .addr-pill--new { color: var(--color-primary); font-weight: 600; justify-content: center; }
    .addr-pill__name { font-weight: 600; font-size: 13px; }
    .addr-pill__city { color: var(--color-secondary); }
    .addr-pill__badge { color: var(--color-primary); font-size: 10px; }

    /* Footer nav */
    .checkout__nav { display: flex; justify-content: space-between; }
  `],
})
export class CheckoutPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly toast = inject(ToastService);

  readonly cart = inject(CartService);
  readonly auth = inject(AuthService);

  index = 0;
  direction = 0;

  readonly selectedCarrier = signal<(typeof CARRIERS)[0] | null>(null);
  readonly lockerCode = signal<string | null>(null);
  readonly placing = signal(false);
  readonly termsAccepted = signal(false);
  readonly saveAddress = signal(false);
  readonly savedAddresses = signal<any[]>([]);
  readonly selectedSavedId = signal<string | null>(null);

  readonly carriers = CARRIERS;

  readonly addressForm = this.fb.group({
    firstName: ['', Validators.required],
    lastName: ['', Validators.required],
    company: [''],
    street: ['', Validators.required],
    postalCode: ['', [Validators.required, Validators.pattern(/^\d{2}-\d{3}$/)]],
    city: ['', Validators.required],
    phone: ['', Validators.required],
    email: [this.auth.currentUser()?.email ?? '', [Validators.required, Validators.email]],
  });

  ngOnInit(): void {
    if (!this.auth.currentUser()) return;
    this.http.get<any[]>(`${environment.apiUrl}/users/me/addresses`).subscribe({
      next: (addrs) => {
        this.savedAddresses.set(addrs);
        const def = addrs.find((a) => a.isDefault) ?? addrs[0];
        if (def) this.selectSavedAddress(def);
      },
    });
  }

  stepState(i: number): 'pass' | 'normal' | 'error' {
    if (i < this.index) return 'pass';
    if (i === 0 && this.addressForm.invalid && this.addressForm.touched) return 'error';
    return 'normal';
  }

  onStep(newIndex: number): void {
    // Only allow navigating back to completed steps via stepper click
    if (newIndex >= this.index) return;
    this.direction = newIndex - this.index;
    this.index = newIndex;
  }

  goBack(): void {
    this.direction = -1;
    this.index = Math.max(0, this.index - 1);
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

  selectSavedAddress(addr: any): void {
    this.selectedSavedId.set(addr.id);
    this.addressForm.patchValue({
      firstName: addr.firstName,
      lastName: addr.lastName,
      company: addr.company ?? '',
      street: addr.street,
      postalCode: addr.postalCode,
      city: addr.city,
      phone: addr.phone,
    });
  }

  useNewAddress(): void {
    this.selectedSavedId.set(null);
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
      },
      { headers: new HttpHeaders({ 'x-session-id': this.cart.getSessionId() }) },
    ).subscribe({
      next: (res) => {
        if (this.saveAddress() && this.auth.currentUser() && this.selectedSavedId() === null) {
          const isDefault = this.savedAddresses().length === 0;
          this.http.post(`${environment.apiUrl}/users/me/addresses`, { ...addrPayload, isDefault }).subscribe();
        }
        window.location.href = res.paymentUrl;
      },
      error: (err) => {
        this.toast.error(err.error?.message ?? 'Błąd tworzenia zamówienia.');
        this.placing.set(false);
      },
    });
  }
}
