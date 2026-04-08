import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-addresses',
  standalone: true,
  template: `
    <div class="page">
      <h1>Adresy</h1>
      @for (addr of addresses(); track addr.id) {
        <div class="addr">
          <p><strong>{{ addr.firstName }} {{ addr.lastName }}</strong></p>
          <p>{{ addr.street }}, {{ addr.postalCode }} {{ addr.city }}</p>
          <p>Tel: {{ addr.phone }}</p>
          @if (addr.isDefault) { <span class="badge">Domyślny</span> }
        </div>
      } @empty {
        <p>Brak zapisanych adresów.</p>
      }
    </div>
  `,
  styles: [`
    .page { padding: 32px 0; }
    h1 { font-size: 24px; font-weight: 700; margin-bottom: 24px; }
    .addr { border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 16px; margin-bottom: 12px; }
    .addr p { font-size: 14px; margin: 2px 0; }
    .badge { background: var(--color-accent); color: white; padding: 2px 8px; border-radius: 999px; font-size: 11px; }
  `],
})
export class AddressesComponent implements OnInit {
  private readonly http = inject(HttpClient);
  readonly addresses = signal<any[]>([]);

  ngOnInit() {
    this.http
      .get<any[]>(`${environment.apiUrl}/users/me/addresses`)
      .subscribe({ next: (a) => this.addresses.set(a) });
  }
}
