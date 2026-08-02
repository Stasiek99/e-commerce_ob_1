import {
  Component,
  DestroyRef,
  Input,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map, tap } from 'rxjs';
import { TuiButton, TuiIcon, TuiLoader, TuiTextfield } from '@taiga-ui/core';
import {
  FinderNote,
  FinderProduct,
  FragranceFinderService,
} from '../../../core/services/fragrance-finder.service';
import { ProductCardComponent } from '../../product-card/product-card.component';
import { SEARCH_MIN_LENGTH } from '../../../core/constants/search.constants';
import { createSearchStream, createTextSearchStream } from '../../../core/utils/search-stream';

type FinderMode = 'name' | 'notes';

/** Catalog `gender` values, plus the "no filter" sentinel. */
type GenderFilter = 'all' | 'Kobieta' | 'Mężczyzna' | 'Unisex';

const GENDER_OPTIONS: ReadonlyArray<{ value: GenderFilter; label: string }> = [
  { value: 'all', label: 'Wszystkie' },
  { value: 'Kobieta', label: 'Dla niej' },
  { value: 'Mężczyzna', label: 'Dla niego' },
  { value: 'Unisex', label: 'Unisex' },
];

/**
 * Fragrance picker — the store's product names are invented ("Aqua Soul" says
 * nothing about what is in the bottle), so this is primary navigation, not a
 * decorative widget.
 *
 * Two modes, mirroring the two ways a shopper actually arrives:
 *  - `name`  — they know a designer fragrance and want the equivalent. Runs
 *              against /products/suggest, i.e. the same typo- and
 *              abbreviation-tolerant matcher as the header search bar.
 *  - `notes` — they only know what they like. Runs against
 *              /products/finder/match, which ranks by note overlap.
 *
 * Rendered inline on /dobierz-zapach and the home page, and inside a dialog from
 * the header. `compact` trims the intro and result count for the dialog and the
 * catalog empty state, where surrounding context already explains the purpose.
 */
@Component({
  selector: 'app-fragrance-finder',
  standalone: true,
  imports: [
    RouterLink,
    ReactiveFormsModule,
    TuiButton,
    TuiIcon,
    TuiLoader,
    TuiTextfield,
    ProductCardComponent,
  ],
  template: `
    <div class="finder" [class.finder--compact]="compact">
      <!-- No intro copy here on purpose: every host already sets up the widget
           in its own words (the page lead, the empty-state message, the dialog
           title), and a generic paragraph on top of those read as duplication. -->
      <div class="finder__modes" role="tablist" aria-label="Sposób doboru zapachu">
        <button
          type="button"
          role="tab"
          class="finder__mode"
          [class.is-active]="mode() === 'name'"
          [attr.aria-selected]="mode() === 'name'"
          (click)="setMode('name')"
        >
          <tui-icon icon="@tui.search" aria-hidden="true" />
          Znam podobny zapach
        </button>
        <button
          type="button"
          role="tab"
          class="finder__mode"
          [class.is-active]="mode() === 'notes'"
          [attr.aria-selected]="mode() === 'notes'"
          (click)="setMode('notes')"
        >
          <tui-icon icon="@tui.flower-2" aria-hidden="true" />
          Dobierz po nutach
        </button>
      </div>

      <div class="finder__gender" role="group" aria-label="Dla kogo">
        <span class="finder__gender-label">Dla kogo:</span>
        @for (option of genderOptions; track option.value) {
          <button
            type="button"
            class="finder__chip finder__chip--gender"
            [class.is-active]="gender() === option.value"
            [attr.aria-pressed]="gender() === option.value"
            (click)="setGender(option.value)"
          >
            {{ option.label }}
          </button>
        }
      </div>

      <!-- The query row carries an optional projected slot on its right. That is
           how /dobierz-zapach puts its "browse the catalog" escape hatch level
           with the search field: aligning it from the page shell would mean
           guessing the height of the copy above, which changes with the
           viewport. Hosts that project nothing simply get an empty slot. -->
      <div class="finder__query">
        <div class="finder__query-main">
          @if (mode() === 'name') {
            <tui-textfield iconStart="@tui.search" class="finder__field">
              <input
                tuiTextfield
                [formControl]="nameControl"
                placeholder="np. „YSL Libre”"
                aria-label="Nazwa znanego zapachu"
                autocomplete="off"
              />
            </tui-textfield>
          } @else {
            @if (notesLoading()) {
              <div class="finder__loading"><tui-loader size="m" /></div>
            } @else if (notes().length === 0) {
              <p class="finder__error">
                Nie udało się wczytać listy nut. Odśwież stronę albo skorzystaj z wyszukiwania po
                nazwie.
              </p>
            } @else {
              <div class="finder__notes" role="group" aria-label="Nuty zapachowe">
                @for (note of notes(); track note.key) {
                  <button
                    type="button"
                    class="finder__chip"
                    [class.is-active]="isNoteSelected(note.key)"
                    [attr.aria-pressed]="isNoteSelected(note.key)"
                    (click)="toggleNote(note.key)"
                  >
                    {{ note.label }}
                  </button>
                }
              </div>
              @if (selectedNotes().length > 0) {
                <button type="button" class="finder__clear" (click)="clearNotes()">
                  Wyczyść wybór ({{ selectedNotes().length }})
                </button>
              }
            }
          }
        </div>

        <div class="finder__query-aside">
          <ng-content select="[finderAside]" />
        </div>
      </div>

      <div class="finder__results" aria-live="polite">
        @if (loading()) {
          <div class="finder__loading"><tui-loader size="l" /></div>
        } @else if (!hasSearched()) {
          <!-- Name mode gets no placeholder: the input's own placeholder already
               says what to type, and a second line under it repeated it. -->
          @if (mode() === 'notes') {
            <p class="finder__hint">Zaznacz od jednej do kilku nut, które lubisz.</p>
          }
        } @else if (results().length === 0) {
          <p class="finder__empty">
            @if (mode() === 'name') {
              Nie znaleźliśmy nic podobnego. Spróbuj samej nazwy marki albo przejdź na dobór po nutach.
            } @else {
              Żaden zapach nie ma tej kombinacji nut. Odznacz jedną z nich albo zmień filtr „dla kogo”.
            }
          </p>
        } @else {
          @if (!compact) {
            <p class="finder__count">Dopasowania ({{ results().length }}):</p>
          }
          <div class="finder__grid">
            @for (item of results(); track item.id) {
              <div class="finder__result">
                <app-product-card [product]="item" />
                @if (item.matchedNotes.length > 0) {
                  <p class="finder__matched">
                    <span class="finder__matched-label">Wspólne nuty:</span>
                    {{ item.matchedNotes.join(', ') }}
                  </p>
                }
              </div>
            }
          </div>

          @if (showAllResultsLink()) {
            <a
              class="finder__all"
              tuiButton
              appearance="outline"
              size="m"
              routerLink="/products"
              [queryParams]="{ q: nameQuery() }"
            >
              <!-- Count in parentheses rather than inflected ("18 wyników" vs
                   "22 wyniki") — Polish plural agreement would need a pipe for
                   no gain here. -->
              Zobacz wszystkie wyniki ({{ nameTotal() }})
            </a>
          }
        }
      </div>
    </div>
  `,
  styles: [
    `
      .finder {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-md);
        min-width: 0;
      }
      .finder--compact { gap: var(--spacing-sm); }

      /* ── Mode tabs ─────────────────────────────── */
      .finder__modes {
        display: flex;
        flex-wrap: wrap;
        gap: var(--spacing-xs);
      }
      .finder__mode {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border: 1px solid var(--color-border);
        background: var(--color-surface);
        color: var(--color-secondary);
        border-radius: var(--border-radius-md);
        padding: 10px 16px;
        font: inherit;
        font-size: 14px;
        cursor: pointer;
        transition: color 0.15s, border-color 0.15s, background 0.15s;
      }
      .finder__mode tui-icon { font-size: 18px; }
      .finder__mode:hover { color: var(--color-primary); border-color: var(--color-accent-text); }
      .finder__mode.is-active {
        color: var(--color-surface);
        background: var(--color-primary);
        border-color: var(--color-primary);
      }
      .finder__mode:focus-visible { outline: 3px solid var(--color-accent); outline-offset: 3px; }

      /* ── Gender + note chips ───────────────────── */
      .finder__gender {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--spacing-xs);
      }
      .finder__gender-label {
        color: var(--color-secondary);
        font-size: 14px;
        margin-inline-end: 4px;
      }
      .finder__notes {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .finder__chip {
        border: 1px solid var(--color-border);
        background: transparent;
        color: var(--color-primary);
        border-radius: 999px;
        /* 7px padding left the chips 36px tall. These are the finder's primary
           control on a phone, and a shopper taps a dozen of them in a row. */
        padding: 11px 16px;
        min-height: 44px;
        font: inherit;
        font-size: 13px;
        cursor: pointer;
        transition: color 0.15s, border-color 0.15s, background 0.15s;
      }
      .finder__chip:hover { border-color: var(--color-accent-text); }
      .finder__chip.is-active {
        background: var(--color-accent);
        border-color: var(--color-accent-text);
        color: #fff;
      }
      .finder__chip:focus-visible { outline: 3px solid var(--color-accent); outline-offset: 3px; }
      .finder__chip--gender { font-size: 13px; }

      .finder__clear {
        align-self: flex-start;
        background: none;
        border: none;
        padding: 0;
        font: inherit;
        font-size: 13px;
        color: var(--color-secondary);
        text-decoration: underline;
        cursor: pointer;
      }
      .finder__clear:hover { color: var(--color-accent-text); }

      /* flex-start, not center: the projected aside must sit level with the TOP
         of the query area, so it lines up with the search field rather than
         drifting down when notes mode renders several rows of chips. */
      .finder__query {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--spacing-md);
      }
      .finder__query-main {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--spacing-sm);
      }
      .finder__query-aside { flex-shrink: 0; }
      .finder__field { width: 100%; max-width: 560px; }

      /* ── Results ───────────────────────────────── */
      .finder__results { min-height: 60px; }
      .finder__loading { display: flex; justify-content: center; padding: var(--spacing-md) 0; }
      .finder__hint,
      .finder__empty,
      .finder__error {
        margin: 0;
        color: var(--color-secondary);
        padding: var(--spacing-sm) 0;
        line-height: 1.6;
      }
      .finder__error { color: var(--color-error, #c0392b); }
      .finder__count {
        margin: 0 0 var(--spacing-sm);
        font-size: 14px;
        color: var(--color-secondary);
      }
      /* Fixed column counts per breakpoint, matching the catalog grid, rather
         than auto-fill: the picker renders inside containers of very different
         widths (full-page, the narrower left column of /dobierz-zapach, a
         dialog), and auto-fill silently dropped a column whenever the container
         lost ~50px. The 1fr tracks keep cards fitting whatever width they get. */
      .finder__grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: var(--spacing-md);
      }
      @media (min-width: 768px) {
        .finder__grid { grid-template-columns: repeat(3, 1fr); }
      }
      @media (min-width: 1200px) {
        .finder__grid { grid-template-columns: repeat(4, 1fr); }
      }
      .finder__result { display: flex; flex-direction: column; gap: 6px; }
      .finder__matched {
        margin: 0;
        font-size: 12px;
        line-height: 1.5;
        color: var(--color-secondary);
      }
      .finder__matched-label { color: var(--color-success); font-weight: 600; }
      .finder__all { align-self: flex-start; margin-top: var(--spacing-md); }

      @media (max-width: 900px) {
        /* No right gutter left to fill — the aside stacks under the query. */
        .finder__query { flex-direction: column; align-items: stretch; }
        .finder__query-aside { align-self: flex-start; }
      }
      @media (max-width: 560px) {
        .finder__grid { gap: var(--spacing-sm); }
        .finder__mode { flex: 1; justify-content: center; }
      }
    `,
  ],
})
export class FragranceFinderComponent implements OnInit {
  /** Trims intro copy and the result count for dialog / empty-state placements. */
  @Input() compact = false;
  /** Starting mode. The catalog empty state opens straight on notes, because the
   *  shopper has just proven that typing a name did not work for them. */
  @Input() initialMode: FinderMode = 'name';
  /** Seeds the name field, e.g. with the query that returned nothing. */
  @Input() initialQuery = '';
  /** Restricts matching to one category slug (unset = whole catalog). */
  @Input() category?: string;
  @Input() limit = 8;

  private readonly finder = inject(FragranceFinderService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly router = inject(Router);

  readonly genderOptions = GENDER_OPTIONS;

  readonly mode = signal<FinderMode>('name');
  readonly gender = signal<GenderFilter>('all');
  readonly selectedNotes = signal<string[]>([]);
  readonly notes = signal<FinderNote[]>([]);
  readonly notesLoading = signal(false);

  readonly nameControl = new FormControl<string>('', { nonNullable: true });

  /**
   * Both modes run on the shared search pipeline (debounce → normalize →
   * distinct → switchMap), so neither can regress into per-keystroke requests or
   * out-of-order results independently of the header search bar.
   *
   * The note stream uses debounceMs: 0 — its input comes from chip clicks, not
   * typing, so there is nothing to wait for — but it still needs the switchMap,
   * because rapid clicking outruns the server just as easily as typing does.
   */
  private readonly nameStream = createTextSearchStream<FinderProduct>({
    fetch: (term) =>
      this.finder
        .searchByName({
          term,
          gender: this.selectedGenders(),
          category: this.category,
          limit: this.limit,
        })
        // `meta.total` counts every match; `data` is capped at `limit`. The
        // difference is the only honest signal for whether results are being
        // held back, so it is captured here rather than guessed from the number
        // of cards on screen.
        .pipe(
          tap((response) => this.nameTotal.set(response.meta.total)),
          map((response) => response.data),
        ),
    destroyRef: this.destroyRef,
    minLength: SEARCH_MIN_LENGTH,
  });

  /** Total matches server-side for the current name query, before `limit`. */
  readonly nameTotal = signal(0);

  private readonly noteStream = createSearchStream<string[], FinderProduct>({
    fetch: (notes) =>
      this.finder
        .match({
          notes,
          gender: this.selectedGenders(),
          category: this.category,
          limit: this.limit,
        })
        .pipe(map((response) => response.data)),
    isEmpty: (notes) => notes.length === 0,
    normalize: (notes) => notes,
    keyOf: (notes) => [...notes].sort().join('|'),
    empty: [],
    destroyRef: this.destroyRef,
    debounceMs: 0,
  });

  /**
   * The term the displayed results belong to — owned by the stream, not by the
   * FormControl. Reading `nameControl.value` from a `computed()` would capture no
   * signal dependency, so it would evaluate once against the empty initial value
   * and never recompute; `hasSearched()` stayed false forever and name mode
   * rendered the placeholder instead of its results.
   */
  readonly nameQuery = this.nameStream.current;

  readonly results = computed(() =>
    this.mode() === 'name' ? this.nameStream.results() : this.noteStream.results(),
  );

  readonly loading = computed(() =>
    this.mode() === 'name' ? this.nameStream.loading() : this.noteStream.loading(),
  );

  readonly hasSearched = computed(() =>
    this.mode() === 'name'
      ? this.nameQuery().length >= SEARCH_MIN_LENGTH
      : this.selectedNotes().length > 0,
  );

  /**
   * "See all results" appears only when the picker is genuinely holding matches
   * back, i.e. the server found more than `limit`.
   *
   * Not a match-count heuristic: at limit=12 a query like "dior" shows 12 of 18
   * and "wanilia" 12 of 82, while "chanel" shows all 7. Keying the link to
   * `meta.total` means it is present exactly when it leads somewhere new, and
   * absent when the grid already shows everything.
   */
  readonly showAllResultsLink = computed(
    () =>
      this.mode() === 'name' &&
      this.nameQuery().length > 0 &&
      this.nameTotal() > this.results().length,
  );

  ngOnInit(): void {
    this.mode.set(this.initialMode);
    if (this.initialQuery) {
      this.nameControl.setValue(this.initialQuery, { emitEvent: false });
    }

    // Notes are fetched browser-side only. During prerender of /dobierz-zapach
    // the backend may be unreachable, and baking an empty list into the static
    // HTML would render dead chips until hydration replaced them.
    if (this.isBrowser) {
      this.loadNotes();
      // Seeded query runs immediately — the shopper already typed it, on the
      // catalog page that sent them here; making them wait a debounce would be
      // an artificial delay on input that is already settled.
      if (this.initialQuery.trim()) this.nameStream.refresh(this.initialQuery);
    }

    this.nameControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.nameStream.search(value));
  }

  setMode(mode: FinderMode): void {
    this.mode.set(mode);
    if (mode === 'notes' && this.notes().length === 0 && this.isBrowser) this.loadNotes();
  }

  setGender(gender: GenderFilter): void {
    if (this.gender() === gender) return;
    this.gender.set(gender);
    // Gender is part of both queries, so both result sets are now stale. These
    // go through `refresh`, not `search`: the term is unchanged, so the typed
    // branch's distinctUntilChanged would swallow them.
    this.nameStream.refresh();
    this.noteStream.refresh();
  }

  isNoteSelected(key: string): boolean {
    return this.selectedNotes().includes(key);
  }

  toggleNote(key: string): void {
    this.selectedNotes.update((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    );
    this.noteStream.search(this.selectedNotes());
  }

  clearNotes(): void {
    this.selectedNotes.set([]);
    this.noteStream.reset();
  }

  private loadNotes(): void {
    this.notesLoading.set(true);
    this.finder.notes$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((notes) => {
      this.notes.set(notes);
      this.notesLoading.set(false);
    });
  }

  private selectedGenders(): string[] | undefined {
    const gender = this.gender();
    if (gender === 'all') return undefined;
    // "Dla niej"/"Dla niego" include unisex: excluding it would hide a large and
    // genuinely relevant slice of the catalog behind a filter the shopper reads
    // as a preference, not a hard constraint.
    return gender === 'Unisex' ? ['Unisex'] : [gender, 'Unisex'];
  }

}
