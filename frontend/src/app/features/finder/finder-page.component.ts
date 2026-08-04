import { Component, OnInit, inject } from "@angular/core";
import { RouterLink } from "@angular/router";
import { TuiButton } from "@taiga-ui/core";
import { FragranceFinderComponent } from "../../shared/components/fragrance-finder/fragrance-finder.component";
import {
  Breadcrumb,
  BreadcrumbComponent,
} from "../../shared/components/breadcrumb/breadcrumb.component";
import { SeoService } from "../../core/services/seo.service";

/**
 * Standalone landing page for the fragrance picker.
 *
 * Exists as its own route rather than only as a dialog because this is the page
 * that has to rank for "jaki zapach dla mnie" / "dobór perfum" — informational
 * queries that never land on a product page. It is prerendered (see
 * frontend/prerender-routes.txt), so the copy below is in the static HTML; the
 * interactive picker hydrates on top.
 */
@Component({
  selector: "app-finder-page",
  standalone: true,
  imports: [
    RouterLink,
    TuiButton,
    FragranceFinderComponent,
    BreadcrumbComponent,
  ],
  template: `
    <div class="page">
      <app-breadcrumb [crumbs]="breadcrumbs" />

      <header class="page__header">
        <h1 class="page__title">Dobierz zapach dla siebie</h1>
        <p class="page__lead">
          Nasze zapachy noszą własne nazwy, więc sama nazwa niewiele mówi.
          Powiedz nam, co lubisz — wpisz perfumy, które znasz, albo zaznacz nuty
          zapachowe, a pokażemy Ci dopasowane propozycje z katalogu.
        </p>
      </header>

      <!-- Projected into the picker's query row so it lands level with the search
           field, filling the right gutter that is otherwise empty on wide
           screens. Kept out of the page shell on purpose: positioning it from
           here would mean hard-coding the height of the copy above. -->
      <app-fragrance-finder [limit]="12">
        <a
          finderAside
          routerLink="/products"
          tuiButton
          appearance="outline"
          size="m"
        >
          Albo przeglądaj cały katalog
        </a>
      </app-fragrance-finder>
    </div>
  `,
  styles: [
    `
      .page {
        max-width: var(--max-width, 1280px);
        margin: 0 auto;
        padding: var(--spacing-md) 24px var(--spacing-xl);
        display: flex;
        flex-direction: column;
        gap: var(--spacing-lg);
      }
      .page__header {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .page__title {
        margin: 0;
        font-size: clamp(28px, 4vw, 44px);
        line-height: 1.15;
        color: var(--color-primary);
      }
      .page__lead {
        margin: 0;
        max-width: 68ch;
        color: var(--color-secondary);
        line-height: 1.7;
      }
      @media (max-width: 768px) {
        .page {
          padding-inline: 16px;
        }
      }
    `,
  ],
})
export class FinderPageComponent implements OnInit {
  private readonly seo = inject(SeoService);

  readonly breadcrumbs: Breadcrumb[] = [
    { label: "Strona główna", link: "/" },
    { label: "Dobierz zapach" },
  ];

  ngOnInit(): void {
    this.seo.updatePageMeta({
      title: "Dobierz zapach dla siebie — asystent wyboru perfum",
      description:
        "Nie wiesz, jakie perfumy wybrać? Wpisz zapach, który znasz, albo zaznacz ulubione nuty zapachowe — dobierzemy dopasowane propozycje z naszego katalogu.",
      path: "/dobierz-zapach",
    });
  }
}
