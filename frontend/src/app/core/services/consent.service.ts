import { HttpClient } from "@angular/common/http";
import {
  Injectable,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from "@angular/core";
import { isPlatformBrowser } from "@angular/common";

interface ConsentState {
  analytics: boolean;
  v: 1;
}

const STORAGE_KEY = "cookie_consent_v1";

@Injectable({ providedIn: "root" })
export class ConsentService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  // Initialized synchronously from localStorage so the banner doesn't flash on returning visitors.
  private readonly _state = signal<ConsentState | null>(this.readStorage());

  readonly hasDecided = computed(() => this._state() !== null);
  readonly analyticsConsented = computed(
    () => this._state()?.analytics === true,
  );
  // False on SSR (no localStorage) so the server-rendered HTML never contains
  // the banner — prevents the flash for returning visitors who already consented.
  readonly bannerVisible = computed(
    () => this.isBrowser && this._state() === null,
  );

  acceptAll(): void {
    this.persistAndRecord({ analytics: true, v: 1 });
  }

  rejectNonEssential(): void {
    this.persistAndRecord({ analytics: false, v: 1 });
  }

  private persistAndRecord(state: ConsentState): void {
    if (this.isBrowser)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    this._state.set(state);
    // Fire-and-forget: GDPR audit trail. Works for both authenticated users
    // (backend updates User.analyticsConsent) and anonymous visitors (creates ConsentLog).
    this.http
      .post("/api/users/consent", { analytics: state.analytics })
      .subscribe({
        error: () => {
          /* non-blocking — localStorage is the local fallback */
        },
      });
  }

  private readStorage(): ConsentState | null {
    if (!this.isBrowser) return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as ConsentState;
      // v-mismatch forces re-consent when new categories are added in future
      return parsed.v === 1 ? parsed : null;
    } catch {
      return null;
    }
  }
}
