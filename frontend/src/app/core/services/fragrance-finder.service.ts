import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

/** One selectable olfactory note, as served by `GET /products/finder/notes`. */
export interface FinderNote {
  /** Normalized key — this is what the match endpoint expects, not the label. */
  key: string;
  /** Display spelling with Polish diacritics ("Jaśmin"). */
  label: string;
  /** How many products carry the note; the API returns them most-common first. */
  count: number;
}

/**
 * Full product payload, matching the backend's PRODUCT_SELECT.
 *
 * Both finder modes deliberately hit endpoints that return this complete shape
 * (`/products?search=` and `/products/finder/match`) rather than the trimmed
 * `/products/suggest` used by the header dropdown: results render as real
 * product cards with working add-to-cart, which needs variant `id` and `stock`.
 */
export interface FinderProduct {
  id: string;
  name: string;
  slug: string;
  brand?: string | null;
  gender?: string | null;
  catalogNumber?: string | null;
  category?: { id: string; name: string; slug: string } | null;
  images?: Array<{ url: string }>;
  variants?: Array<{
    id: string;
    label: string;
    priceInCents: number;
    compareAtPriceInCents?: number | null;
    lowestPrice30dInCents?: number | null;
    stock: number;
    volume?: number | null;
  }>;
  /** Which of the selected notes this product actually carries — drives the
   *  "wspólne nuty" line, i.e. the reason the product was suggested.
   *  Always empty in name mode, which does not match on notes. */
  matchedNotes: string[];
}

export interface FinderMatchResponse {
  data: FinderProduct[];
  meta: { total: number; limit: number };
}

export interface FinderMatchQuery {
  /** Either normalized keys from `notes$` or raw display strings off a product —
   *  the backend normalizes both with the same function. */
  notes: string[];
  gender?: string[];
  category?: string;
  /** Product id to omit, so "similar fragrances" never lists the current one. */
  exclude?: string;
  limit?: number;
}

@Injectable({ providedIn: 'root' })
export class FragranceFinderService {
  private readonly http = inject(HttpClient);

  /**
   * The note vocabulary is derived from the catalog and changes only when
   * products do, so it is fetched once per app load and shared by every finder
   * instance (page, home section, header dialog, catalog empty state).
   * `shareReplay` with `refCount: false` keeps the value cached after the last
   * subscriber unsubscribes — reopening the dialog must not refetch.
   */
  readonly notes$: Observable<FinderNote[]> = this.http
    .get<FinderNote[]>(`${environment.apiUrl}/products/finder/notes`)
    .pipe(
      catchError(() => of([])),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

  /**
   * Name/brand search for the finder's first mode.
   *
   * Hits the catalog list endpoint, not `/products/suggest`: same typo- and
   * abbreviation-tolerant matcher behind both, but this one returns the full
   * product payload the card needs and accepts the gender filter server-side.
   */
  searchByName(query: {
    term: string;
    gender?: string[];
    category?: string;
    limit?: number;
  }): Observable<FinderMatchResponse> {
    let params = new HttpParams()
      .set('search', query.term)
      .set('limit', String(query.limit ?? 8));
    for (const gender of query.gender ?? []) {
      params = params.append('gender', gender);
    }
    if (query.category) params = params.set('category', query.category);

    return this.http
      .get<{ data: FinderProduct[]; meta: { total: number } }>(`${environment.apiUrl}/products`, {
        params,
      })
      .pipe(
        map((response) => ({
          data: response.data.map((p) => ({ ...p, matchedNotes: [] })),
          meta: { total: response.meta.total, limit: query.limit ?? 8 },
        })),
        catchError(() => of({ data: [], meta: { total: 0, limit: query.limit ?? 8 } })),
      );
  }

  match(query: FinderMatchQuery): Observable<FinderMatchResponse> {
    let params = new HttpParams();
    for (const note of query.notes) {
      params = params.append('notes', note);
    }
    for (const gender of query.gender ?? []) {
      params = params.append('gender', gender);
    }
    if (query.category) params = params.set('category', query.category);
    if (query.exclude) params = params.set('exclude', query.exclude);
    if (query.limit) params = params.set('limit', String(query.limit));

    return this.http
      .get<FinderMatchResponse>(`${environment.apiUrl}/products/finder/match`, { params })
      .pipe(catchError(() => of({ data: [], meta: { total: 0, limit: query.limit ?? 12 } })));
  }
}
