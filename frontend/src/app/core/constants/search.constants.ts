/**
 * How long typing must pause before a search request is sent.
 *
 * Every keystroke would otherwise cost a round trip and an uncached ranked query
 * over the catalog. 450ms sits just above the ~300ms gap of continuous typing, so
 * a request fires once the user has actually stopped rather than mid-word, while
 * still feeling immediate.
 *
 * Debouncing alone is not enough — a pipeline that debounces but subscribes per
 * emission still leaves superseded requests in flight, and a slow early response
 * can land after a newer one and overwrite it. Always pair this with `switchMap`.
 */
export const SEARCH_DEBOUNCE_MS = 450;

/**
 * Minimum query length before hitting the server. One- and two-character queries
 * match most of the catalog and are never what the user meant to search for yet.
 */
export const SEARCH_MIN_LENGTH = 2;
