import { DestroyRef, Signal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, Subject, catchError, debounceTime, distinctUntilChanged, filter, map, merge, of, switchMap, tap } from 'rxjs';
import { SEARCH_DEBOUNCE_MS } from '../constants/search.constants';

/**
 * Shared request pipeline for every search-as-you-type surface in the app.
 *
 * The header autocomplete and the fragrance finder hit *different* endpoints on
 * purpose — `/products/suggest` returns six trimmed rows for a dropdown, while
 * the finder needs the full product payload so its cards can add to the cart —
 * but the plumbing around those calls is identical, and when it was written
 * twice the two copies drifted and each grew its own bug:
 *
 *   - the finder subscribed per keystroke with no `switchMap`, so a slow early
 *     response could land after a newer one and overwrite the results;
 *   - the header ran `distinctUntilChanged` on the untrimmed value, so "dg" and
 *     "dg " counted as different searches and fired a duplicate query.
 *
 * Both are fixed once, here.
 *
 * Ordering matters and is not arbitrary:
 *   debounce → normalize → distinct → switchMap
 * Debouncing first collapses a burst of keystrokes into one; normalizing before
 * `distinctUntilChanged` is what makes "dg " a repeat rather than a new term;
 * `switchMap` last guarantees at most one in-flight request whose result is
 * always the newest.
 */
export interface SearchStream<TInput, TResult> {
  readonly results: Signal<TResult[]>;
  readonly loading: Signal<boolean>;
  /** The input the currently displayed results belong to. */
  readonly current: Signal<TInput>;
  /** Debounced — for typing. */
  search(input: TInput): void;
  /** Immediate — for a deliberate action such as flipping a filter. */
  refresh(input?: TInput): void;
  reset(): void;
}

export interface SearchStreamConfig<TInput, TResult> {
  /** Performs the request. Errors are swallowed into an empty result set. */
  fetch: (input: TInput) => Observable<TResult[]>;
  /** True when the input carries no signal and no request should be made. */
  isEmpty: (input: TInput) => boolean;
  /** Canonical form used for both the request and repeat detection. */
  normalize: (input: TInput) => TInput;
  /** Stable key for repeat detection; defaults to JSON of the normalized input. */
  keyOf?: (input: TInput) => string;
  empty: TInput;
  destroyRef: DestroyRef;
  debounceMs?: number;
}

export function createSearchStream<TInput, TResult>(
  config: SearchStreamConfig<TInput, TResult>,
): SearchStream<TInput, TResult> {
  const {
    fetch,
    isEmpty,
    normalize,
    empty,
    destroyRef,
    debounceMs = SEARCH_DEBOUNCE_MS,
    keyOf = (input: TInput) => JSON.stringify(input),
  } = config;

  const typed$ = new Subject<TInput>();
  const immediate$ = new Subject<TInput>();

  const results = signal<TResult[]>([]);
  const loading = signal(false);
  const current = signal<TInput>(empty);

  merge(
    // Only the typed branch is debounced and de-duplicated. `refresh` bypasses
    // both on purpose: re-running the same term under a changed filter is a new
    // request, and distinctUntilChanged would swallow it.
    typed$.pipe(map(normalize), debounceTime(debounceMs), distinctUntilChanged((a, b) => keyOf(a) === keyOf(b))),
    immediate$.pipe(map(normalize)),
  )
    .pipe(
      tap((input) => {
        current.set(input);
        if (isEmpty(input)) {
          results.set([]);
          loading.set(false);
        } else {
          loading.set(true);
        }
      }),
      filter((input) => !isEmpty(input)),
      switchMap((input) => fetch(input).pipe(catchError(() => of([] as TResult[])))),
      takeUntilDestroyed(destroyRef),
    )
    .subscribe((rows) => {
      results.set(rows);
      loading.set(false);
    });

  return {
    results: results.asReadonly(),
    loading: loading.asReadonly(),
    current: current.asReadonly(),
    search: (input) => typed$.next(input),
    refresh: (input) => immediate$.next(input ?? current()),
    reset: () => {
      current.set(empty);
      results.set([]);
      loading.set(false);
    },
  };
}

/** Convenience wrapper for the common case: a text query. */
export function createTextSearchStream<TResult>(config: {
  fetch: (term: string) => Observable<TResult[]>;
  destroyRef: DestroyRef;
  minLength: number;
  debounceMs?: number;
}): SearchStream<string, TResult> {
  return createSearchStream<string, TResult>({
    fetch: config.fetch,
    isEmpty: (term) => term.length < config.minLength,
    normalize: (term) => term.trim(),
    keyOf: (term) => term,
    empty: '',
    destroyRef: config.destroyRef,
    debounceMs: config.debounceMs,
  });
}
