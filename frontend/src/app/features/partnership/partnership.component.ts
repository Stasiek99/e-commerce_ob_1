import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';
import { TuiButton, TuiLink } from '@taiga-ui/core';
import { BreadcrumbComponent } from '../../shared/components/breadcrumb/breadcrumb.component';

@Component({
  selector: 'app-partnership',
  standalone: true,
  imports: [TuiButton, TuiLink, BreadcrumbComponent],
  templateUrl: './partnership.component.html',
  styleUrl: './partnership.component.scss',
})
export class PartnershipComponent {
  private readonly bp = inject(BreakpointObserver);
  private readonly destroyRef = inject(DestroyRef);

  readonly crumbs = [
    { label: 'Strona główna', link: '/' },
    { label: 'Program partnerski Chogan' },
  ];

  buttonSize: 'l' | 'm' = 'l';

  constructor() {
    this.bp.observe('(max-width: 1000px)')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ matches }) => {
        this.buttonSize = matches ? 'm' : 'l';
      });
  }
}
