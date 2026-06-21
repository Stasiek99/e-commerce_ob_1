import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { Role } from '@fragrance-store/shared-types';
import { AuthService } from '../auth.service';
import { environment } from '../../../../environments/environment';

// jsdom does not implement BroadcastChannel — provide a no-op stub so every
// test that constructs AuthService on the browser platform does not throw.
// Individual describes that need to assert on channel behaviour replace this
// with a jest.fn() spy inside their own beforeEach.
const noop = () => {};
(global as any).BroadcastChannel = jest.fn(() => ({ postMessage: noop, addEventListener: noop, close: noop }));

const REFRESH_URL = `${environment.apiUrl}/auth/refresh`;
const ME_URL = `${environment.apiUrl}/users/me`;
const MOCK_TOKEN = { accessToken: 'tok-abc' };
const MOCK_USER = { id: 'u1', email: 'a@b.com', role: Role.CUSTOMER, isEmailVerified: true };

function setup() {
  TestBed.configureTestingModule({
    providers: [
      AuthService,
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
    ],
  });

  return {
    service: TestBed.inject(AuthService),
    http: TestBed.inject(HttpTestingController),
  };
}

/** Flush both the refresh POST and the subsequent GET /users/me it triggers. */
function flushRefresh(http: HttpTestingController, token = MOCK_TOKEN) {
  http.expectOne(REFRESH_URL).flush(token);
  http.expectOne(ME_URL).flush(MOCK_USER);
}

describe('AuthService — refresh()', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    ({ service, http } = setup());
  });

  afterEach(() => http.verify());

  describe('deduplication', () => {
    it('makes only one HTTP request when called twice concurrently', () => {
      service.refresh().subscribe();
      service.refresh().subscribe();

      flushRefresh(http);
    });
  });

  describe('token storage', () => {
    it('stores the access token returned by the backend', () => {
      service.refresh().subscribe();
      flushRefresh(http, { accessToken: 'tok-xyz' });

      expect(service.getAccessToken()).toBe('tok-xyz');
    });
  });

  describe('observable lifecycle', () => {
    it('clears _refresh$ after completion so a subsequent call makes a fresh request', () => {
      service.refresh().subscribe();
      flushRefresh(http);

      // First observable has completed and cleared _refresh$.
      // A new call must issue a brand-new HTTP request.
      service.refresh().subscribe();
      flushRefresh(http);
    });

    it('preserves _refresh$ when the only subscriber unsubscribes mid-flight — prevents spurious logout', () => {
      // Regression guard for the refCount:true bug:
      // With refCount:true, unsubscribing the last subscriber tore down the upstream —
      // finalize ran, _refresh$ was cleared, and the errorInterceptor saw a cancelled
      // request and navigated to /login.
      service.refresh().subscribe().unsubscribe();

      // _refresh$ must still hold the in-flight observable — finalize must NOT have run.
      const inFlight = (service as any)['_refresh$'];
      expect(inFlight).not.toBeNull();

      // Clean up the pending request to satisfy afterEach verify()
      http.expectOne(REFRESH_URL).flush(MOCK_TOKEN);
      http.expectOne(ME_URL).flush(MOCK_USER);
    });

    it('delivers the response to a late subscriber that joins after an earlier one unsubscribed', () => {
      // Subscriber A triggers refresh then immediately unsubscribes (e.g. component destroyed).
      service.refresh().subscribe().unsubscribe();

      // Subscriber B joins after A left — must reuse the same in-flight observable, not start a new request.
      let received: { accessToken: string } | undefined;
      service.refresh().subscribe((res) => (received = res));

      // Exactly ONE HTTP request must be in flight.
      http.expectOne(REFRESH_URL).flush(MOCK_TOKEN);
      http.expectOne(ME_URL).flush(MOCK_USER);

      expect(received).toEqual(MOCK_TOKEN);
    });
  });
});

// ── BroadcastChannel multi-tab logout ────────────────────────────────────────

const LOGOUT_URL = `${environment.apiUrl}/auth/logout`;

type MockChannel = { postMessage: jest.Mock; addEventListener: jest.Mock; close: jest.Mock };

function setupWithPlatform(platformId: string): { service: AuthService; http: HttpTestingController; mockChannel: MockChannel; BroadcastChannelSpy: jest.Mock } {
  const mockChannel: MockChannel = { postMessage: jest.fn(), addEventListener: jest.fn(), close: jest.fn() };
  const BroadcastChannelSpy = jest.fn(() => mockChannel);
  (global as any).BroadcastChannel = BroadcastChannelSpy;

  TestBed.configureTestingModule({
    providers: [
      AuthService,
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: PLATFORM_ID, useValue: platformId },
    ],
  });

  return {
    service: TestBed.inject(AuthService),
    http: TestBed.inject(HttpTestingController),
    mockChannel,
    BroadcastChannelSpy,
  };
}

describe('AuthService — BroadcastChannel multi-tab logout', () => {
  let service: AuthService;
  let http: HttpTestingController;
  let mockChannel: MockChannel;
  let BroadcastChannelSpy: jest.Mock;

  afterEach(() => {
    http?.verify();
    TestBed.resetTestingModule();
    delete (global as any).BroadcastChannel;
    jest.clearAllMocks();
  });

  describe('browser platform', () => {
    beforeEach(() => {
      ({ service, http, mockChannel, BroadcastChannelSpy } = setupWithPlatform('browser'));
    });

    it('creates the channel with name fragrance-auth', () => {
      expect(BroadcastChannelSpy).toHaveBeenCalledWith('fragrance-auth');
    });

    it('registers a message event listener for cross-tab sync', () => {
      expect(mockChannel.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    });

    it('clears the session when the channel delivers a logout message from another tab', () => {
      // Establish authenticated state
      service.refresh().subscribe();
      http.expectOne(REFRESH_URL).flush(MOCK_TOKEN);
      http.expectOne(ME_URL).flush(MOCK_USER);
      expect(service.isAuthenticated()).toBe(true);

      // Simulate another tab posting 'logout' to the shared channel
      const listener = mockChannel.addEventListener.mock.calls[0][1] as (e: MessageEvent<string>) => void;
      listener({ data: 'logout' } as MessageEvent<string>);

      expect(service.isAuthenticated()).toBe(false);
    });

    it('does NOT clear the session for unrelated channel messages', () => {
      service.refresh().subscribe();
      http.expectOne(REFRESH_URL).flush(MOCK_TOKEN);
      http.expectOne(ME_URL).flush(MOCK_USER);
      expect(service.isAuthenticated()).toBe(true);

      const listener = mockChannel.addEventListener.mock.calls[0][1] as (e: MessageEvent<string>) => void;
      listener({ data: 'unrelated-event' } as MessageEvent<string>);

      expect(service.isAuthenticated()).toBe(true);
    });

    it('posts logout to the channel when logout() completes successfully', () => {
      service.logout().subscribe();
      http.expectOne(LOGOUT_URL).flush({});

      expect(mockChannel.postMessage).toHaveBeenCalledWith('logout');
    });

    it('posts logout to the channel even when the logout HTTP request fails', () => {
      service.logout().subscribe({ error: () => {} });
      http.expectOne(LOGOUT_URL).flush('error', { status: 500, statusText: 'Server Error' });

      expect(mockChannel.postMessage).toHaveBeenCalledWith('logout');
    });
  });

  describe('server platform (SSR)', () => {
    beforeEach(() => {
      ({ service, http, mockChannel, BroadcastChannelSpy } = setupWithPlatform('server'));
    });

    it('does not create a BroadcastChannel on the server platform', () => {
      expect(BroadcastChannelSpy).not.toHaveBeenCalled();
    });
  });
});

// ── magic link ───────────────────────────────────────────────────────────

const MAGIC_LINK_URL = `${environment.apiUrl}/auth/magic-link`;
const MAGIC_LINK_VERIFY_URL = `${environment.apiUrl}/auth/magic-link/verify`;

describe('AuthService — magic link', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    // The preceding BroadcastChannel describe block deletes the global stub in
    // its afterEach — restore it so AuthService's constructor doesn't throw here too.
    (global as any).BroadcastChannel = jest.fn(() => ({ postMessage: noop, addEventListener: noop, close: noop }));
    ({ service, http } = setup());
  });

  afterEach(() => http.verify());

  describe('requestMagicLink()', () => {
    it('POSTs the email to /auth/magic-link', () => {
      service.requestMagicLink('user@example.com').subscribe();

      const req = http.expectOne(MAGIC_LINK_URL);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ email: 'user@example.com' });
      req.flush(null);
    });
  });

  describe('verifyMagicLink()', () => {
    it('POSTs the token to /auth/magic-link/verify', () => {
      service.verifyMagicLink('raw-token').subscribe();

      const req = http.expectOne(MAGIC_LINK_VERIFY_URL);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ token: 'raw-token' });
      req.flush(MOCK_TOKEN);
      http.expectOne(ME_URL).flush(MOCK_USER);
    });

    it('stores the returned access token and logs the user in, same as login()', () => {
      service.verifyMagicLink('raw-token').subscribe();

      http.expectOne(MAGIC_LINK_VERIFY_URL).flush({ accessToken: 'magic-tok' });
      http.expectOne(ME_URL).flush(MOCK_USER);

      expect(service.getAccessToken()).toBe('magic-tok');
      expect(service.isAuthenticated()).toBe(true);
    });
  });
});

// ── isAdmin ──────────────────────────────────────────────────────────────

describe('AuthService — isAdmin', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    // The BroadcastChannel describe block above deletes the global stub in its
    // afterEach — restore it so AuthService's constructor doesn't throw here too.
    (global as any).BroadcastChannel = jest.fn(() => ({ postMessage: noop, addEventListener: noop, close: noop }));
    ({ service, http } = setup());
  });

  afterEach(() => http.verify());

  it('is false when no user is loaded', () => {
    expect(service.isAdmin()).toBe(false);
  });

  it('is true when the current user has the Role.ADMIN enum value', () => {
    service.updateCurrentUser({ ...MOCK_USER, role: Role.ADMIN });
    expect(service.isAdmin()).toBe(true);
  });

  it('is false when the current user has the Role.CUSTOMER enum value', () => {
    service.updateCurrentUser({ ...MOCK_USER, role: Role.CUSTOMER });
    expect(service.isAdmin()).toBe(false);
  });

  it('reflects the role returned by GET /users/me after refresh', () => {
    service.refresh().subscribe();
    http.expectOne(REFRESH_URL).flush(MOCK_TOKEN);
    http.expectOne(ME_URL).flush({ ...MOCK_USER, role: Role.ADMIN });

    expect(service.isAdmin()).toBe(true);
  });
});
