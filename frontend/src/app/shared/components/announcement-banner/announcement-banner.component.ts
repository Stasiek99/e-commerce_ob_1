import { Component } from "@angular/core";
import { RouterLink } from "@angular/router";

@Component({
  selector: "app-announcement-banner",
  standalone: true,
  imports: [RouterLink],
  template: `
    <a class="announcement-banner" routerLink="/">
      <span class="announcement-banner__cta"
        >ZOSTAŃ PARTNEREM CHOGAN JUŻ TERAZ</span
      >
      <span class="announcement-banner__sep" aria-hidden="true">·</span>
      <span class="announcement-banner__sub">Kliknij i dołącz</span>
      <span class="announcement-banner__arrow" aria-hidden="true">→</span>
    </a>
  `,
  styles: [
    `
      .announcement-banner {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        width: 100%;
        padding: 10px 16px;
        background: #b72b55;
        color: #fff;
        text-decoration: none;
        font-family: var(--font-family-base), sans-serif;
        font-size: 0.8125rem;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        transition: background 0.2s ease;
        cursor: pointer;
      }

      .announcement-banner:hover {
        background: #9e2249;
        text-decoration: none;
      }

      .announcement-banner__cta {
        font-weight: 700;
      }

      .announcement-banner__sep {
        opacity: 0.55;
        font-size: 1rem;
      }

      .announcement-banner__sub {
        font-weight: 500;
        letter-spacing: 0.02em;
      }

      .announcement-banner__arrow {
        font-size: 1rem;
      }

      @media (max-width: 640px) {
        .announcement-banner__sub,
        .announcement-banner__sep {
          display: none;
        }
      }
    `,
  ],
})
export class AnnouncementBannerComponent {}
