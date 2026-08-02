import { DOCUMENT } from '@angular/common';
import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationError, NavigationStart, Router, RouterOutlet } from '@angular/router';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs/operators';
import { TuiRoot } from '@taiga-ui/core';
import { HeaderComponent } from './shared/components/header/header.component';
import { FooterComponent } from './shared/components/footer/footer.component';
import { CookieConsentComponent } from './shared/components/cookie-consent/cookie-consent.component';
import { AnnouncementBannerComponent } from './shared/components/announcement-banner/announcement-banner.component';
import { SeoService } from './core/services/seo.service';
import { ToastService } from './core/services/toast.service';
import { environment } from '../environments/environment';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, TuiRoot, HeaderComponent, FooterComponent, CookieConsentComponent, AnnouncementBannerComponent],
  template: `
    <tui-root>
      <a href="#main-content" class="skip-link">Przejdź do treści</a>
      <app-announcement-banner />
      <app-header />
      <main id="main-content">
        <router-outlet />
      </main>
      <app-footer />
      <app-cookie-consent />
    </tui-root>
  `,
  styles: [`
    .skip-link {
      position: absolute;
      top: -100%;
      left: 0;
      padding: 12px 16px;
      min-height: 44px;
      display: inline-flex;
      align-items: center;
      background: #fff;
      color: #000;
      font-weight: 600;
      z-index: 9999;
      text-decoration: none;
      border: 2px solid #000;
      border-radius: 0 0 4px 0;
    }

    .skip-link:focus {
      top: 0;
    }

    main {
      min-height: calc(100vh - var(--header-height) - 120px);
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
  private readonly swUpdate = inject(SwUpdate);
  private readonly toast = inject(ToastService);

  constructor() {
    this.seo.applyDefaults(this.router.url || '/');
    this.seo.setOrganizationJsonLd(environment.seller);

    if (this.swUpdate.isEnabled) {
      this.swUpdate.versionUpdates
        .pipe(
          filter((evt): evt is VersionReadyEvent => evt.type === 'VERSION_READY'),
          takeUntilDestroyed(),
        )
        .subscribe(() => {
          this.toast.info(
            'Dostępna jest nowa wersja aplikacji — odśwież stronę, aby ją załadować.',
            8000,
          );
        });
    }
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
