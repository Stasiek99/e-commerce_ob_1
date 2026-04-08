import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="hero">
      <h1>Odkryj świat wyjątkowych zapachów</h1>
      <p>Ekskluzywne perfumy i dyfuzory do Twojego domu</p>
      <a routerLink="/products" class="btn-primary">Przeglądaj kolekcję</a>
    </section>
  `,
  styles: [`
    .hero {
      text-align: center;
      padding: 96px 0;
    }
    h1 { font-size: 42px; font-weight: 700; margin-bottom: 16px; }
    p { font-size: 18px; color: var(--color-secondary); margin-bottom: 32px; }
    .btn-primary {
      display: inline-block;
      background: var(--color-primary);
      color: white;
      padding: 14px 32px;
      border-radius: var(--radius-md);
      font-weight: 500;
      transition: opacity 0.15s;
    }
    .btn-primary:hover { opacity: 0.85; }
  `],
})
export class HomeComponent {}
