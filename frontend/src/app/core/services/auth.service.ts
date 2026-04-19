import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

interface User {
  id: string;
  email: string;
  role: string;
  firstName?: string;
  lastName?: string;
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

  handleGoogleCallback(token: string) {
    this.setToken(token);
  }

  refresh() {
    return this.http
      .post<TokensResponse>(`${environment.apiUrl}/auth/refresh`, {}, { withCredentials: true })
      .pipe(tap((res) => this.setToken(res.accessToken)));
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
