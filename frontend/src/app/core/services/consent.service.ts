import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

interface ConsentState {
  analytics: boolean;
  v: 1;
}

const STORAGE_KEY = 'cookie_consent_v1';

@Injectable({ providedIn: 'root' })
export class ConsentService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  // Initialized synchronously from localStorage so the banner doesn't flash on returning visitors.
  private readonly _state = signal<ConsentState | null>(this.readStorage());

  readonly hasDecided = computed(() => this._state() !== null);
  readonly analyticsConsented = computed(() => this._state()?.analytics === true);

  acceptAll(): void {
    this.persist({ analytics: true, v: 1 });
  }

  rejectNonEssential(): void {
    this.persist({ analytics: false, v: 1 });
  }

  private persist(state: ConsentState): void {
    if (this.isBrowser) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    this._state.set(state);
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
