import { Component, OnInit, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { HttpClient } from '@angular/common/http';
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
  imports: [ReactiveFormsModule, NgTemplateOutlet],
  template: `
    <div class="page">
      <div class="header">
        <h1>Adresy dostawy</h1>
        @if (!showAddForm()) {
          <button class="btn btn--outline" (click)="openAddForm()">+ Dodaj adres</button>
        }
      </div>

      <!-- Add form -->
      @if (showAddForm()) {
        <div class="card card--form">
          <h2>Nowy adres</h2>
          <ng-container [ngTemplateOutlet]="addressForm"
            [ngTemplateOutletContext]="{ form: addForm, loading: adding() }" />
          <div class="form-actions">
            <button class="btn btn--outline" (click)="cancelAdd()" [disabled]="adding()">Anuluj</button>
            <button class="btn" (click)="submitAdd()" [disabled]="addForm.invalid || adding()">
              {{ adding() ? 'Zapisywanie…' : 'Zapisz adres' }}
            </button>
          </div>
        </div>
      }

      <!-- Address list -->
      @for (addr of addresses(); track addr.id) {
        <div class="card" [class.card--default]="addr.isDefault">
          @if (editingId() === addr.id) {
            <h2>Edytuj adres</h2>
            <ng-container [ngTemplateOutlet]="addressForm"
              [ngTemplateOutletContext]="{ form: editForm, loading: saving() }" />
            <div class="form-actions">
              <button class="btn btn--outline" (click)="cancelEdit()" [disabled]="saving()">Anuluj</button>
              <button class="btn" (click)="submitEdit(addr.id)" [disabled]="editForm.invalid || saving()">
                {{ saving() ? 'Zapisywanie…' : 'Zapisz zmiany' }}
              </button>
            </div>
          } @else {
            @if (addr.isDefault) {
              <span class="badge">Domyślny</span>
            }
            <p class="name">{{ addr.firstName }} {{ addr.lastName }}</p>
            @if (addr.company) { <p class="detail">{{ addr.company }}</p> }
            <p class="detail">{{ addr.street }}</p>
            <p class="detail">{{ addr.postalCode }} {{ addr.city }}</p>
            <p class="detail">Tel: {{ addr.phone }}</p>
            <div class="card-actions">
              @if (!addr.isDefault) {
                <button class="action-btn" (click)="setDefault(addr.id)" [disabled]="!!working()">
                  Ustaw jako domyślny
                </button>
              }
              <button class="action-btn" (click)="startEdit(addr)" [disabled]="!!working()">Edytuj</button>
              <button class="action-btn action-btn--danger" (click)="deleteAddr(addr.id)" [disabled]="!!working()">
                Usuń
              </button>
            </div>
          }
        </div>
      } @empty {
        @if (!showAddForm()) {
          <p class="empty">Nie masz jeszcze żadnych zapisanych adresów.</p>
        }
      }
    </div>

    <ng-template #addressForm let-form="form" let-loading="loading">
      <form [formGroup]="form">
        <div class="row">
          <div class="field">
            <label>Imię *</label>
            <input formControlName="firstName" class="input" />
          </div>
          <div class="field">
            <label>Nazwisko *</label>
            <input formControlName="lastName" class="input" />
          </div>
        </div>
        <div class="field">
          <label>Firma</label>
          <input formControlName="company" class="input" />
        </div>
        <div class="field">
          <label>Ulica i numer *</label>
          <input formControlName="street" class="input" />
        </div>
        <div class="row">
          <div class="field">
            <label>Kod pocztowy *</label>
            <input formControlName="postalCode" placeholder="00-000" class="input" />
          </div>
          <div class="field">
            <label>Miasto *</label>
            <input formControlName="city" class="input" />
          </div>
        </div>
        <div class="field">
          <label>Telefon *</label>
          <input formControlName="phone" type="tel" class="input" />
        </div>
      </form>
    </ng-template>
  `,
  styles: [`
    .page { padding: 32px 0; max-width: 560px; }
    .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
    h1 { font-size: 24px; font-weight: 700; }
    h2 { font-size: 17px; font-weight: 700; margin: 0 0 20px; }
    .card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 20px; margin-bottom: 12px; position: relative; }
    .card--default { border-color: var(--color-primary); }
    .card--form { margin-bottom: 20px; }
    .badge { display: inline-block; background: var(--color-primary); color: white; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; margin-bottom: 10px; }
    .name { font-weight: 600; font-size: 15px; margin: 0 0 4px; }
    .detail { font-size: 14px; color: var(--color-secondary); margin: 2px 0; }
    .card-actions { display: flex; gap: 12px; margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--color-border); }
    .action-btn { background: none; border: none; font-size: 13px; cursor: pointer; color: var(--color-primary); padding: 0; font-weight: 500; }
    .action-btn--danger { color: var(--color-error); margin-left: auto; }
    .action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .field { margin-bottom: 14px; }
    label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 4px; }
    .input { width: 100%; border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 9px 12px; font-size: 14px; outline: none; box-sizing: border-box; }
    .input:focus { border-color: var(--color-primary); }
    .form-actions { display: flex; gap: 12px; margin-top: 4px; }
    .btn { background: var(--color-primary); color: white; border: none; padding: 10px 22px; border-radius: var(--radius-md); font-size: 14px; font-weight: 600; cursor: pointer; }
    .btn--outline { background: transparent; color: var(--color-primary); border: 1px solid var(--color-primary); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .empty { color: var(--color-secondary); font-size: 14px; }
  `],
})
export class AddressesComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  readonly addresses = signal<Address[]>([]);
  readonly showAddForm = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly adding = signal(false);
  readonly saving = signal(false);
  readonly working = signal<string | null>(null);

  readonly addForm = this.buildForm();
  readonly editForm = this.buildForm();

  private buildForm() {
    return this.fb.group({
      firstName: ['', Validators.required],
      lastName: ['', Validators.required],
      company: [''],
      street: ['', Validators.required],
      postalCode: ['', [Validators.required, Validators.pattern(/^\d{2}-\d{3}$/)]],
      city: ['', Validators.required],
      phone: ['', Validators.required],
    });
  }

  ngOnInit() {
    this.load();
  }

  private load() {
    this.http
      .get<Address[]>(`${environment.apiUrl}/users/me/addresses`)
      .subscribe({ next: (a) => this.addresses.set(a) });
  }

  openAddForm() {
    this.addForm.reset();
    this.showAddForm.set(true);
  }

  cancelAdd() {
    this.showAddForm.set(false);
    this.addForm.reset();
  }

  submitAdd() {
    if (this.addForm.invalid) return;
    this.adding.set(true);
    this.http
      .post<Address>(`${environment.apiUrl}/users/me/addresses`, this.addForm.getRawValue())
      .subscribe({
        next: (addr) => {
          this.addresses.update((list) => [...list, addr]);
          this.showAddForm.set(false);
          this.addForm.reset();
          this.adding.set(false);
          this.toast.success('Adres zapisany');
        },
        error: () => {
          this.toast.error('Błąd zapisu adresu');
          this.adding.set(false);
        },
      });
  }

  startEdit(addr: Address) {
    this.editingId.set(addr.id);
    this.editForm.setValue({
      firstName: addr.firstName,
      lastName: addr.lastName,
      company: addr.company ?? '',
      street: addr.street,
      postalCode: addr.postalCode,
      city: addr.city,
      phone: addr.phone,
    });
  }

  cancelEdit() {
    this.editingId.set(null);
  }

  submitEdit(id: string) {
    if (this.editForm.invalid) return;
    this.saving.set(true);
    this.http
      .patch<Address>(`${environment.apiUrl}/users/me/addresses/${id}`, this.editForm.getRawValue())
      .subscribe({
        next: (updated) => {
          this.addresses.update((list) => list.map((a) => (a.id === id ? updated : a)));
          this.editingId.set(null);
          this.saving.set(false);
          this.toast.success('Adres zaktualizowany');
        },
        error: () => {
          this.toast.error('Błąd aktualizacji adresu');
          this.saving.set(false);
        },
      });
  }

  setDefault(id: string) {
    this.working.set(id);
    this.http
      .patch<Address>(`${environment.apiUrl}/users/me/addresses/${id}`, { isDefault: true })
      .subscribe({
        next: () => {
          this.addresses.update((list) =>
            list.map((a) => ({ ...a, isDefault: a.id === id })),
          );
          this.working.set(null);
          this.toast.success('Adres domyślny zaktualizowany');
        },
        error: () => {
          this.toast.error('Błąd aktualizacji');
          this.working.set(null);
        },
      });
  }

  deleteAddr(id: string) {
    if (!confirm('Usunąć ten adres?')) return;
    this.working.set(id);
    this.http
      .delete(`${environment.apiUrl}/users/me/addresses/${id}`)
      .subscribe({
        next: () => {
          this.addresses.update((list) => list.filter((a) => a.id !== id));
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
