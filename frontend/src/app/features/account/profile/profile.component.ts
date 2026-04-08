import { Component, inject } from '@angular/core';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  template: `
    <div class="page">
      <h1>Mój profil</h1>
      @if (auth.currentUser()) {
        <p>Email: {{ auth.currentUser()!.email }}</p>
        <p>Imię: {{ auth.currentUser()!.firstName ?? '—' }}</p>
        <p>Nazwisko: {{ auth.currentUser()!.lastName ?? '—' }}</p>
      }
    </div>
  `,
  styles: [`.page { padding: 32px 0; } h1 { font-size: 24px; font-weight: 700; margin-bottom: 24px; } p { font-size: 14px; margin-bottom: 8px; }`],
})
export class ProfileComponent {
  readonly auth = inject(AuthService);
}
