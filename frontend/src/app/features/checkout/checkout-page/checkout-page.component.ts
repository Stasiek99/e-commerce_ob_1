import { Component, OnInit, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { CartService } from '../../../core/services/cart.service';
import { AuthService } from '../../../core/services/auth.service';
import { ToastService } from '../../../core/services/toast.service';
import { PricePipe } from '../../../shared/pipes/price.pipe';
import { environment } from '../../../../environments/environment';

const TERMS_VERSION = '1.0';
const enum CarrierCode { INPOST = 'INPOST', DHL = 'DHL', GLS = 'GLS' }

type CheckoutStep = 'address' | 'carrier' | 'summary';

const CARRIERS = [
  { code: CarrierCode.INPOST, name: 'InPost Paczkomat', price: 1499, desc: 'Dostawa do paczkomatu 1-2 dni' },
  { code: CarrierCode.DHL, name: 'DHL Kurier', price: 1999, desc: 'Dostawa pod drzwi 1-2 dni' },
  { code: CarrierCode.GLS, name: 'GLS Kurier', price: 1799, desc: 'Dostawa pod drzwi 2-3 dni' },
];

@Component({
  selector: 'app-checkout-page',
  standalone: true,
  imports: [ReactiveFormsModule, PricePipe, RouterLink],
  template: `
    <div class="checkout">
      <h1>Zamówienie</h1>

      <!-- Step indicators -->
      <div class="steps">
        @for (s of ['address', 'carrier', 'summary']; track s) {
          <div class="step" [class.step--active]="step() === s" [class.step--done]="isStepDone(s)">
            {{ stepLabel(s) }}
          </div>
        }
      </div>

      <!-- Step: Address -->
      @if (step() === 'address') {
        <form [formGroup]="addressForm" (ngSubmit)="goToCarrier()" class="form-card">
          <h2>Adres dostawy</h2>

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
              <button type="button" class="addr-pill addr-pill--new" [class.addr-pill--active]="selectedSavedId() === null" (click)="useNewAddress()">
                + Nowy adres
              </button>
            </div>
          }

          <div class="row">
            <div class="field">
              <label>Imię *</label>
              <input formControlName="firstName" />
            </div>
            <div class="field">
              <label>Nazwisko *</label>
              <input formControlName="lastName" />
            </div>
          </div>
          <div class="field">
            <label>Firma</label>
            <input formControlName="company" />
          </div>
          <div class="field">
            <label>Ulica i numer *</label>
            <input formControlName="street" />
          </div>
          <div class="row">
            <div class="field">
              <label>Kod pocztowy *</label>
              <input formControlName="postalCode" placeholder="00-000" />
            </div>
            <div class="field">
              <label>Miasto *</label>
              <input formControlName="city" />
            </div>
          </div>
          <div class="field">
            <label>Telefon *</label>
            <input formControlName="phone" type="tel" />
          </div>
          <div class="field">
            <label>Email (do potwierdzenia zamówienia) *</label>
            <input formControlName="email" type="email" />
          </div>

          @if (auth.currentUser() && selectedSavedId() === null) {
            <label class="save-addr-label">
              <input type="checkbox" [checked]="saveAddress()" (change)="saveAddress.set($any($event.target).checked)" />
              {{ savedAddresses().length === 0 ? 'Zapisz jako domyślny adres dostawy' : 'Zapisz adres w adresach dostawy' }}
            </label>
          }

          <button type="submit" [disabled]="addressForm.invalid" class="btn-next">
            Dalej: Sposób dostawy →
          </button>
        </form>
      }

      <!-- Step: Carrier -->
      @if (step() === 'carrier') {
        <div class="form-card">
          <h2>Sposób dostawy</h2>
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

          <div class="btn-row">
            <button (click)="step.set('address')" class="btn-back">← Wróć</button>
            <button
              (click)="goToSummary()"
              [disabled]="!selectedCarrier() || (selectedCarrier()!.code === 'INPOST' && !lockerCode())"
              class="btn-next">
              Dalej: Podsumowanie →
            </button>
          </div>
        </div>
      }

      <!-- Step: Summary -->
      @if (step() === 'summary') {
        <div class="form-card">
          <h2>Podsumowanie zamówienia</h2>

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

          <div class="consent-row">
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

          <div class="btn-row">
            <button (click)="step.set('carrier')" class="btn-back">← Wróć</button>
            <button (click)="placeOrder()" [disabled]="placing() || !termsAccepted()" class="btn-pay">
              {{ placing() ? 'Przekierowanie...' : 'Przejdź do płatności →' }}
            </button>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .checkout { max-width: 640px; margin: 0 auto; padding: 32px 0; }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 24px; }
    .steps { display: flex; gap: 8px; margin-bottom: 32px; }
    .step { flex: 1; text-align: center; padding: 10px; border-radius: var(--radius-sm); font-size: 13px; background: var(--color-border); color: var(--color-secondary); }
    .step--active { background: var(--color-primary); color: white; font-weight: 600; }
    .step--done { background: #d1fae5; color: #065f46; }
    .form-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 32px; }
    h2 { font-size: 20px; font-weight: 700; margin: 0 0 24px; }
    h3 { font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-secondary); margin: 0 0 8px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .field { margin-bottom: 16px; }
    label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 5px; }
    input { width: 100%; border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 10px 12px; font-size: 14px; outline: none; }
    input:focus { border-color: var(--color-primary); }
    .btn-next, .btn-pay { background: var(--color-primary); color: white; border: none; padding: 12px 24px; border-radius: var(--radius-md); font-size: 15px; font-weight: 600; cursor: pointer; }
    .btn-next:disabled, .btn-pay:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-back { background: none; border: 1px solid var(--color-border); padding: 12px 20px; border-radius: var(--radius-md); cursor: pointer; font-size: 14px; }
    .btn-row { display: flex; justify-content: space-between; margin-top: 24px; }
    .carrier-list { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
    .carrier-option { border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 16px; cursor: pointer; transition: all 0.15s; display: flex; align-items: center; gap: 12px; }
    .carrier-option:hover { border-color: var(--color-primary); }
    .carrier-option--selected { border-color: var(--color-primary); background: #f0f0f0; }
    .carrier-option__name { font-weight: 600; flex: 1; }
    .carrier-option__desc { font-size: 12px; color: var(--color-secondary); }
    .carrier-option__price { font-weight: 600; }
    .inpost-section { padding: 16px 0; }
    .locker-input { width: 100%; margin: 8px 0; }
    .hint { font-size: 12px; color: var(--color-secondary); }
    .summary-section { margin-bottom: 24px; padding-bottom: 24px; border-bottom: 1px solid var(--color-border); }
    .summary-section p { font-size: 14px; margin: 2px 0; }
    .order-item { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 4px; }
    .summary-total { padding-top: 16px; }
    .total-row { display: flex; justify-content: space-between; font-size: 14px; margin-bottom: 8px; }
    .total-row--final { font-size: 18px; font-weight: 700; margin-top: 12px; padding-top: 12px; border-top: 2px solid var(--color-primary); }
    .consent-row { margin: 20px 0 8px; }
    .consent-label { display: flex; align-items: flex-start; gap: 10px; cursor: pointer; }
    .consent-checkbox { margin-top: 2px; width: 16px; height: 16px; flex-shrink: 0; cursor: pointer; accent-color: var(--color-primary); }
    .consent-label span { font-size: 13px; line-height: 1.5; color: #444; }
    .consent-label a { color: var(--color-primary); text-decoration: underline; }
    .save-addr-label { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--color-secondary); margin-bottom: 20px; cursor: pointer; }
    .save-addr-label input { width: 15px; height: 15px; accent-color: var(--color-primary); cursor: pointer; }
    .addr-picker { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid var(--color-border); }
    .addr-pill { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 8px 12px; cursor: pointer; font-size: 12px; transition: border-color 0.15s; }
    .addr-pill:hover { border-color: var(--color-primary); }
    .addr-pill--active { border-color: var(--color-primary); background: #f0f0ff; }
    .addr-pill--new { color: var(--color-primary); font-weight: 600; justify-content: center; }
    .addr-pill__name { font-weight: 600; font-size: 13px; }
    .addr-pill__city { color: var(--color-secondary); }
    .addr-pill__badge { color: var(--color-primary); font-size: 10px; }
  `],
})
export class CheckoutPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly toast = inject(ToastService);

  readonly cart = inject(CartService);
  readonly auth = inject(AuthService);

  readonly step = signal<CheckoutStep>('address');
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

  ngOnInit() {
    if (!this.auth.currentUser()) return;
    this.http
      .get<any[]>(`${environment.apiUrl}/users/me/addresses`)
      .subscribe({
        next: (addrs) => {
          this.savedAddresses.set(addrs);
          const def = addrs.find((a) => a.isDefault) ?? addrs[0];
          if (def) this.selectSavedAddress(def);
        },
      });
  }

  selectSavedAddress(addr: any) {
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

  useNewAddress() {
    this.selectedSavedId.set(null);
    this.addressForm.reset({ email: this.auth.currentUser()?.email ?? '' });
  }

  stepLabel(s: string): string {
    return { address: '1. Adres', carrier: '2. Dostawa', summary: '3. Płatność' }[s] ?? s;
  }

  isStepDone(s: string): boolean {
    const order: CheckoutStep[] = ['address', 'carrier', 'summary'];
    return order.indexOf(s as CheckoutStep) < order.indexOf(this.step());
  }

  goToCarrier() {
    if (this.addressForm.invalid) return;
    this.step.set('carrier');
  }

  goToSummary() {
    if (!this.selectedCarrier()) return;
    if (this.selectedCarrier()!.code === CarrierCode.INPOST && !this.lockerCode()) return;
    this.step.set('summary');
  }

  placeOrder() {
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

    const order$ = this.http.post<any>(
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
    );

    order$.subscribe({
      next: (res) => {
        if (this.saveAddress() && this.auth.currentUser() && this.selectedSavedId() === null) {
          const isDefault = this.savedAddresses().length === 0;
          this.http
            .post(`${environment.apiUrl}/users/me/addresses`, { ...addrPayload, isDefault })
            .subscribe();
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
