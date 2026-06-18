import { Injectable, signal, computed, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, throwError, timer } from 'rxjs';
import { catchError, finalize, retry, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { Role } from '@fragrance-store/shared-types';

interface User {
  id: string;
  email: string;
  role: Role;
  firstName?: string;
  lastName?: string;
  phone?: string;
  nip?: string | null;
  isEmailVerified: boolean;
  marketingConsent?: boolean;
}

interface TokensResponse {
  accessToken: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly _accessToken = signal<string | null>(null);
  private readonly _user = signal<User | null>(null);

  // Syncs explicit logouts across open tabs. Only created in browser — SSR has no BroadcastChannel.
  private readonly _logoutChannel: BroadcastChannel | null = isPlatformBrowser(this.platformId)
    ? new BroadcastChannel('fragrance-auth')
    : null;

  constructor() {
    this._logoutChannel?.addEventListener('message', (e: MessageEvent<string>) => {
      if (e.data === 'logout') this.clearSession();
    });
  }

  // Shared in-flight refresh observable. Concurrent calls during the same refresh
  // window all subscribe to the same request via shareReplay, so only one HTTP
  // call is made regardless of how many 401s trigger simultaneously.
  private _refresh$: Observable<TokensResponse> | null = null;

  readonly isAuthenticated = computed(() => this._accessToken() !== null);
  readonly currentUser = this._user.asReadonly();
  readonly isAdmin = computed(() => this._user()?.role === Role.ADMIN);

  getAccessToken(): string | null {
    return this._accessToken();
  }

  register(email: string, password: string, firstName?: string, lastName?: string) {
    return this.http
      .post<TokensResponse>(
        `${environment.apiUrl}/auth/register`,
        { email, password, firstName, lastName },
        { withCredentials: true },
      )
      .pipe(tap((res) => this.setToken(res.accessToken)));
  }

  login(email: string, password: string) {
    return this.http
      .post<TokensResponse>(
        `${environment.apiUrl}/auth/login`,
        { email, password },
        { withCredentials: true },
      )
      .pipe(tap((res) => this.setToken(res.accessToken)));
  }

  loginWithGoogle() {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    const state = Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem('oauth_state', state);
    window.location.href = `${environment.apiUrl}/auth/google`;
  }

  exchangeOAuthToken() {
    // The backend embeds a one-time nonce in the redirect fragment (#state=<nonce>).
    // We read it here (never sent to the server as a URL param) and POST it with
    // the exchange request so the backend can verify + consume it atomically.
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const nonce = new URLSearchParams(hash.replace(/^#/, '')).get('state') ?? '';
    return this.http
      .post<TokensResponse>(
        `${environment.apiUrl}/auth/token/exchange`,
        { nonce },
        { withCredentials: true },
      )
      .pipe(tap((res) => this.setToken(res.accessToken)));
  }

  refresh(): Observable<TokensResponse> {
    if (!this._refresh$) {
      this._refresh$ = this.http
        .post<TokensResponse>(`${environment.apiUrl}/auth/refresh`, {}, { withCredentials: true })
        .pipe(
          // Retry once on pure network drops (status 0). Don't retry 401 — the
          // backend's 30-second grace window handles the server-side recovery.
          retry({
            count: 1,
            delay: (err: unknown) => {
              if (err instanceof HttpErrorResponse && err.status === 0) return timer(1000);
              return throwError(() => err);
            },
          }),
          tap((res) => this.setToken(res.accessToken)),
          finalize(() => { this._refresh$ = null; }),
          shareReplay({ bufferSize: 1, refCount: false }),
        );
    }
    return this._refresh$;
  }

  updateCurrentUser(user: User) {
    this._user.set(user);
  }

  clearSession() {
    this._accessToken.set(null);
    this._user.set(null);
  }

  logout() {
    return this.http
      .post(`${environment.apiUrl}/auth/logout`, {}, { withCredentials: true })
      .pipe(
        tap(() => {
          this._logoutChannel?.postMessage('logout');
          this.clearSession();
          this.router.navigate(['/']);
        }),
        catchError(() => {
          // Best-effort: clear local state even if the server call fails
          this._logoutChannel?.postMessage('logout');
          this.clearSession();
          this.router.navigate(['/']);
          return throwError(() => new Error('Logout failed'));
        }),
      );
  }

  verifyEmail(token: string) {
    return this.http.post(
      `${environment.apiUrl}/auth/verify-email`,
      { token },
      { withCredentials: true },
    );
  }

  resendVerification() {
    return this.http.post(
      `${environment.apiUrl}/auth/resend-verification`,
      {},
      { withCredentials: true },
    );
  }

  forgotPassword(email: string) {
    return this.http.post(
      `${environment.apiUrl}/auth/forgot-password`,
      { email },
      { withCredentials: true },
    );
  }

  resetPassword(token: string, password: string) {
    return this.http.post(
      `${environment.apiUrl}/auth/reset-password`,
      { token, password },
      { withCredentials: true },
    );
  }

  loadCurrentUser() {
    if (!this._accessToken()) return;
    this.http
      .get<User>(`${environment.apiUrl}/users/me`)
      .subscribe({ next: (user) => this._user.set(user), error: () => {} });
  }

  private setToken(token: string) {
    this._accessToken.set(token);
    this.loadCurrentUser();
  }
}
