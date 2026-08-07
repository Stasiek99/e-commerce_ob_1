import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  NgZone,
  PLATFORM_ID,
} from "@angular/core";
import { RouterLink } from "@angular/router";
import { isPlatformBrowser } from "@angular/common";
import { TuiButton } from "@taiga-ui/core";

@Component({
  selector: "app-home",
  standalone: true,
  imports: [RouterLink, TuiButton],
  template: `
    <!-- ── SCROLL EXPAND HERO ───────────────────────────────────────────── -->
    <div class="expand-wrap">
      <div class="expand-stage">
        <h1 class="expand-title">
          <span
            class="expand-title__word"
            [style.transform]="'translateX(-' + textTranslateX + 'vw)'"
          >
            Twój zapach.
          </span>
          <span
            class="expand-title__word"
            [style.transform]="'translateX(' + textTranslateX + 'vw)'"
          >
            Twoja historia.
          </span>
        </h1>

        <div
          class="expand-media"
          [style.width.px]="mediaWidth"
          [style.height.px]="mediaHeight"
        >
          <img
            class="expand-media__img"
            src="/assets/images/chogan_cover_3.webp"
            alt="Perfumy Chogan"
            width="1024"
            height="577"
            fetchpriority="high"
            decoding="sync"
          />
          <div
            class="expand-media__overlay"
            [style.opacity]="overlayOpacity"
          ></div>
        </div>

        @if (!mediaFullyExpanded) {
          <button
            class="expand-hint"
            type="button"
            [style.opacity]="hintOpacity"
            (click)="expandHero()"
            aria-label="Przewijaj, aby odkryć — kliknij lub naciśnij Enter, aby rozwinąć kolekcję"
          >
            Przewijaj, aby odkryć
          </button>
        }
      </div>
    </div>

    <!-- ── CONTENT ──────────────────────────────────────────────────────────
         Always rendered visible: this used to stay opacity: 0 + inert until
         showContent flipped true from the scroll-hijack handlers below, which
         meant the prerendered HTML for "/" — the exact bytes Vercel's CDN
         serves before any JS runs — shipped with the entire shop inert and
         invisible. A user whose JS fails, and any crawler that doesn't
         execute it, saw only the hero and nothing else. The hero's own
         scroll-driven expand animation is untouched; only the gate on the
         content below it is gone. -->
    <div class="expand-content">
      <!-- FOR HER + FOR HIM side by side -->
      <div class="feature-duo">
        <section class="category-card category-card--women">
          <div class="category-card__media">
            <img
              class="category-card__image"
              src="https://cdn.chogangroupspa.com/images/prodotti/big/PR17629397610donna70ml.jpg"
              alt="Perfumy Dla Niej 70ml"
              loading="lazy"
              width="320"
              height="420"
            />
          </div>
          <div class="category-card__content">
            <span class="category-card__eyebrow">Kolekcja Dla Niej</span>
            <h2 class="category-card__title">
              Elegancja<br />zamknięta we flakonie.
            </h2>
            <p class="category-card__sub">
              Delikatne, zmysłowe i niezapomniane. Odkryj zapachy, które
              podkreślą Twoją wyjątkowość.
            </p>
            <a
              routerLink="/category/perfume"
              [queryParams]="{ gender: ['Kobieta', 'Unisex'] }"
              tuiButton
              appearance="outline"
              size="m"
              type="button"
              >Przeglądaj</a
            >
          </div>
        </section>

        <section class="category-card category-card--men">
          <div class="category-card__media">
            <img
              class="category-card__image"
              src="https://cdn.chogangroupspa.com/images/prodotti/big/PR17627884550uomo70ml.jpg"
              alt="Perfumy Dla Niego 70ml"
              loading="lazy"
              width="320"
              height="420"
            />
          </div>
          <div class="category-card__content">
            <span class="category-card__eyebrow">Kolekcja Dla Niego</span>
            <h2 class="category-card__title">
              Charakter<br />bez kompromisów.
            </h2>
            <p class="category-card__sub">
              Intensywne, wyraziste, zapadające w pamięć. Zapachy dla mężczyzny,
              który wie, czego chce.
            </p>
            <a
              routerLink="/category/perfume"
              [queryParams]="{ gender: ['Mężczyzna', 'Unisex'] }"
              tuiButton
              appearance="outline"
              size="m"
              type="button"
              >Odkryj kolekcję</a
            >
          </div>
        </section>
      </div>

      <!-- FRAGRANCE FINDER.
           Reuses the .showcase block wholesale (same content/media grid, same
           type scale, same hover on the bottle) rather than restating those
           rules — a copied set would drift the first time the showcases are
           retouched. Only the background and the gels-style content/media
           padding are variant-specific.

           Sits right after the two collection blocks: a visitor who did not
           recognise themselves in "dla niej"/"dla niego" is exactly the one who
           needs the picker, and our product names ("Aqua Soul") tell them
           nothing on their own. Links to the dedicated page instead of embedding
           the widget — the home route is prerendered and must stay light. -->
      <section class="showcase showcase--finder">
        <div class="showcase__content">
          <span class="showcase__eyebrow">Nie wiesz, co wybrać?</span>
          <h2 class="showcase__title">Dobierzemy zapach<br />za Ciebie.</h2>
          <p class="showcase__subtitle">
            Wpisz nazwę perfum, które znasz — znajdziemy coś o podobnym
            charakterze. Albo zaznacz nuty, które lubisz, a my dopasujemy
            resztę.
          </p>
          <a
            routerLink="/dobierz-zapach"
            tuiButton
            appearance="outline"
            size="m"
            type="button"
            >Dobierz zapach</a
          >
        </div>
        <div class="showcase__media">
          <img
            class="showcase__image"
            src="/assets/images/perfum_luxury_white.webp"
            alt="Prezenty Luxury"
            loading="lazy"
            decoding="async"
            width="1080"
            height="1080"
          />
        </div>
      </section>

      <!-- DIFFUSERS showcase -->
      <section class="showcase showcase--diffusers">
        <div class="showcase__media">
          <img
            class="showcase__image"
            src="https://cdn.chogangroupspa.com/images/prodotti/big/PR16869083910.jpeg"
            alt="Dyfuzor zapachowy"
            loading="lazy"
            decoding="async"
            width="1080"
            height="1080"
          />
        </div>
        <div class="showcase__content">
          <span class="showcase__eyebrow">Dom, który pachnie</span>
          <h2 class="showcase__title">Dyfuzory<br />zapachowe.</h2>
          <p class="showcase__subtitle">
            Stwórz wyjątkowy klimat w każdym pomieszczeniu. Eleganckie
            kompozycje, które trwają tygodniami i zachwycają każdego gościa.
          </p>
          <a
            routerLink="/category/diffusers"
            tuiButton
            appearance="outline"
            size="m"
            type="button"
            >Zobacz dyfuzory</a
          >
        </div>
      </section>

      <!-- SHOWER GELS showcase -->
      <section class="showcase showcase--gels">
        <div class="showcase__content">
          <span class="showcase__eyebrow">Rytuał pielęgnacji</span>
          <h2 class="showcase__title">Żele pod<br />prysznic.</h2>
          <p class="showcase__subtitle">
            Poczuj luksus podczas każdej kąpieli. Nasze żele otulają skórę
            pięknym zapachem, który utrzymuje się przez cały dzień.
          </p>
          <a
            routerLink="/category/gels"
            tuiButton
            appearance="outline"
            size="m"
            type="button"
            >Zobacz żele</a
          >
        </div>
        <div class="showcase__media">
          <img
            class="showcase__image"
            src="https://cdn.chogangroupspa.com/images/prodotti/big/PR17074885170.jpg"
            alt="Żel pod prysznic"
            loading="lazy"
            decoding="async"
            width="1080"
            height="1080"
          />
        </div>
      </section>

      <!-- BESTSELLERS + GIFTS with luxury line images -->
      <div class="highlight-grid">
        <div class="category-card category-card--a">
          <div class="category-card__media">
            <img
              class="category-card__image"
              src="/assets/images/perfum_luxury_blue.webp"
              alt="Bestsellery Luxury"
              loading="lazy"
              decoding="async"
              width="800"
              height="800"
            />
          </div>
          <div class="category-card__content">
            <span class="category-card__eyebrow">Odkryj</span>
            <h3 class="category-card__title">Bestsellery</h3>
            <p class="category-card__sub">Zapachy, po które się wraca.</p>
            <a
              routerLink="/products"
              [queryParams]="{ featured: true }"
              tuiButton
              appearance="outline"
              size="m"
              type="button"
              >Przeglądaj</a
            >
          </div>
        </div>

        <div class="category-card category-card--c">
          <div class="category-card__media">
            <img
              class="category-card__image"
              src="https://cdn.chogangroupspa.com/images/prodotti/big/PR17633888000PR16982200610.jpg"
              alt="Flakon perfum Olfazeta Luxury"
              loading="lazy"
              decoding="async"
              width="1080"
              height="1080"
            />
          </div>
          <div class="category-card__content">
            <span class="category-card__eyebrow">Prezenty</span>
            <h3 class="category-card__title">Idealny<br />podarunek.</h3>
            <p class="category-card__sub">
              Ekskluzywne zapachy w pięknym opakowaniu.
            </p>
            <a
              routerLink="/products"
              tuiButton
              appearance="outline"
              size="m"
              type="button"
              >Odkryj kolekcję</a
            >
          </div>
        </div>
      </div>
    </div>

    @if (showDebug) {
      <div class="debug-sentry">
        <button (click)="throwFrontendError()">
          Throw frontend error (Sentry)
        </button>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
        --gutter: max(24px, calc((100vw - 1280px) / 2 + 24px));
        /* Breathing room around the hero image, applied to all four sides. */
        --hero-inset: clamp(12px, 2.5vw, 24px);
      }

      /* ── SCROLL EXPAND HERO (full-bleed) ───────────────────────────────── */
      .expand-wrap {
        width: 100vw;
        margin-left: calc(-50vw + 50%);
        overflow-x: hidden;
        position: relative;
        height: calc(100dvh - var(--chrome-height));
        display: flex;
        align-items: center;
        justify-content: center;
        background: #dad4cc;
      }

      .expand-stage {
        position: relative;
        z-index: 10;
        width: 100%;
        height: calc(100dvh - var(--chrome-height));
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
      }

      .expand-title {
        /* Semantic h1 now (was a div) — the page's only heading, needed for
         SEO on the one route that had none. Reset because the UA stylesheet's
         default h1 margin/font-size would otherwise throw off the flex
         centering below; the actual type scale lives on .expand-title__word. */
        margin: 0;
        font-size: inherit;
        font-weight: inherit;
        position: relative;
        z-index: 20;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        text-align: center;
        mix-blend-mode: difference;
        pointer-events: none;
      }
      .expand-title__word {
        display: block;
        /* The 42px floor made the longer of the two words 886px wide inside a
         360px viewport — silently cut off by .expand-wrap's overflow-x, so the
         page's opening sentence was unreadable on a phone. The words stay
         nowrap because the reveal slides them apart horizontally. */
        font-size: clamp(26px, 7vw, 100px);
        font-weight: 700;
        line-height: 1.05;
        letter-spacing: -0.03em;
        color: #fff;
        white-space: nowrap;
      }

      .expand-media {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 10;
        border-radius: 20px;
        overflow: hidden;
        box-shadow: 0 0 120px rgba(0, 0, 0, 0.6);
        /* Both axes inset by the same amount so the hero is framed evenly.
         The old pair (95vw / 85dvh) was only symmetric by coincidence: 85dvh
         happens to equal the stage height once --chrome-height is subtracted on
         a short viewport, so the image butted straight against the header and
         the section below while keeping visible side margins. */
        max-width: calc(100vw - 2 * var(--hero-inset));
        max-height: calc(100dvh - var(--chrome-height) - 2 * var(--hero-inset));
      }
      .expand-media__img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .expand-media__overlay {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.5);
        transition: opacity 0.08s linear;
      }

      .expand-hint {
        position: absolute;
        /* Anchored to the top of the stage, not the bottom: the cookie banner is
         fixed to the bottom of the viewport and covered the hint entirely on
         first load, which is exactly when the "scroll to reveal" affordance
         matters most. */
        top: 32px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 20;
        /* Sits over .expand-wrap's #dad4cc beige, above the media — never over
         the image — so white text scored 1.31:1. This is $color-primary at
         72%: still a quiet hint, but 6.3:1 against #dad4cc. */
        color: rgba(26, 26, 26, 0.72);
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        margin: 0;
        white-space: nowrap;
        transition: opacity 0.12s linear;
        background: none;
        border: none;
        cursor: pointer;
        padding: 0;
        font-family: inherit;
      }
      button.expand-hint:focus-visible {
        opacity: 1 !important;
        outline: 2px solid rgba(26, 26, 26, 0.72);
        outline-offset: 6px;
        border-radius: 2px;
      }

      /* ── CONTENT ────────────────────────────────────────────────────────── */
      .expand-content {
        width: 100vw;
        margin-left: calc(-50vw + 50%);
        background: #fff;
      }

      /* ── FEATURE SECTIONS ──────────────────────────────────────────────── */
      /* The "Dla Niej"/"Dla Niego" duo reuses .category-card wholesale (same
       media+content block, same 72vh/centering/gutter shape) — it used to be
       a hand-rolled twin with its own type scale and min-heights, which is
       exactly why its content sat at a different depth inside the box than
       .category-card's despite identical outer padding: two components,
       two independently-tuned content stacks, centered in the same fixed
       height. One component removes the drift by construction. */
      .feature-duo {
        display: grid;
        grid-template-columns: 1fr 1fr;
      }

      /* ── SHOWCASE SECTIONS ─────────────────────────────────────────────── */
      .showcase {
        display: grid;
        grid-template-columns: 1fr 1fr;
        /* min-height, not height: on shorter viewports (e.g. 14" laptops) a
         fixed 72vh clipped the image/copy against overflow: hidden instead of
         letting the row grow to fit them. */
        min-height: 72vh;
        overflow: hidden;
      }
      .showcase--diffusers {
        background: #eef2ee;
      }
      .showcase--gels {
        background: #eff4f8;
      }
      /* Own pastel rather than reusing the gels blue: this section sits directly
       under the cream/grey collection duo, and repeating a neighbour's tint
       would blur the boundary between two unrelated blocks. */
      .showcase--finder {
        background: #f1edf4;
      }

      .showcase__media {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 40px 40px;
        overflow: hidden;
      }
      .showcase__image {
        /* 60vh (not 55vh) is what puts the image's top edge the same ~56px from
         the section edge as .category-card--c's bottle — at 55vh the extra
         centering slack inside the 72vh row left a ~76px gap, noticeably
         airier than the two-up cards below it. Capped at 560px (60vh's value
         at the ~940px-tall viewport this was tuned on) so a very tall or
         portrait-rotated screen doesn't blow the bottle up disproportionately
         large — vh alone has no ceiling. */
        max-height: min(60vh, 560px);
        max-width: 100%;
        width: auto;
        object-fit: contain;
        mix-blend-mode: multiply;
        filter: drop-shadow(0 16px 32px rgba(0, 0, 0, 0.08));
        transition: transform 0.55s cubic-bezier(0.25, 0.46, 0.45, 0.94);
      }
      .showcase__image:hover {
        transform: translateY(-8px);
      }

      .showcase__content {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        justify-content: center;
        padding: 40px 40px;
      }
      .showcase--diffusers .showcase__media {
        padding-left: var(--gutter);
      }
      .showcase--diffusers .showcase__content {
        padding-right: calc(var(--gutter) + 40px);
      }
      .showcase--gels .showcase__content {
        padding-left: calc(var(--gutter) + 40px);
        align-items: flex-end;
        text-align: right;
      }
      .showcase--gels .showcase__media {
        padding-right: var(--gutter);
      }
      /* Same hand as the gels block: copy column left, bottle right. Alternates
       against the diffusers section that follows it. */
      .showcase--finder .showcase__content {
        padding-left: calc(var(--gutter) + 40px);
        align-items: flex-end;
        text-align: right;
      }
      .showcase--finder .showcase__media {
        padding-right: var(--gutter);
      }

      .showcase__eyebrow {
        display: block;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        margin-bottom: 16px;
        color: var(--color-accent-text);
      }
      .showcase__title {
        font-size: clamp(22px, 2.4vw, 38px);
        font-weight: 700;
        line-height: 1.08;
        letter-spacing: -0.03em;
        color: #1a1a1a;
        margin: 0 0 18px;
      }
      .showcase__subtitle {
        font-size: clamp(13px, 1.3vw, 15px);
        color: #6b6b6b;
        line-height: 1.65;
        margin: 0 0 36px;
        max-width: 44ch;
      }

      /* ── HIGHLIGHT GRID ────────────────────────────────────────────────── */
      .highlight-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
      }

      /* ── CATEGORY GRID (kept for compatibility) ─────────────────────────── */
      .category-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
      }
      .category-card {
        /* min-height, not height: same reasoning as .showcase above — a fixed
         72vh clipped the bottle/copy on shorter viewports instead of growing. */
        min-height: 72vh;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 20px;
        padding: 40px;
        text-align: center;
        overflow: hidden;
      }
      /* Same rule for both grids — a card grid is a card grid regardless of
       whether it holds the "Dla Niej/Dla Niego" duo or the bestseller pair. */
      .feature-duo > :first-child,
      .highlight-grid > :first-child {
        padding-left: var(--gutter);
      }
      .feature-duo > :last-child,
      .highlight-grid > :last-child {
        padding-right: var(--gutter);
      }
      .category-card--women {
        background: #f9f5f0;
      }
      .category-card--men {
        background: #f2f2f4;
      }
      .category-card--a {
        background: #fafafa;
      }
      .category-card--b {
        background: #f7f2ec;
      }
      .category-card--c {
        background: #f0ece6;
      }
      .category-card--d {
        background: #f5f5f7;
      }

      .category-card__media {
        /* Capped to match .category-card__image's own 300px ceiling below —
         otherwise on a very tall/portrait viewport the wrapper keeps growing
         with 32vh while the image inside stays clamped, opening up a large
         empty gap around it. */
        flex: 0 0 min(32vh, 300px);
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
      }
      .category-card__image {
        max-height: clamp(180px, 32vh, 300px);
        width: auto;
        object-fit: contain;
        mix-blend-mode: multiply;
        filter: drop-shadow(0 16px 28px rgba(0, 0, 0, 0.08));
        transition: transform 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94);
      }
      .category-card:hover .category-card__image {
        transform: translateY(-8px) scale(1.02);
      }

      .category-card__content {
        flex-shrink: 0;
        width: 100%;
      }
      .category-card__eyebrow {
        display: block;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        margin-bottom: 10px;
        color: var(--color-accent-text);
      }
      .category-card__title {
        font-size: clamp(22px, 3vw, 38px);
        font-weight: 700;
        line-height: 1.1;
        letter-spacing: -0.02em;
        color: #1a1a1a;
        margin: 0 0 10px;
        min-height: 2.2em;
      }
      .category-card__sub {
        font-size: 13px;
        line-height: 1.55;
        color: #6b6b6b;
        margin: 0 auto 22px;
        /* 40ch is where the longest copy on the page (the "Dla Niej"/"Dla Niego"
         blurbs) settles at the same 2-line height as the shorter bestseller/gift
         copy — below it they wrap to 3-4 lines and every card's content stack
         (and the top/bottom breathing room around it, since the block is
         vertically centered in a fixed-height row) stops matching. */
        max-width: 40ch;
        min-height: 3.1em;
      }

      /* ── RESPONSIVE ────────────────────────────────────────────────────── */
      /* Stacked, every section collapses to ONE shape: bottle on top in a
       fixed-height box, copy centered underneath. The three block types used to
       stack differently — features and cards centered, diffusers left-aligned,
       finder and gels right-aligned with the copy pulled above the bottle by an
       order:-1 — which read as four unrelated layouts scrolling past. The
       shared media height is what makes the bottles match: the vh-based caps
       they each carried rendered the showcase shots at roughly twice the size
       of the feature ones on the same screen. */
      @media (max-width: 900px) {
        :host {
          --product-media-h: clamp(200px, 60vw, 280px);
          --section-pad-y: 48px;
        }

        .feature-duo,
        .highlight-grid,
        .category-grid {
          grid-template-columns: 1fr;
        }

        .showcase,
        .category-card {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-start;
          height: auto;
          min-height: 0;
          gap: 28px;
          padding: var(--section-pad-y) var(--gutter);
          text-align: center;
        }

        .showcase__media,
        .category-card__media {
          order: -1;
          flex: none;
          width: 100%;
          height: var(--product-media-h);
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        /* Variant paddings are two-class selectors, so they outrank the grouped
         rule above and have to be cleared by name. */
        .showcase--diffusers .showcase__media,
        .showcase--gels .showcase__media,
        .showcase--finder .showcase__media {
          padding: 0;
        }

        .showcase__image,
        .category-card__image {
          height: 100%;
          width: auto;
          max-width: 100%;
          max-height: none;
          object-fit: contain;
        }

        .showcase__content,
        .category-card__content {
          order: 0;
          align-items: center;
          text-align: center;
          padding: 0;
          width: 100%;
        }
        .showcase--diffusers .showcase__content,
        .showcase--gels .showcase__content,
        .showcase--finder .showcase__content {
          order: 0;
          align-items: center;
          text-align: center;
          padding: 0;
        }

        .showcase__subtitle,
        .category-card__sub {
          margin-left: auto;
          margin-right: auto;
        }

        /* These minimums exist only to keep two side-by-side cards' buttons on a
         shared baseline. Stacked there is nothing to align against, so they are
         just dead vertical space. */
        .category-card__title,
        .category-card__sub {
          min-height: 0;
        }
      }

      @media (max-width: 600px) {
        :host {
          --section-pad-y: 36px;
        }
      }

      /* ── SHORT VIEWPORTS (e.g. 14" laptops) ───────────────────────────────
       Width alone doesn't catch this: a 14" laptop is well above the 900px
       layout breakpoint but has far less viewport height than the desktop
       this was tuned on, so the 72vh/60vh/32vh figures above left too little
       room for their own padding and got clipped by overflow: hidden. Gated
       to min-width: 901px so it never fights the stacked mobile layout,
       which already replaced these with height: auto. */
      @media (max-height: 860px) and (min-width: 901px) {
        .showcase,
        .category-card {
          min-height: 60vh;
        }
        .showcase__media,
        .showcase__content {
          padding-top: 36px;
          padding-bottom: 36px;
        }
        .category-card {
          /* .category-card's box grows to fit its content exactly (no extra
           centering slack, unlike .showcase's content column), so this
           padding is the entire top/bottom gap — 28px read as flush against
           the button. */
          padding-top: 36px;
          padding-bottom: 36px;
        }
        .showcase__image {
          max-height: 48vh;
        }
        .category-card__media {
          flex-basis: 26vh;
        }
        .category-card__image {
          max-height: clamp(150px, 26vh, 260px);
        }
      }

      /* ── REDUCED MOTION ────────────────────────────────────────────────── */
      @media (prefers-reduced-motion: reduce) {
        .expand-media__overlay,
        .showcase__image,
        .category-card__image {
          transition: none !important;
        }
      }

      /* ── DEBUG ─────────────────────────────────────────────────────────── */
      .debug-sentry {
        position: fixed;
        bottom: 16px;
        right: 16px;
        z-index: 9999;
      }
      .debug-sentry button {
        background: var(--color-error);
        color: #fff;
        border: none;
        padding: 10px 16px;
        border-radius: var(--border-radius-md);
        cursor: pointer;
        font-size: 13px;
      }
    `,
  ],
})
export class HomeComponent implements OnInit, OnDestroy {
  private ngZone = inject(NgZone);
  private platformId = inject(PLATFORM_ID);
  private isBrowser = isPlatformBrowser(this.platformId);

  scrollProgress = 0;
  mediaFullyExpanded = false;
  private touchStartY = 0;
  private isMobile = false;

  get mediaWidth() {
    return 300 + this.scrollProgress * (this.isMobile ? 620 : 1220);
  }
  get mediaHeight() {
    return 380 + this.scrollProgress * (this.isMobile ? 200 : 400);
  }
  get textTranslateX() {
    return this.scrollProgress * (this.isMobile ? 140 : 110);
  }
  get overlayOpacity() {
    return Math.max(0, 0.5 - this.scrollProgress * 0.35);
  }
  get hintOpacity() {
    return Math.max(0, 1 - this.scrollProgress * 5);
  }

  showDebug = false;
  throwFrontendError() {
    throw new Error("Sentry frontend test — intentional error");
  }

  private wheelHandler = (e: WheelEvent) => {
    if (this.mediaFullyExpanded && e.deltaY < 0 && window.scrollY <= 5) {
      e.preventDefault();
      this.ngZone.run(() => {
        this.mediaFullyExpanded = false;
      });
    } else if (!this.mediaFullyExpanded) {
      e.preventDefault();
      const next = Math.min(
        Math.max(this.scrollProgress + e.deltaY * 0.0009, 0),
        1,
      );
      this.ngZone.run(() => {
        this.scrollProgress = next;
        if (next >= 1) {
          this.mediaFullyExpanded = true;
        }
      });
    }
  };

  private scrollHandler = () => {
    if (!this.mediaFullyExpanded) window.scrollTo(0, 0);
  };

  private touchStartHandler = (e: TouchEvent) => {
    this.touchStartY = e.touches[0].clientY;
  };

  private touchMoveHandler = (e: TouchEvent) => {
    if (!this.touchStartY) return;
    const touchY = e.touches[0].clientY;
    const deltaY = this.touchStartY - touchY;
    if (this.mediaFullyExpanded && deltaY < -20 && window.scrollY <= 5) {
      e.preventDefault();
      this.ngZone.run(() => {
        this.mediaFullyExpanded = false;
      });
    } else if (!this.mediaFullyExpanded) {
      e.preventDefault();
      const factor = deltaY < 0 ? 0.008 : 0.005;
      const next = Math.min(
        Math.max(this.scrollProgress + deltaY * factor, 0),
        1,
      );
      this.ngZone.run(() => {
        this.scrollProgress = next;
        if (next >= 1) {
          this.mediaFullyExpanded = true;
        }
        this.touchStartY = touchY;
      });
    }
  };

  private touchEndHandler = () => {
    this.touchStartY = 0;
  };
  private resizeHandler = () => {
    this.ngZone.run(() => {
      this.isMobile = window.innerWidth < 768;
    });
  };

  expandHero() {
    this.ngZone.run(() => {
      this.scrollProgress = 1;
      this.mediaFullyExpanded = true;
    });
  }

  ngOnInit() {
    if (!this.isBrowser) return;
    this.isMobile = window.innerWidth < 768;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.scrollProgress = 1;
      this.mediaFullyExpanded = true;
      return;
    }
    window.scrollTo(0, 0);
    this.ngZone.runOutsideAngular(() => {
      window.addEventListener("wheel", this.wheelHandler as EventListener, {
        passive: false,
      });
      window.addEventListener("scroll", this.scrollHandler);
      window.addEventListener(
        "touchstart",
        this.touchStartHandler as EventListener,
        { passive: false },
      );
      window.addEventListener(
        "touchmove",
        this.touchMoveHandler as EventListener,
        { passive: false },
      );
      window.addEventListener("touchend", this.touchEndHandler);
      window.addEventListener("resize", this.resizeHandler);
    });
  }

  ngOnDestroy() {
    if (!this.isBrowser) return;
    window.removeEventListener("wheel", this.wheelHandler as EventListener);
    window.removeEventListener("scroll", this.scrollHandler);
    window.removeEventListener(
      "touchstart",
      this.touchStartHandler as EventListener,
    );
    window.removeEventListener(
      "touchmove",
      this.touchMoveHandler as EventListener,
    );
    window.removeEventListener("touchend", this.touchEndHandler);
    window.removeEventListener("resize", this.resizeHandler);
  }
}
