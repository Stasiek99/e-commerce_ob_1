import { Component, Input } from "@angular/core";
import { RouterLink } from "@angular/router";
import { TuiLink } from "@taiga-ui/core";
import { TuiBreadcrumbs } from "@taiga-ui/kit";
import { TuiItem } from "@taiga-ui/cdk";

export interface Breadcrumb {
  label: string;
  link?: string;
}

@Component({
  selector: "app-breadcrumb",
  standalone: true,
  imports: [RouterLink, TuiLink, TuiBreadcrumbs, TuiItem],
  template: `
    <nav aria-label="Nawigacja strony">
      <tui-breadcrumbs>
        @for (crumb of crumbs; track $index; let last = $last) {
          @if (!last && crumb.link) {
            <a *tuiItem tuiLink [routerLink]="crumb.link">{{ crumb.label }}</a>
          } @else {
            <span *tuiItem aria-current="page">{{ crumb.label }}</span>
          }
        }
      </tui-breadcrumbs>
    </nav>
  `,
  styles: [
    `
      :host {
        display: block;
        margin-bottom: 16px;
      }
    `,
  ],
})
export class BreadcrumbComponent {
  @Input({ required: true }) crumbs: Breadcrumb[] = [];
}
