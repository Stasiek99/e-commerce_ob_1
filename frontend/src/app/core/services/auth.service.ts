import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, throwError, timer } from 'rxjs';
import { catchError, finalize, retry, shareReplay, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

interface User {
  id: string;
  email: string;
  role: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  nip?: string | null;
  isEmailVerified: boolean;
}

interface TokensResponse {
  accessToken: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly _accessToken = signal<string | null>(null);
  private readonly _user = signal<User | null>(null);

  // Shared in-flight refresh observable. Concurrent calls during the same refresh
  // window all subscribe to the same request via shareReplay, so only one HTTP
  // call is made regardless of how many 401s trigger simultaneously.
  private _refresh$: Observable<TokensResponse> | null = null;

  readonly isAuthenticated = computed(() => this._accessToken() !== null);
  readonly currentUser = this._user.asReadonly();
  readonly isAdmin = computed(() => this._user()?.role === 'ADMIN');

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
          this.clearSession();
          this.router.navigate(['/']);
        }),
        catchError(() => {
          // Best-effort: clear local state even if the server call fails
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
