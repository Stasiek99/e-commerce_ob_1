import { Component, inject, signal, computed } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, FormControl, FormGroup, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { TuiButton, TuiIcon, TuiLabel, TuiTextfield } from '@taiga-ui/core';
import { TuiCheckbox, TuiTextarea } from '@taiga-ui/kit';
import { environment } from '../../../../environments/environment';

const WITHDRAWAL_DEADLINE_DAYS = 14;

@Component({
  selector: 'app-return-request',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, DatePipe, TuiButton, TuiCheckbox, TuiIcon, TuiLabel, TuiTextfield, TuiTextarea],
  template: `
    <div class="page">
      <div class="page__inner">

        @if (submitted()) {
          <!-- ── Success ────────────────────────────────────────────── -->
          <div class="success">
            <tui-icon icon="@tui.check-circle" class="success__icon" />
            <h1 class="success__title">
              {{ submittedType() === 'WITHDRAWAL'
                  ? 'Oświadczenie o odstąpieniu przyjęte'
                  : 'Reklamacja przyjęta' }}
            </h1>
            @if (submittedType() === 'WITHDRAWAL') {
              <p class="success__legal">
                Niniejsze zgłoszenie stanowi jednoznaczne oświadczenie o odstąpieniu od umowy
                sprzedaży zgodnie z art.&nbsp;27 Ustawy z dnia 30 maja 2014&nbsp;r.
                o prawach konsumenta (Dz.U. 2014 poz. 827). Oświadczenie zostało złożone
                w terminie 14 dni od odbioru towaru.
              </p>
            }
            <p class="success__text">
              Potwierdzenie wysłaliśmy na podany adres e-mail. Numer zgłoszenia:
            </p>
            <div class="success__ref">{{ requestId() }}</div>
            @if (submittedType() === 'WITHDRAWAL') {
              <p class="success__text">
                Zwrot płatności nastąpi nie później niż <strong>14 dni</strong>
                od dnia, w którym otrzymamy towar lub dowód jego nadania.
              </p>
            } @else {
              <p class="success__text">
                Odpowiemy na reklamację w ciągu <strong>14 dni</strong> od jej otrzymania.
                Brak odpowiedzi w tym terminie oznacza uznanie reklamacji
                (art.&nbsp;7a Ustawy o prawach konsumenta).
              </p>
            }
            <a routerLink="/" tuiButton appearance="primary" size="m" class="success__btn">
              Wróć do sklepu
            </a>
          </div>

        } @else {
          <!-- ── Form ──────────────────────────────────────────────── -->
          <header class="page__header">
            <h1 class="page__title">Zwrot / Reklamacja</h1>
            <p class="page__subtitle">
              Zgodnie z Ustawą z dnia 30 maja 2014&nbsp;r. o prawach konsumenta
              (Dz.U. 2014 poz. 827). Odpiszemy w ciągu 2 dni roboczych.
            </p>
          </header>

          <form class="form" [formGroup]="form" (ngSubmit)="submit()">

            <!-- ── 1. Return type ─────────────────────────────────── -->
            <fieldset class="fieldset">
              <legend class="fieldset__legend">Rodzaj zgłoszenia *</legend>
              <div class="radio-group">
                <label class="radio-option"
                       [class.radio-option--active]="form.value.type === 'WITHDRAWAL'">
                  <input type="radio" formControlName="type" value="WITHDRAWAL" class="sr-only" />
                  <span class="radio-option__title">Odstąpienie od umowy</span>
                  <span class="radio-option__desc">
                    Rezygnacja z zakupu w ciągu 14 dni od odbioru — bez podania przyczyny
                    (art.&nbsp;27 Ustawy o prawach konsumenta)
                  </span>
                </label>
                <label class="radio-option"
                       [class.radio-option--active]="form.value.type === 'COMPLAINT'">
                  <input type="radio" formControlName="type" value="COMPLAINT" class="sr-only" />
                  <span class="radio-option__title">Reklamacja (rękojmia)</span>
                  <span class="radio-option__desc">
                    Produkt jest wadliwy lub niezgodny z opisem
                    (art.&nbsp;43a–43g Ustawy o prawach konsumenta)
                  </span>
                </label>
              </div>
            </fieldset>

            <!-- ── Sealed product warning (WITHDRAWAL only) ────────── -->
            @if (form.value.type === 'WITHDRAWAL') {
              <div class="alert alert--warning">
                <tui-icon icon="@tui.triangle-alert" class="alert__icon" />
                <div>
                  <p class="alert__title">
                    Ważne — wyjątek dla produktów higienicznych (art.&nbsp;38 pkt&nbsp;5)
                  </p>
                  <p class="alert__body">
                    Prawo odstąpienia <strong>nie przysługuje</strong> dla perfum,
                    kosmetyków i produktów do pielęgnacji ciała dostarczonych
                    w zapieczętowanym opakowaniu, <strong>jeżeli opakowanie zostało otwarte
                    po dostarczeniu</strong>. Zwroty przyjmujemy wyłącznie w oryginalnym,
                    nienaruszonym opakowaniu z nienaruszoną folią/plombą.
                  </p>
                </div>
              </div>
            }

            <!-- ── 2. Order details ──────────────────────────────── -->
            <div class="section">
              <h2 class="section__title">Dane zamówienia</h2>
              <div class="row-2">
                <div>
                  <tui-textfield>
                    <label tuiLabel>Numer zamówienia *</label>
                    <input tuiTextfield type="text" formControlName="orderNumber"
                           placeholder="np. ORD-2025-001" autocomplete="off" />
                  </tui-textfield>
                  @if (touched('orderNumber')) {
                    <p class="field-error" role="alert">Podaj numer zamówienia</p>
                  }
                </div>
                <div>
                  <tui-textfield>
                    <label tuiLabel>E-mail użyty przy zamówieniu *</label>
                    <input tuiTextfield type="email" formControlName="email"
                           autocomplete="email" />
                  </tui-textfield>
                  @if (touched('email')) {
                    <p class="field-error" role="alert">Podaj prawidłowy adres e-mail</p>
                  }
                </div>
              </div>

              <!-- Delivery date — establishes 14-day window (Art. 28) -->
              <div>
                <tui-textfield>
                  <label tuiLabel>
                    Data odbioru towaru *
                    @if (form.value.type === 'WITHDRAWAL') {
                      <span class="label-hint"> — wymagana do weryfikacji terminu</span>
                    }
                  </label>
                  <input tuiTextfield type="date" formControlName="deliveryDate"
                         [max]="today" />
                </tui-textfield>
                @if (touched('deliveryDate')) {
                  <p class="field-error" role="alert">Podaj datę odbioru towaru</p>
                }

                <!-- 14-day deadline status -->
                @if (form.value.type === 'WITHDRAWAL' && form.value.deliveryDate) {
                  @if (deadlineStatus() === 'expired') {
                    <div class="deadline deadline--expired">
                      <tui-icon icon="@tui.x-circle" />
                      Termin na odstąpienie upłynął
                      {{ deadlineDate() | date:'d MMMM yyyy' : '' : 'pl' }}.
                      Złożenie zgłoszenia po terminie nie jest skuteczne prawnie.
                    </div>
                  } @else if (deadlineStatus() === 'urgent') {
                    <div class="deadline deadline--urgent">
                      <tui-icon icon="@tui.triangle-alert" />
                      Termin upływa {{ deadlineDate() | date:'d MMMM yyyy' : '' : 'pl' }}
                      (pozostało {{ daysLeft() }} {{ daysLeft() === 1 ? 'dzień' : 'dni' }}).
                    </div>
                  } @else if (deadlineStatus() === 'ok') {
                    <div class="deadline deadline--ok">
                      <tui-icon icon="@tui.check-circle" />
                      W terminie — ostatni dzień na zgłoszenie:
                      {{ deadlineDate() | date:'d MMMM yyyy' : '' : 'pl' }}.
                    </div>
                  }
                }
              </div>
            </div>

            <!-- ── 3. Contact details ─────────────────────────────── -->
            <div class="section">
              <h2 class="section__title">Dane kontaktowe</h2>
              <div class="row-2">
                <div>
                  <tui-textfield>
                    <label tuiLabel>Imię *</label>
                    <input tuiTextfield type="text" formControlName="firstName"
                           autocomplete="given-name" />
                  </tui-textfield>
                  @if (touched('firstName')) {
                    <p class="field-error" role="alert">Podaj imię</p>
                  }
                </div>
                <div>
                  <tui-textfield>
                    <label tuiLabel>Nazwisko *</label>
                    <input tuiTextfield type="text" formControlName="lastName"
                           autocomplete="family-name" />
                  </tui-textfield>
                  @if (touched('lastName')) {
                    <p class="field-error" role="alert">Podaj nazwisko</p>
                  }
                </div>
              </div>
              <div class="row-2">
                <tui-textfield>
                  <label tuiLabel>Telefon</label>
                  <input tuiTextfield type="tel" formControlName="phone"
                         autocomplete="tel" placeholder="opcjonalnie" />
                </tui-textfield>
              </div>
            </div>

            <!-- ── 4. Products ────────────────────────────────────── -->
            <div class="section">
              <h2 class="section__title">Produkty do zwrotu *</h2>
              <div formArrayName="items" class="items-list">
                @for (group of typedItems; track $index) {
                  <div [formGroup]="group" class="item-row">
                    <div class="item-row__name">
                      <tui-textfield>
                        <label tuiLabel>Nazwa produktu</label>
                        <input tuiTextfield type="text" formControlName="productName"
                               placeholder="np. Perfumy Gold 50ml" />
                      </tui-textfield>
                    </div>
                    <div class="item-row__qty">
                      <tui-textfield>
                        <label tuiLabel>Ilość</label>
                        <input tuiTextfield type="number" formControlName="quantity"
                               min="1" max="99" />
                      </tui-textfield>
                    </div>
                    @if (items.length > 1) {
                      <button type="button" tuiButton appearance="ghost" size="s"
                              (click)="removeItem($index)"
                              aria-label="Usuń produkt">
                        <tui-icon icon="@tui.x" />
                      </button>
                    }
                  </div>
                }
              </div>
              <button type="button" tuiButton appearance="outline" size="s"
                      (click)="addItem()">
                + Dodaj produkt
              </button>
            </div>

            <!-- ── 5a. Seal confirmation (WITHDRAWAL) ─────────────── -->
            @if (form.value.type === 'WITHDRAWAL') {
              <div class="section">
                <label class="checkbox-row"
                       [class.checkbox-row--error]="sealError()">
                  <input type="checkbox" tuiCheckbox formControlName="sealIntact" />
                  <span>
                    Potwierdzam, że zwracane produkty posiadają <strong>nienaruszone,
                    oryginalne opakowanie</strong> z nietkniętą folią ochronną/plombą.
                    Rozumiem, że zwrot produktów z naruszonymi opakowaniami nie jest
                    możliwy na podstawie prawa odstąpienia od umowy.
                  </span>
                </label>
                @if (sealError()) {
                  <p class="field-error" role="alert">
                    Potwierdzenie stanu opakowania jest wymagane do złożenia odstąpienia
                  </p>
                }
              </div>
            }

            <!-- ── 5b. Requested resolution (COMPLAINT) ───────────── -->
            @if (form.value.type === 'COMPLAINT') {
              <div class="section">
                <h2 class="section__title">
                  Żądanie (art.&nbsp;43d Ustawy o prawach konsumenta) *
                </h2>
                <div class="radio-group radio-group--compact">
                  @for (opt of resolutionOptions; track opt.value) {
                    <label class="radio-option radio-option--sm"
                           [class.radio-option--active]="form.value.requestedResolution === opt.value">
                      <input type="radio" formControlName="requestedResolution"
                             [value]="opt.value" class="sr-only" />
                      <span class="radio-option__title">{{ opt.label }}</span>
                      <span class="radio-option__desc">{{ opt.desc }}</span>
                    </label>
                  }
                </div>
                @if (touched('requestedResolution') && !form.value.requestedResolution) {
                  <p class="field-error" role="alert">Wybierz żądanie</p>
                }
              </div>
            }

            <!-- ── 6. Description ─────────────────────────────────── -->
            <div class="section">
              <h2 class="section__title">
                {{ form.value.type === 'COMPLAINT' ? 'Opis wady / niezgodności *' : 'Powód (opcjonalnie)' }}
              </h2>
              <tui-textfield>
                <textarea tuiTextarea formControlName="reason"
                          maxlength="2000"
                          [placeholder]="form.value.type === 'COMPLAINT'
                            ? 'Opisz wadę lub niezgodność towaru z umową…'
                            : 'Opcjonalnie — możesz podać powód rezygnacji'"
                          style="min-height: 100px;"></textarea>
              </tui-textfield>
              @if (form.value.type === 'COMPLAINT' && touched('reason') && !form.value.reason) {
                <p class="field-error" role="alert">Opisz wadę produktu</p>
              }
            </div>

            <!-- ── 7. Bank account (WITHDRAWAL) ──────────────────── -->
            @if (form.value.type === 'WITHDRAWAL') {
              <div class="section">
                <h2 class="section__title">Numer konta do zwrotu środków</h2>
                <tui-textfield>
                  <label tuiLabel>Numer rachunku bankowego (IBAN)</label>
                  <input tuiTextfield type="text" formControlName="bankAccount"
                         placeholder="PL00 0000 0000 0000 0000 0000 0000"
                         autocomplete="off" />
                </tui-textfield>
                <p class="field-hint">
                  Jeśli płaciłeś/aś kartą lub BLIK, zwrot trafi automatycznie na
                  pierwotną metodę płatności — numer konta nie jest wtedy potrzebny.
                  Podaj go tylko, jeśli preferujesz przelew bankowy.
                </p>
              </div>
            }

            <!-- ── 8. RODO consent ────────────────────────────────── -->
            <div class="section">
              <label class="checkbox-row"
                     [class.checkbox-row--error]="touched('rodoConsent') && form.get('rodoConsent')?.invalid">
                <input type="checkbox" tuiCheckbox formControlName="rodoConsent" />
                <span>
                  Wyrażam zgodę na przetwarzanie moich danych osobowych przez Aromaterie
                  w celu rozpatrzenia zgłoszenia zwrotu/reklamacji, zgodnie z
                  <a routerLink="/legal/privacy" target="_blank">polityką prywatności</a>.
                  Podanie danych jest niezbędne do realizacji zgłoszenia. *
                </span>
              </label>
              @if (touched('rodoConsent') && form.get('rodoConsent')?.invalid) {
                <p class="field-error" role="alert">Zgoda na przetwarzanie danych jest wymagana</p>
              }
            </div>

            @if (serverError()) {
              <p class="server-error">{{ serverError() }}</p>
            }

            <div class="form__footer">
              <p class="form__legal">
                Zapoznaj się z naszą
                <a routerLink="/legal/withdrawal" target="_blank">polityką zwrotów</a>
                przed wysłaniem zgłoszenia.
              </p>
              <button tuiButton type="submit" appearance="primary" size="l"
                      [disabled]="submitting() || deadlineStatus() === 'expired'">
                {{ submitting() ? 'Wysyłanie…' : 'Wyślij zgłoszenie' }}
              </button>
            </div>

          </form>
        }

      </div>
    </div>
  `,
  styles: [`
    .page { max-width: 700px; margin: 0 auto; padding: 40px 16px 80px; }
    .page__inner { display: flex; flex-direction: column; gap: 0; }
    .page__header { margin-bottom: 36px; }
    .page__title { font-size: clamp(22px, 5vw, 28px); font-weight: 700; margin: 0 0 10px; }
    .page__subtitle { font-size: 14px; color: var(--color-secondary); line-height: 1.6; margin: 0; }

    .form { display: flex; flex-direction: column; gap: 32px; }

    /* Return type */
    .fieldset { border: none; padding: 0; margin: 0; }
    .fieldset__legend {
      font-size: 12px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--color-secondary); margin-bottom: 12px; display: block;
    }
    .radio-group { display: flex; flex-direction: column; gap: 10px; }
    .radio-group--compact { gap: 8px; }
    .radio-option {
      display: flex; flex-direction: column; gap: 4px;
      border: 1px solid var(--color-border); border-radius: var(--border-radius-md);
      padding: 14px 16px; cursor: pointer; transition: border-color 0.15s;
    }
    .radio-option--sm { padding: 10px 14px; }
    .radio-option:hover { border-color: var(--color-primary); }
    .radio-option--active { border-color: var(--color-primary); background: #f8f8ff; }
    .radio-option__title { font-size: 14px; font-weight: 600; color: var(--color-primary); }
    .radio-option__desc { font-size: 13px; color: var(--color-secondary); line-height: 1.4; }

    /* Alert */
    .alert {
      display: flex; gap: 12px; padding: 14px 16px;
      border-radius: var(--border-radius-md); border: 1px solid;
    }
    .alert--warning { background: #fff8e1; border-color: #f59e0b; }
    .alert__icon { font-size: 20px; color: #b45309; flex-shrink: 0; margin-top: 2px; }
    .alert__title { font-size: 13px; font-weight: 700; color: #92400e; margin: 0 0 6px; }
    .alert__body { font-size: 13px; color: #78350f; line-height: 1.5; margin: 0; }

    /* Deadline indicator */
    .deadline {
      display: flex; align-items: flex-start; gap: 8px;
      font-size: 13px; line-height: 1.4; margin-top: 8px;
      padding: 10px 12px; border-radius: 6px;
    }
    .deadline tui-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
    .deadline--ok     { background: #e8f5e9; color: #2a7d4e; }
    .deadline--urgent { background: #fff8e1; color: #856404; }
    .deadline--expired { background: #fde8e8; color: #c0392b; font-weight: 600; }

    /* Sections */
    .section { display: flex; flex-direction: column; gap: 12px; }
    .section__title {
      font-size: 12px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--color-secondary); margin: 0;
    }

    .label-hint { font-size: 11px; color: var(--color-secondary); font-weight: 400; }

    /* Grid rows */
    .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

    /* Items list */
    .items-list { display: flex; flex-direction: column; gap: 10px; }
    .item-row { display: grid; grid-template-columns: 1fr 90px auto; gap: 10px; align-items: end; }
    /* Checkboxes */
    .checkbox-row {
      display: flex; align-items: flex-start; gap: 10px;
      font-size: 13px; line-height: 1.6; cursor: pointer;
      padding: 14px 16px; border: 1px solid var(--color-border);
      border-radius: var(--border-radius-md); transition: border-color 0.15s;
    }
    .checkbox-row:hover { border-color: var(--color-primary); }
    .checkbox-row--error { border-color: var(--color-error); background: #fff8f8; }
    .checkbox-row a { color: var(--color-primary); text-decoration: underline; }

    .field-error { font-size: 12px; color: var(--tui-status-negative, #d32f2f); margin: 4px 0 0; }
    .field-hint  { font-size: 12px; color: var(--color-secondary); margin: 4px 0 0; line-height: 1.5; }

    .server-error {
      font-size: 14px; color: var(--color-error);
      background: #fff0f0; border-radius: 6px; padding: 12px 16px; margin: 0;
    }

    .form__footer {
      display: flex; align-items: center; justify-content: space-between;
      gap: 16px; flex-wrap: wrap; padding-top: 8px;
    }
    .form__legal { font-size: 13px; color: var(--color-secondary); margin: 0; }
    .form__legal a { color: var(--color-primary); text-decoration: underline; }

    /* Success state */
    .success { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 48px 0; }
    .success__icon { font-size: 56px; color: var(--color-success); margin-bottom: 20px; }
    .success__title { font-size: 24px; font-weight: 700; margin: 0 0 16px; }
    .success__legal {
      font-size: 13px; color: var(--color-secondary); line-height: 1.7;
      max-width: 480px; margin: 0 0 20px;
      background: #f0f4ff; border-radius: 8px; padding: 14px 18px;
      border: 1px solid #c7d2fe; text-align: left;
    }
    .success__text { font-size: 15px; color: var(--color-secondary); line-height: 1.6; margin: 0 0 12px; max-width: 420px; }
    .success__ref {
      font-size: 20px; font-weight: 700; letter-spacing: 0.04em;
      background: #f9f9f9; border-radius: 8px; padding: 12px 24px;
      margin: 4px 0 20px; font-family: monospace;
    }
    .success__btn { margin-top: 8px; }

    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0; }

    @media (max-width: 540px) {
      .row-2 { grid-template-columns: 1fr; }
      .item-row { grid-template-columns: 1fr 70px auto; }
      .form__footer { flex-direction: column; align-items: flex-start; }
    }
  `],
})
export class ReturnRequestComponent {
  private readonly http = inject(HttpClient);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);

  readonly submitted = signal(false);
  readonly submitting = signal(false);
  readonly serverError = signal<string | null>(null);
  readonly requestId = signal<string | null>(null);
  readonly submittedType = signal<string | null>(null);

  readonly today = new Date().toISOString().split('T')[0];

  readonly resolutionOptions = [
    { value: 'REPAIR', label: 'Naprawa produktu', desc: 'Żądam usunięcia wady' },
    { value: 'REPLACEMENT', label: 'Wymiana na nowy', desc: 'Żądam wymiany na produkt wolny od wad' },
    { value: 'PRICE_REDUCTION', label: 'Obniżenie ceny', desc: 'Żądam stosownego obniżenia ceny' },
    { value: 'REFUND', label: 'Zwrot pieniędzy', desc: 'Odstępuję od umowy i żądam zwrotu zapłaconej kwoty' },
  ];

  readonly form = this.fb.group({
    type: ['WITHDRAWAL', Validators.required],
    orderNumber: ['', [Validators.required, Validators.maxLength(50)]],
    email: ['', [Validators.required, Validators.email, Validators.maxLength(200)]],
    deliveryDate: ['', Validators.required],
    firstName: ['', [Validators.required, Validators.maxLength(100)]],
    lastName: ['', [Validators.required, Validators.maxLength(100)]],
    phone: [''],
    items: this.fb.array([this.createItemGroup()]),
    sealIntact: [false],
    requestedResolution: [''],
    reason: ['', Validators.maxLength(2000)],
    bankAccount: ['', Validators.maxLength(34)],
    rodoConsent: [false, Validators.requiredTrue],
  });

  constructor() {
    // Pre-select type from ?type=withdrawal query param (linked from /legal/withdrawal).
    const typeParam = this.route.snapshot.queryParamMap.get('type');
    if (typeParam === 'withdrawal') {
      this.form.patchValue({ type: 'WITHDRAWAL' });
    } else if (typeParam === 'complaint') {
      this.form.patchValue({ type: 'COMPLAINT' });
    }
  }

  // ── Deadline calculation ──────────────────────────────────────────────────

  readonly deadlineDate = computed<Date | null>(() => {
    const d = this.form.get('deliveryDate')?.value;
    if (!d) return null;
    const dt = new Date(d);
    dt.setDate(dt.getDate() + WITHDRAWAL_DEADLINE_DAYS);
    return dt;
  });

  readonly daysLeft = computed<number>(() => {
    const dl = this.deadlineDate();
    if (!dl) return 0;
    return Math.ceil((dl.getTime() - Date.now()) / 86400000);
  });

  readonly deadlineStatus = computed<'ok' | 'urgent' | 'expired' | null>(() => {
    if (!this.deadlineDate()) return null;
    const left = this.daysLeft();
    if (left < 0) return 'expired';
    if (left <= 3) return 'urgent';
    return 'ok';
  });

  readonly sealError = computed(() =>
    this.form.value.type === 'WITHDRAWAL' &&
    this.form.touched &&
    !this.form.value.sealIntact,
  );

  // ── FormArray helpers ─────────────────────────────────────────────────────

  get items() {
    return this.form.controls.items;
  }

  // Typed view of items.controls — lets the template use [formGroup]="group"
  // so the Angular Language Service can statically resolve formControlName bindings.
  get typedItems(): FormGroup<{ productName: FormControl<string | null>; quantity: FormControl<number | null> }>[] {
    return this.items.controls as FormGroup<{ productName: FormControl<string | null>; quantity: FormControl<number | null> }>[];
  }

  createItemGroup() {
    return this.fb.group({
      productName: ['', [Validators.required, Validators.maxLength(200)]],
      quantity: [1, [Validators.required, Validators.min(1)]],
    });
  }

  addItem(): void {
    this.items.push(this.createItemGroup());
  }

  removeItem(i: number): void {
    this.items.removeAt(i);
  }

  touched(field: string): boolean {
    const ctrl = this.form.get(field);
    return !!(ctrl?.invalid && ctrl.touched);
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  submit(): void {
    this.form.markAllAsTouched();

    const isWithdrawal = this.form.value.type === 'WITHDRAWAL';

    if (isWithdrawal && !this.form.value.sealIntact) return;
    if (isWithdrawal && this.deadlineStatus() === 'expired') return;
    if (!isWithdrawal && !this.form.value.requestedResolution) return;
    if (this.form.invalid) return;

    this.submitting.set(true);
    this.serverError.set(null);

    const val = this.form.getRawValue();
    const payload = {
      type: val.type,
      orderNumber: val.orderNumber!.trim(),
      email: val.email!.trim(),
      deliveryDate: val.deliveryDate || undefined,
      firstName: val.firstName!.trim(),
      lastName: val.lastName!.trim(),
      phone: val.phone?.trim() || undefined,
      items: val.items!.map((i: any) => ({
        productName: i.productName.trim(),
        quantity: Number(i.quantity),
      })),
      reason: val.reason?.trim() || undefined,
      requestedResolution: val.requestedResolution || undefined,
      bankAccount: val.bankAccount?.trim() || undefined,
      ...(val.type === 'WITHDRAWAL' ? { sealedOnReturn: val.sealIntact === true } : {}),
    };

    this.http.post<{ id: string }>(`${environment.apiUrl}/returns`, payload).subscribe({
      next: (res) => {
        this.requestId.set(res.id);
        this.submittedType.set(val.type);
        this.submitted.set(true);
        this.submitting.set(false);
      },
      error: (err) => {
        const msg = err?.error?.message;
        this.serverError.set(
          typeof msg === 'string'
            ? msg
            : 'Nie udało się wysłać zgłoszenia. Spróbuj ponownie lub napisz na zwroty@aromaterie.pl.',
        );
        this.submitting.set(false);
      },
    });
  }
}
