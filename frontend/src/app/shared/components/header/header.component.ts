import {
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  inject,
  signal,
} from "@angular/core";
import { CdkTrapFocus } from "@angular/cdk/a11y";
import { RouterLink, Router, ActivatedRoute } from "@angular/router";
import { ReactiveFormsModule, FormControl } from "@angular/forms";
import { HttpClient } from "@angular/common/http";
import { debounceTime, distinctUntilChanged, map } from "rxjs";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import {
  TuiButton,
  TuiIcon,
  TuiDropdown,
  TuiDropdownHover,
  TuiDataList,
  TuiDialogService,
  TuiInput,
} from "@taiga-ui/core";
import { PolymorpheusComponent } from "@taiga-ui/polymorpheus";
import { TuiChevron } from "@taiga-ui/kit";
import { TuiList } from "@taiga-ui/layout";
import { CartService } from "../../../core/services/cart.service";
import { AuthService } from "../../../core/services/auth.service";
import { WishlistService } from "../../../core/services/wishlist.service";
import { PricePipe } from "../../pipes/price.pipe";
import { environment } from "../../../../environments/environment";
import {
  SEARCH_DEBOUNCE_MS,
  SEARCH_MIN_LENGTH,
} from "../../../core/constants/search.constants";
import { createTextSearchStream } from "../../../core/utils/search-stream";

interface SuggestResult {
  id: string;
  name: string;
  slug: string;
  catalogNumber: string | null;
  category: { name: string };
  images: Array<{ url: string }>;
  variants: Array<{ priceInCents: number; label: string }>;
}

@Component({
  selector: "app-header",
  standalone: true,
  imports: [
    RouterLink,
    ReactiveFormsModule,
    TuiButton,
    TuiIcon,
    TuiInput,
    TuiDropdown,
    TuiDropdownHover,
    TuiDataList,
    TuiChevron,
    TuiList,
    PricePipe,
    CdkTrapFocus,
  ],
  template: `
    <header class="header">
      <div class="header__inner">
        <!-- LEFT: logo + nav -->
        <div class="header__left">
          <a routerLink="/" class="header__logo" (click)="closeMobileMenu()">
            <img
              src="assets/images/logo_full.webp"
              alt="Aromaterie"
              class="header__logo-img"
              width="382"
              height="180"
            />
          </a>
          <nav class="header__nav" aria-label="Nawigacja główna">
            <button
              tuiChevron
              tuiDropdownHover
              type="button"
              class="header__nav-link"
              [class.active]="isCategoryActive()"
              [tuiDropdown]="categoryDropdown"
              [(tuiDropdownOpen)]="dropdownOpen"
              (click)="router.navigate(['/products'])"
            >
              Produkty
            </button>

            <ng-template #categoryDropdown>
              <tui-data-list (click)="dropdownOpen = false">
                <a tuiOption routerLink="/category/perfume">Perfumy</a>
                <a tuiOption routerLink="/category/diffusers">Dyfuzory</a>
                <a tuiOption routerLink="/category/gels">Żele pod prysznic</a>
                <hr class="header__dropdown-divider" />
                <a
                  tuiOption
                  routerLink="/products"
                  class="header__dropdown-item--all"
                  >Wszystkie produkty</a
                >
              </tui-data-list>
            </ng-template>
          </nav>
        </div>

        <!-- CENTER: search (hidden on mobile, lives in mobile menu instead) -->
        <div class="header__search">
          <div class="header__search-container">
            <form class="header__search-form" (submit)="onSearch($event)">
              <tui-textfield
                iconStart="@tui.search"
                class="header__search-field"
                tuiTextfieldSize="m"
              >
                <input
                  [formControl]="searchControl"
                  placeholder="Szukaj produktów…"
                  aria-label="Szukaj produktów"
                  tuiInput
                  autocomplete="off"
                  role="combobox"
                  aria-haspopup="listbox"
                  [attr.aria-expanded]="
                    showAutocomplete && autocomplete().length > 0
                  "
                  [attr.aria-activedescendant]="
                    activeIndex() >= 0 ? 'ac-item-' + activeIndex() : null
                  "
                  (focus)="onInputFocus()"
                  (blur)="onInputBlur()"
                  (keydown)="onKeydown($event)"
                />
              </tui-textfield>
              <button
                size="m"
                tuiButton
                type="submit"
                appearance="primary"
                class="header__search-btn"
              >
                Szukaj
              </button>
              <!-- Escape hatch for the shopper who cannot name what they want.
                   Sits next to the search box because that is exactly where they
                   give up. -->
              <button
                size="m"
                tuiButton
                type="button"
                appearance="flat"
                iconStart="@tui.sparkles"
                class="header__finder-btn"
                (click)="openFinder()"
              >
                Dobierz
              </button>
            </form>

            @if (showAutocomplete && autocomplete().length > 0) {
              <ul
                tuiList="s"
                class="autocomplete-list"
                role="listbox"
                aria-label="Wyniki wyszukiwania"
              >
                @for (item of autocomplete(); track item.id; let i = $index) {
                  <li
                    [id]="'ac-item-' + i"
                    class="autocomplete-item"
                    [class.is-active]="activeIndex() === i"
                    role="option"
                    [attr.aria-selected]="activeIndex() === i"
                    (mousedown)="selectSuggestion(item)"
                    (mouseenter)="activeIndex.set(i)"
                    (mouseleave)="activeIndex.set(-1)"
                  >
                    @if (item.images[0]?.url) {
                      <img
                        class="autocomplete-img"
                        [src]="item.images[0].url"
                        [alt]="item.name"
                        width="40"
                        height="40"
                        loading="lazy"
                      />
                    } @else {
                      <div
                        class="autocomplete-img autocomplete-img--placeholder"
                      ></div>
                    }
                    <span class="autocomplete-text">
                      <span class="autocomplete-name"
                        >{{ item.name }}
                        @if (item.catalogNumber) {
                          <span class="autocomplete-catalog-no"
                            >&nbsp;NO.&nbsp;{{ item.catalogNumber }}</span
                          >
                        }
                      </span>
                      @if (item.category?.name) {
                        <span class="autocomplete-category">{{
                          item.category.name
                        }}</span>
                      }
                    </span>
                    <span class="autocomplete-price">{{
                      item.variants[0]?.priceInCents | price
                    }}</span>
                  </li>
                }
              </ul>
            }
          </div>
        </div>

        <!-- RIGHT: actions -->
        <div class="header__actions">
          <a
            routerLink="/wishlist"
            class="header__action-link header__action-link--wishlist"
            (click)="closeMobileMenu()"
            [attr.aria-label]="
              wishlist.count() > 0
                ? 'Ulubione (' + wishlist.count() + ' produktów)'
                : 'Ulubione'
            "
          >
            <span class="header__action-icon">
              <tui-icon icon="@tui.heart" aria-hidden="true" />
              @defer (on immediate) {
                @if (wishlist.count() > 0) {
                  <span class="header__wishlist-badge" aria-hidden="true">{{
                    wishlist.count()
                  }}</span>
                }
              }
            </span>
            <span aria-hidden="true">Ulubione</span>
          </a>

          <a
            routerLink="/cart"
            class="header__action-link header__action-link--cart"
            (click)="closeMobileMenu()"
            [attr.aria-label]="
              cartService.itemCount() > 0
                ? 'Koszyk (' + cartService.itemCount() + ' produktów)'
                : 'Koszyk'
            "
          >
            <span class="header__action-icon">
              <tui-icon icon="@tui.shopping-cart" aria-hidden="true" />
              @if (cartService.itemCount() > 0) {
                <span class="header__cart-badge" aria-hidden="true">{{
                  cartService.itemCount()
                }}</span>
              }
            </span>
            <span aria-hidden="true">Koszyk</span>
          </a>

          <!-- Below 1000px the <span> is display:none, so without this label the
               link is icon-only and has no accessible name at all. The visible
               word stays a prefix of the label to satisfy WCAG 2.5.3. -->
          <a
            [routerLink]="auth.isAuthenticated() ? '/account' : '/auth/login'"
            class="header__action-link"
            (click)="closeMobileMenu()"
            [attr.aria-label]="
              auth.isAuthenticated()
                ? 'Konto — moje konto'
                : 'Konto — zaloguj się'
            "
          >
            <span class="header__action-icon">
              <tui-icon icon="@tui.user" aria-hidden="true" />
            </span>
            <span aria-hidden="true">Konto</span>
          </a>

          <!-- Hamburger — mobile only -->
          <button
            type="button"
            class="header__hamburger"
            (click)="toggleMobileMenu()"
            [attr.aria-expanded]="mobileMenuOpen"
            aria-label="Menu"
          >
            <tui-icon [icon]="mobileMenuOpen ? '@tui.x' : '@tui.menu'" />
          </button>
        </div>
      </div>

      <!-- Mobile navigation panel -->
      @if (mobileMenuOpen) {
        <div class="mobile-nav" (click)="closeMobileMenu()">
          <nav
            class="mobile-nav__links"
            role="dialog"
            aria-modal="true"
            aria-label="Menu nawigacyjne"
            cdkTrapFocus
            [cdkTrapFocusAutoCapture]="true"
            (click)="$event.stopPropagation()"
            (keydown.escape)="closeMobileMenu()"
          >
            <a
              routerLink="/products"
              class="mobile-nav__link"
              (click)="closeMobileMenu()"
              >Wszystkie produkty</a
            >
            <a
              routerLink="/category/perfume"
              class="mobile-nav__link"
              (click)="closeMobileMenu()"
              >Perfumy</a
            >
            <a
              routerLink="/category/diffusers"
              class="mobile-nav__link"
              (click)="closeMobileMenu()"
              >Dyfuzory</a
            >
            <a
              routerLink="/category/gels"
              class="mobile-nav__link"
              (click)="closeMobileMenu()"
              >Żele pod prysznic</a
            >
            <a
              routerLink="/dobierz-zapach"
              class="mobile-nav__link mobile-nav__link--finder"
              (click)="closeMobileMenu()"
            >
              Dobierz zapach
            </a>
            <hr class="mobile-nav__divider" />
            <form class="mobile-nav__search" (submit)="onMobileSearch($event)">
              <tui-textfield
                iconStart="@tui.search"
                tuiTextfieldSize="s"
                class="mobile-nav__search-field"
              >
                <input
                  [formControl]="searchControl"
                  placeholder="Szukaj produktów…"
                  aria-label="Szukaj produktów"
                  tuiInput
                />
              </tui-textfield>
              <button tuiButton type="submit" appearance="primary" size="s">
                Szukaj
              </button>
            </form>
          </nav>
        </div>
      }
    </header>
  `,
  styles: [
    `
      .header {
        position: sticky;
        top: 0;
        z-index: 100;
        background: var(--color-surface);
        border-bottom: 1px solid var(--color-border);
      }
      .header__inner {
        max-width: var(--max-width, 1280px);
        margin: 0 auto;
        padding: 0 24px;
        /* Token, not a literal: --chrome-height is derived from it and the home
         hero sizes itself against that, so a hardcoded value here would desync
         the two. */
        height: var(--header-height);
        display: grid;
        grid-template-columns: auto 1fr auto;
        align-items: center;
        gap: 24px;
      }

      /* ── Left ───────────────────────────────── */
      .header__left {
        display: flex;
        align-items: center;
        gap: 20px;
      }
      .header__logo {
        display: flex;
        align-items: center;
        line-height: 1;
      }
      .header__logo-img {
        height: 66px;
        width: auto;
        display: block;
        /* The asset carries roughly half its canvas as padding, and the mark sits
         above the canvas centre, so it needs nudging down to look centred.
         transform rather than the margin-top this replaces: a margin adds to
         the header row's height, which is exactly what pushed the row past the
         header box and left the search field 13px from the top but 7px from
         the bottom. */
        transform: translateY(5px);
      }
      .header__nav {
        display: flex;
        gap: 20px;
      }

      .header__nav-link {
        display: inline-flex;
        align-items: center;
        background: none;
        border: none;
        padding: 0;
        cursor: pointer;
        color: var(--color-primary);
        /* One step under the 16px search row: the nav reads as navigation next to
         the primary action rather than competing with it, but no longer as the
         13px fine print it was. */
        font-size: 15px;
        font-weight: 400;
        font-family: var(--tui-typography-family-text), sans-serif;
        transition: color 0.15s;
        white-space: nowrap;
        /* 17px tall as bare text; the nav sits in a 64px header so there is room
         to make the row itself the target. */
        min-height: 44px;
        display: inline-flex;
        align-items: center;
      }
      .header__nav-link:hover,
      .header__nav-link.active {
        color: var(--color-accent-text);
      }
      .header__nav-link:focus-visible {
        outline: 3px solid var(--color-accent);
        outline-offset: 3px;
        border-radius: 3px;
      }

      .header__dropdown-divider {
        border: none;
        border-top: 1px solid var(--color-border);
        margin: 4px 0;
      }
      .header__dropdown-item--all {
        font-weight: 600;
      }

      /* ── Center: search ─────────────────────── */
      .header__search {
        display: flex;
        justify-content: center;
      }
      .header__search-container {
        position: relative;
        width: 100%;
        max-width: 480px;
      }
      .header__search-form {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
      }
      /* The search row runs at Taiga's size="m" (44px) rather than "s" (32px):
       the field and its two buttons then share one height natively, instead of
       a 32px input sitting next to a CSS-stretched button. 44px is also the tap
       target floor, and it still clears the 64px header. */
      .header__search-field {
        flex: 1;
        min-width: 0;
      }
      /* Taiga's size="m" button labels render at 16px; the textfield inside the
       same row stayed at 13px, so the query the shopper types was visibly
       smaller than the button telling them to submit it. */
      .header__search-field input {
        font-size: 16px;
      }
      .header__search-btn {
        flex-shrink: 0;
      }
      .header__finder-btn {
        flex-shrink: 0;
        white-space: nowrap;
      }
      /* Below 1200px the search row runs out of room before the button does any
       good — the mobile menu carries a "Dobierz zapach" link instead. */
      @media (max-width: 1200px) {
        .header__finder-btn {
          display: none;
        }
      }

      /* ── Autocomplete dropdown ──────────────── */
      /* tuiList adds margin-inline-start and li::before bullets — reset both */
      .autocomplete-list {
        position: absolute;
        top: calc(100% + 2px);
        left: 0;
        right: 0;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: 0 0 8px 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.12);
        z-index: 200;
        margin-inline-start: 0;
        padding: 0;
        max-height: 360px;
        overflow-y: auto;
      }
      .autocomplete-list > li {
        margin: 0;
      }
      .autocomplete-list > li::before {
        display: none;
      }
      .autocomplete-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        cursor: pointer;
        transition: background 0.12s;
        max-width: none;
      }
      .autocomplete-item:hover,
      .autocomplete-item.is-active {
        background: var(--tui-background-neutral-1-hover, rgba(0, 0, 0, 0.04));
      }
      .autocomplete-img {
        width: 40px;
        height: 40px;
        border-radius: 4px;
        object-fit: cover;
        flex-shrink: 0;
      }
      .autocomplete-img--placeholder {
        background: var(--tui-background-neutral-1, #f5f5f5);
      }
      .autocomplete-text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .autocomplete-name {
        font-size: 14px;
        font-weight: 500;
        color: var(--color-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .autocomplete-catalog-no {
        font-size: 0.78rem;
        font-weight: 500;
        color: var(--color-secondary);
        letter-spacing: 0.03em;
      }
      .autocomplete-category {
        font-size: 12px;
        color: var(--color-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .autocomplete-price {
        font-size: 13px;
        font-weight: 600;
        color: var(--color-accent-text);
        white-space: nowrap;
        flex-shrink: 0;
      }

      /* ── Right ──────────────────────────────── */
      .header__actions {
        display: flex;
        align-items: center;
        gap: 20px;
      }
      .header__action-link {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: 15px;
        color: var(--color-primary);
        white-space: nowrap;
        transition: color 0.15s;
        position: relative;
        /* The icons render at 20px; without this the whole hit area was 20x20 —
         under half of the 44x44 that Apple HIG and Material both call for, and
         under even the 24x24 WCAG 2.5.8 floor. Padding-free so the icon keeps
         its size and only the target grows around it. */
        min-width: 44px;
        min-height: 44px;
      }
      .header__action-link:hover {
        color: var(--color-accent-text);
      }
      .header__action-link:focus-visible {
        outline: 3px solid var(--color-accent);
        outline-offset: 3px;
        border-radius: 3px;
      }
      .header__action-link tui-icon {
        font-size: 20px;
      }
      .header__action-link--cart,
      .header__action-link--wishlist {
        position: relative;
      }
      /* Badges anchor to this, not to the link: once the link grew to 44x44 (and
       on desktop it also carries a text label) a link-relative badge floated
       off into the corner instead of sitting on the icon. */
      .header__action-icon {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .header__wishlist-badge,
      .header__cart-badge {
        position: absolute;
        top: -7px;
        right: -10px;
        background: var(--color-accent);
        color: #fff;
        border-radius: 50%;
        min-width: 17px;
        height: 17px;
        font-size: 10px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 3px;
      }

      /* ── Hamburger ──────────────────────────── */
      .header__hamburger {
        display: none;
        align-items: center;
        justify-content: center;
        background: none;
        border: none;
        cursor: pointer;
        color: var(--color-primary);
        padding: 4px;
        min-width: 44px;
        min-height: 44px;
        border-radius: var(--border-radius-sm);
        transition: color 0.15s;
      }
      .header__hamburger tui-icon {
        font-size: 22px;
      }
      .header__hamburger:hover {
        color: var(--color-accent-text);
      }

      /* ── Mobile nav panel ───────────────────── */
      .mobile-nav {
        background: rgba(0, 0, 0, 0.35);
        position: fixed;
        inset: var(--header-height) 0 0 0;
        z-index: 99;
      }
      .mobile-nav__links {
        background: var(--color-surface);
        border-bottom: 1px solid var(--color-border);
        padding: 16px 24px 20px;
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .mobile-nav__link {
        display: block;
        padding: 12px 0;
        font-size: 16px;
        font-weight: 500;
        color: var(--color-primary);
        border-bottom: 1px solid var(--color-border);
        transition: color 0.15s;
      }
      .mobile-nav__link:last-of-type {
        border-bottom: none;
      }
      .mobile-nav__link:hover {
        color: var(--color-accent-text);
      }
      .mobile-nav__link--finder {
        color: var(--color-accent-text);
        font-weight: 600;
      }
      .mobile-nav__divider {
        border: none;
        border-top: 1px solid var(--color-border);
        margin: 8px 0;
      }
      .mobile-nav__search {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-top: 12px;
      }
      .mobile-nav__search-field {
        flex: 1;
        min-width: 0;
      }

      /* ── Breakpoints ────────────────────────── */
      @media (max-width: 999px) {
        .header__nav {
          display: none;
        }
        .header__action-link span {
          display: none;
        }
        .header__actions {
          gap: 12px;
        }
        .header__hamburger {
          display: flex;
        }
      }
      @media (max-width: 768px) {
        .header__search {
          display: none;
        }
        .header__inner {
          grid-template-columns: auto auto;
          justify-content: space-between;
          gap: 0;
        }
        /* Four 44px targets plus the logo is all a 360px viewport holds, so the
         gap goes to zero here. The targets are their own separation. */
        .header__actions {
          gap: 0;
        }
      }
    `,
  ],
})
export class HeaderComponent implements OnInit {
  readonly router = inject(Router);
  readonly cartService = inject(CartService);
  readonly auth = inject(AuthService);
  readonly wishlist = inject(WishlistService);
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private readonly elRef = inject(ElementRef);
  private readonly dialogs = inject(TuiDialogService);
  private readonly route = inject(ActivatedRoute);

  dropdownOpen = false;
  mobileMenuOpen = false;
  showAutocomplete = false;
  private hamburgerEl: HTMLElement | null = null;

  readonly activeIndex = signal(-1);

  readonly searchControl = new FormControl<string>("");

  /**
   * Dropdown suggestions. Uses `/products/suggest` rather than the finder's
   * `/products?search=` on purpose: this list needs six trimmed rows, not full
   * product payloads with variants and stock. Only the pipeline is shared.
   */
  private readonly suggestStream = createTextSearchStream<SuggestResult>({
    fetch: (term) =>
      this.http.get<SuggestResult[]>(`${environment.apiUrl}/products/suggest`, {
        params: { q: term },
      }),
    destroyRef: this.destroyRef,
    minLength: SEARCH_MIN_LENGTH,
  });

  /** Read directly off the stream — no local copy to keep in sync. */
  readonly autocomplete = this.suggestStream.results;

  ngOnInit(): void {
    // Autocomplete runs on the shared search stream (core/utils/search-stream.ts),
    // the same pipeline as the fragrance finder: debounce → trim → distinct →
    // switchMap. The keyboard cursor resets on keystroke rather than on arrival
    // of results, so it can never point past the end of a list that shrank.
    this.searchControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => {
        this.activeIndex.set(-1);
        this.suggestStream.search(value ?? "");
      });

    // Search-as-you-type — updates the catalog URL only when already on
    // /products. Deliberately one tick slower than the autocomplete: this one
    // triggers a full ranked catalog query plus a route navigation, so it should
    // settle after the dropdown has, not race it. Kept as its own pipeline
    // because it produces a navigation, not a result set.
    this.searchControl.valueChanges
      .pipe(
        map((value) => value?.trim() ?? ""),
        debounceTime(SEARCH_DEBOUNCE_MS + 150),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((term) => {
        const currentPath = this.router.url.split("?")[0];
        if (currentPath !== "/products") return;
        this.router.navigate(["/products"], {
          queryParams: { q: term || null },
          queryParamsHandling: "merge",
          replaceUrl: true,
        });
      });

    // Keep the box in sync with ?q= in the URL.
    //
    // Without this the header goes blank whenever the catalog is reached by any
    // route that is not "type into this box": a shared link, a reload, browser
    // back, or clicking "Zobacz wszystkie wyniki" in the finder. The page then
    // shows "Wyniki dla: dg" above an empty search bar, and the shopper has no
    // way to refine the query they can plainly see is active.
    //
    // emitEvent: false is what stops this from looping — the pipelines above
    // navigate on input, and re-emitting here would feed that navigation back in.
    this.route.queryParamMap
      .pipe(
        map((params) => params.get("q") ?? ""),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((q) => {
        const onCatalog = this.router.url.split("?")[0] === "/products";
        const next = onCatalog ? q : "";
        if ((this.searchControl.value ?? "") !== next) {
          this.searchControl.setValue(next, { emitEvent: false });
        }
      });
  }

  isCategoryActive(): boolean {
    return this.router.url.startsWith("/category/");
  }

  toggleMobileMenu(): void {
    if (!this.mobileMenuOpen) {
      this.hamburgerEl =
        this.elRef.nativeElement.querySelector(".header__hamburger");
    }
    this.mobileMenuOpen = !this.mobileMenuOpen;
    if (!this.mobileMenuOpen) {
      this.hamburgerEl?.focus();
    }
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen = false;
    this.hamburgerEl?.focus();
    this.hamburgerEl = null;
  }

  onInputFocus(): void {
    this.showAutocomplete = true;
  }

  onInputBlur(): void {
    // Delay allows (mousedown) on suggestion items to fire before the dropdown hides
    setTimeout(() => {
      this.showAutocomplete = false;
      this.activeIndex.set(-1);
    }, 150);
  }

  onKeydown(event: KeyboardEvent): void {
    const items = this.autocomplete();
    if (!this.showAutocomplete || items.length === 0) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        this.activeIndex.update((i) => Math.min(i + 1, items.length - 1));
        this.scrollActiveIntoView();
        break;
      case "ArrowUp":
        event.preventDefault();
        this.activeIndex.update((i) => Math.max(i - 1, -1));
        this.scrollActiveIntoView();
        break;
      case "Enter":
        if (this.activeIndex() >= 0) {
          event.preventDefault();
          this.selectSuggestion(items[this.activeIndex()]);
        }
        break;
      case "Escape":
        this.showAutocomplete = false;
        this.activeIndex.set(-1);
        break;
    }
  }

  private scrollActiveIntoView(): void {
    setTimeout(() => {
      const el = this.elRef.nativeElement.querySelector(
        ".autocomplete-item.is-active",
      ) as HTMLElement | null;
      el?.scrollIntoView({ block: "nearest" });
    }, 0);
  }

  selectSuggestion(item: SuggestResult): void {
    this.showAutocomplete = false;
    this.suggestStream.reset();
    this.activeIndex.set(-1);
    // Navigating to a product page, not the catalog — the query-param sync will
    // see no ?q= and blank the box, so clearing it here would be redundant.
    this.searchControl.setValue("", { emitEvent: false });
    this.closeMobileMenu();
    this.router.navigate(["/products", item.slug]);
  }

  /**
   * Opens the picker in a dialog rather than navigating, so the shopper does not
   * lose the page they were on. The component is loaded lazily — it pulls in the
   * note vocabulary and the product card, and most sessions never open it, so it
   * must not sit in the header's initial bundle.
   */
  openFinder(): void {
    import("../fragrance-finder/fragrance-finder.component").then(
      ({ FragranceFinderComponent }) => {
        this.dialogs
          .open(new PolymorpheusComponent(FragranceFinderComponent), {
            label: "Dobierz zapach",
            size: "l",
          })
          .subscribe();
      },
    );
  }

  /**
   * `event.preventDefault()` is load-bearing, not defensive.
   *
   * Angular's `(submit)` binding does not suppress the browser's native form
   * submission. Without this, pressing Enter (or the Szukaj button) fired a real
   * GET to the current URL, which reloaded the page and threw away the
   * `router.navigate` below — the address bar flashed `/products?q=…` and then
   * snapped back to whatever page the shopper was on.
   */
  onSearch(event?: Event): void {
    event?.preventDefault();
    const q = this.searchControl.value?.trim();
    this.showAutocomplete = false;
    this.suggestStream.reset();
    if (!q) return;
    // The box is intentionally NOT cleared: the query-param sync in ngOnInit
    // keeps it showing the active search, so the shopper can refine it on the
    // results page instead of retyping from scratch.
    this.router.navigate(["/products"], { queryParams: { q } });
  }

  onMobileSearch(event?: Event): void {
    this.onSearch(event);
    this.closeMobileMenu();
  }

  logout(): void {
    this.auth.logout().subscribe();
  }
}
