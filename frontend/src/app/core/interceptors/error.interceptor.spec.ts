import { TestBed } from '@angular/core/testing';
import {
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';
import { Router } from '@angular/router';
import { errorInterceptor } from './error.interceptor';
import { AuthService } from '../services/auth.service';

describe('errorInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let authService: {
    refresh: jest.Mock;
    clearSession: jest.Mock;
    logout: jest.Mock;
    getAccessToken: jest.Mock;
  };
  let mockRouter: { navigate: jest.Mock };

  beforeEach(() => {
    authService = {
      refresh: jest.fn(),
      clearSession: jest.fn(),
      logout: jest.fn().mockReturnValue(of(null)),
      getAccessToken: jest.fn().mockReturnValue(null),
    };
    mockRouter = { navigate: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: authService },
        { provide: Router, useValue: mockRouter },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('passes non-401 errors through without touching AuthService', (done) => {
    http.get('/api/products').subscribe({
      error: (err: HttpErrorResponse) => {
        expect(err.status).toBe(500);
        expect(authService.refresh).not.toHaveBeenCalled();
        done();
      },
    });

    httpMock.expectOne('/api/products').flush(null, {
      status: 500,
      statusText: 'Server Error',
    });
  });

  it('passes 401 on /auth/ routes through without refreshing', (done) => {
    http.post('/api/auth/login', {}).subscribe({
      error: (err: HttpErrorResponse) => {
        expect(err.status).toBe(401);
        expect(authService.refresh).not.toHaveBeenCalled();
        done();
      },
    });

    httpMock.expectOne('/api/auth/login').flush(null, {
      status: 401,
      statusText: 'Unauthorized',
    });
  });

  it('refreshes the token and retries the original request on 401', (done) => {
    const newToken = 'new-access-token';
    authService.refresh.mockReturnValue(of({ accessToken: newToken }));

    http.get('/api/orders').subscribe({
      next: (data) => {
        expect(authService.refresh).toHaveBeenCalledTimes(1);
        expect(data).toEqual({ orders: [] });
        done();
      },
    });

    // First request → 401
    httpMock.expectOne('/api/orders').flush(null, {
      status: 401,
      statusText: 'Unauthorized',
    });

    // Retry carries the new Authorization header AND the X-Retry guard header
    const retry = httpMock.expectOne('/api/orders');
    expect(retry.request.headers.get('Authorization')).toBe(`Bearer ${newToken}`);
    expect(retry.request.headers.get('X-Retry')).toBe('1');
    retry.flush({ orders: [] });
  });

  it('does not trigger a second refresh when a retried request returns 401 (X-Retry prevents infinite loop)', (done) => {
    const newToken = 'new-access-token';
    authService.refresh.mockReturnValue(of({ accessToken: newToken }));

    http.get('/api/orders').subscribe({
      error: () => {
        // refresh called exactly once — the second 401 is passed through
        expect(authService.refresh).toHaveBeenCalledTimes(1);
        done();
      },
    });

    // First request → 401 (triggers refresh + retry)
    httpMock.expectOne('/api/orders').flush(null, {
      status: 401,
      statusText: 'Unauthorized',
    });

    // Retried request also 401s — must NOT trigger another refresh
    httpMock.expectOne('/api/orders').flush(null, {
      status: 401,
      statusText: 'Unauthorized',
    });
  });

  it('clears session and navigates to /auth/login without calling logout() when refresh fails', (done) => {
    authService.refresh.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 401 })),
    );

    http.get('/api/orders').subscribe({
      error: () => {
        expect(authService.clearSession).toHaveBeenCalledTimes(1);
        expect(authService.logout).not.toHaveBeenCalled();
        expect(mockRouter.navigate).toHaveBeenCalledWith(['/auth/login']);
        done();
      },
    });

    httpMock.expectOne('/api/orders').flush(null, {
      status: 401,
      statusText: 'Unauthorized',
    });
  });

  it('re-throws the refresh error so callers can react', (done) => {
    const refreshError = new HttpErrorResponse({ status: 401 });
    authService.refresh.mockReturnValue(throwError(() => refreshError));

    http.get('/api/orders').subscribe({
      error: (err) => {
        expect(err).toBe(refreshError);
        done();
      },
    });

    httpMock.expectOne('/api/orders').flush(null, {
      status: 401,
      statusText: 'Unauthorized',
    });
  });
});
