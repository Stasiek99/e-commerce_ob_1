import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Meta } from '@angular/platform-browser';
import { TuiButton, TuiIcon } from '@taiga-ui/core';
import { SeoService } from '../../core/services/seo.service';

@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [RouterLink, TuiButton, TuiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page">
      <span class="page__code" aria-hidden="true">404</span>

      <tui-icon icon="@tui.search-x" class="page__icon" aria-hidden="true" />

      <h1 class="page__heading">Nie znaleziono strony</h1>
      <p class="page__desc">
        Strona, której szukasz, nie istnieje lub została przeniesiona.<br>
        Sprawdź adres URL lub skorzystaj z poniższych opcji.
      </p>

      <div class="page__actions">
        <a routerLink="/" tuiButton appearance="primary" size="l" type="button">
          Strona główna
        </a>
        <a routerLink="/products" tuiButton appearance="outline" size="l" type="button">
          <tui-icon icon="@tui.sparkles" />
          Przeglądaj produkty
        </a>
      </div>
    </div>
  `,
  styles: [`
    .page {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      padding: 80px 16px 96px;
      gap: 0;
    }

    .page__code {
      font-size: clamp(72px, 18vw, 140px);
      font-weight: 800;
      line-height: 1;
      color: var(--tui-text-tertiary, #ccc);
      letter-spacing: -0.04em;
      user-select: none;
    }

    .page__icon {
      font-size: 56px;
      color: var(--tui-text-secondary);
      margin: 8px 0 24px;
    }

    .page__heading {
      font-size: clamp(22px, 5vw, 28px);
      font-weight: 700;
      margin: 0 0 12px;
      color: var(--tui-text-primary);
    }

    .page__desc {
      color: var(--tui-text-secondary);
      font-size: 15px;
      line-height: 1.6;
      margin: 0 0 36px;
      max-width: 420px;
    }

    .page__actions {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      justify-content: center;
    }
  `],
})
export class NotFoundComponent implements OnInit {
  private readonly seo = inject(SeoService);
  private readonly meta = inject(Meta);

  ngOnInit(): void {
    this.seo.updatePageMeta({
      title: 'Nie znaleziono strony',
      description: 'Strona, której szukasz, nie istnieje lub została przeniesiona.',
      path: '/404',
    });
    this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });
  }
}
