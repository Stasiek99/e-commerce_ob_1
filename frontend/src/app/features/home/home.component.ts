import { Component, inject } from '@angular/core';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { AsyncPipe } from '@angular/common';
import { map } from 'rxjs/operators';
import { TuiButton } from '@taiga-ui/core';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink, AsyncPipe, TuiButton],
  template: `
    <section class="hero">
      <h1>Odkryj świat wyjątkowych zapachów</h1>
      <p>Ekskluzywne perfumy i dyfuzory do Twojego domu</p>
      <a routerLink="/products" tuiButton  appearance="outline" type="button" size="l">Przeglądaj kolekcję</a>
    </section>
    @if (showDebug$ | async) {
      <div class="debug-sentry">
        <button (click)="throwFrontendError()">Throw frontend error (Sentry)</button>
      </div>
    }
  `,
  styles: [`
    .hero {
      text-align: center;
      padding: 96px 16px;
    }
    h1 { font-size: clamp(24px, 6vw, 42px); font-weight: 700; margin-bottom: 16px; line-height: 1.2; }
    p { font-size: clamp(15px, 2.5vw, 18px); color: var(--color-secondary); margin-bottom: 32px; }
    @media (max-width: 480px) {
      .hero { padding: 56px 0; }
    }
    .debug-sentry {
      position: fixed;
      bottom: 16px;
      right: 16px;
      z-index: 9999;
    }
    .debug-sentry button {
      background: var(--color-error);
      color: white;
      border: none;
      padding: 10px 16px;
      border-radius: var(--border-radius-md);
      cursor: pointer;
      font-size: 13px;
    }
  `],
})
export class HomeComponent {
  private route = inject(ActivatedRoute);

  showDebug$ = this.route.queryParamMap.pipe(
    map(params => params.get('debug') === 'sentry'),
  );

  throwFrontendError() {
    throw new Error('Sentry frontend test — intentional error');
  }
}
