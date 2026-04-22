import { Component, OnInit, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Location } from '@angular/common';
import { TuiButton, TuiLabel, TuiTextfield, TuiIcon } from '@taiga-ui/core';
import { TuiCard, TuiForm } from '@taiga-ui/layout';
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
  imports: [ReactiveFormsModule, TuiButton, TuiLabel, TuiTextfield, TuiIcon, TuiCard, TuiForm],
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
            <tui-textfield>
              <label tuiLabel>Imię *</label>
              <input tuiTextfield type="text" formControlName="firstName" />
            </tui-textfield>
            <tui-textfield>
              <label tuiLabel>Nazwisko *</label>
              <input tuiTextfield type="text" formControlName="lastName" />
            </tui-textfield>
          </div>
          <tui-textfield>
            <label tuiLabel>Firma</label>
            <input tuiTextfield type="text" formControlName="company" />
          </tui-textfield>
          <tui-textfield>
            <label tuiLabel>Ulica i numer *</label>
            <input tuiTextfield type="text" formControlName="street" />
          </tui-textfield>
          <div class="name-row">
            <tui-textfield>
              <label tuiLabel>Kod pocztowy *</label>
              <input tuiTextfield type="text" formControlName="postalCode" placeholder="00-000" />
            </tui-textfield>
            <tui-textfield>
              <label tuiLabel>Miasto *</label>
              <input tuiTextfield type="text" formControlName="city" />
            </tui-textfield>
          </div>
          <tui-textfield>
            <label tuiLabel>Telefon *</label>
            <input tuiTextfield type="tel" formControlName="phone" />
          </tui-textfield>
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
      @for (addr of addresses(); track addr.id) {
        @if (editingId() === addr.id) {
          <form tuiCardLarge tuiForm appearance="elevated" data-size="l" data-space="normal"
                class="addr-form" [formGroup]="editForm" (ngSubmit)="submitEdit(addr.id)">
            <div class="name-row">
              <tui-textfield>
                <label tuiLabel>Imię *</label>
                <input tuiTextfield type="text" formControlName="firstName" />
              </tui-textfield>
              <tui-textfield>
                <label tuiLabel>Nazwisko *</label>
                <input tuiTextfield type="text" formControlName="lastName" />
              </tui-textfield>
            </div>
            <tui-textfield>
              <label tuiLabel>Firma</label>
              <input tuiTextfield type="text" formControlName="company" />
            </tui-textfield>
            <tui-textfield>
              <label tuiLabel>Ulica i numer *</label>
              <input tuiTextfield type="text" formControlName="street" />
            </tui-textfield>
            <div class="name-row">
              <tui-textfield>
                <label tuiLabel>Kod pocztowy *</label>
                <input tuiTextfield type="text" formControlName="postalCode" placeholder="00-000" />
              </tui-textfield>
              <tui-textfield>
                <label tuiLabel>Miasto *</label>
                <input tuiTextfield type="text" formControlName="city" />
              </tui-textfield>
            </div>
            <tui-textfield>
              <label tuiLabel>Telefon *</label>
              <input tuiTextfield type="tel" formControlName="phone" />
            </tui-textfield>
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
                class="btn-delete" [disabled]="!!working()" (click)="deleteAddr(addr.id)">
                Usuń
              </button>
            </div>
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

    .addr-form { display: flex; flex-direction: column; gap: 1rem; margin-bottom: 16px; }

    .addr-card { display: block; margin-bottom: 12px; }
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
    .form-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 8px; }

    .empty { color: var(--color-secondary); font-size: 14px; }
  `],
})
export class AddressesComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly location = inject(Location);

  readonly addresses   = signal<Address[]>([]);
  readonly showAddForm = signal(false);
  readonly editingId   = signal<string | null>(null);
  readonly adding      = signal(false);
  readonly saving      = signal(false);
  readonly working     = signal<string | null>(null);

  readonly addForm  = this.buildForm();
  readonly editForm = this.buildForm();

  private buildForm() {
    return this.fb.group({
      firstName:  ['', Validators.required],
      lastName:   ['', Validators.required],
      company:    [''],
      street:     ['', Validators.required],
      postalCode: ['', [Validators.required, Validators.pattern(/^\d{2}-\d{3}$/)]],
      city:       ['', Validators.required],
      phone:      ['', Validators.required],
    });
  }

  ngOnInit(): void { this.load(); }

  back(): void { this.location.back(); }

  private load(): void {
    this.http.get<Address[]>(`${environment.apiUrl}/users/me/addresses`)
      .subscribe({ next: (a) => this.addresses.set(a) });
  }

  openAddForm(): void { this.addForm.reset(); this.showAddForm.set(true); }
  cancelAdd():   void { this.showAddForm.set(false); this.addForm.reset(); }
  cancelEdit():  void { this.editingId.set(null); }

  submitAdd(): void {
    if (this.addForm.invalid) return;
    this.adding.set(true);
    this.http.post<Address>(`${environment.apiUrl}/users/me/addresses`, this.addForm.getRawValue()).subscribe({
      next: (addr) => {
        this.addresses.update((l) => [...l, addr]);
        this.showAddForm.set(false);
        this.addForm.reset();
        this.adding.set(false);
        this.toast.success('Adres zapisany');
      },
      error: () => { this.toast.error('Błąd zapisu adresu'); this.adding.set(false); },
    });
  }

  startEdit(addr: Address): void {
    this.editingId.set(addr.id);
    this.editForm.setValue({
      firstName:  addr.firstName,
      lastName:   addr.lastName,
      company:    addr.company ?? '',
      street:     addr.street,
      postalCode: addr.postalCode,
      city:       addr.city,
      phone:      addr.phone,
    });
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
        this.addresses.update((l) => l.map((a) => ({ ...a, isDefault: a.id === id })));
        this.working.set(null);
        this.toast.success('Adres domyślny zaktualizowany');
      },
      error: () => { this.toast.error('Błąd aktualizacji'); this.working.set(null); },
    });
  }

  deleteAddr(id: string): void {
    if (!confirm('Usunąć ten adres?')) return;
    this.working.set(id);
    this.http.delete(`${environment.apiUrl}/users/me/addresses/${id}`).subscribe({
      next: () => {
        this.addresses.update((l) => l.filter((a) => a.id !== id));
        this.working.set(null);
        this.toast.success('Adres usunięty');
      },
      error: () => { this.toast.error('Błąd usuwania adresu'); this.working.set(null); },
    });
  }
}
