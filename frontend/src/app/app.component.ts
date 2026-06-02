import { DOCUMENT } from '@angular/common';
import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationError, NavigationStart, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';
import { TuiRoot } from '@taiga-ui/core';
import { HeaderComponent } from './shared/components/header/header.component';
import { FooterComponent } from './shared/components/footer/footer.component';
import { CookieConsentComponent } from './shared/components/cookie-consent/cookie-consent.component';
import { AnnouncementBannerComponent } from './shared/components/announcement-banner/announcement-banner.component';
import { SeoService } from './core/services/seo.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, TuiRoot, HeaderComponent, FooterComponent, CookieConsentComponent, AnnouncementBannerComponent],
  template: `
    <tui-root>
      <app-announcement-banner />
      <app-header />
      <main>
        <router-outlet />
      </main>
      <app-footer />
      <app-cookie-consent />
    </tui-root>
  `,
  styles: [`
    main {
      min-height: calc(100vh - 64px - 120px);
      max-width: var(--max-width);
      margin: 0 auto;
      padding: 0 24px;
    }
  `],
})
export class AppComponent {
  private readonly router = inject(Router);
  private readonly seo = inject(SeoService);
  private readonly doc = inject(DOCUMENT);

  constructor() {
    this.seo.applyDefaults(this.router.url || '/');
    this.router.events
      .pipe(
        filter((e): e is NavigationStart => e instanceof NavigationStart),
        takeUntilDestroyed(),
      )
      .subscribe((e) => this.seo.applyDefaults(e.url));

    this.router.events
      .pipe(
        filter((e): e is NavigationError => e instanceof NavigationError),
        takeUntilDestroyed(),
      )
      .subscribe((e) => {
        const err = e.error as { name?: string; message?: string } | null;
        if (err?.name === 'ChunkLoadError' || err?.message?.includes('chunk')) {
          this.doc.defaultView?.location.reload();
        }
      });
  }
}
