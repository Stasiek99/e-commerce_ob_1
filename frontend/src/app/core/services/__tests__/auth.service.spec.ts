import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../auth.service';
import { environment } from '../../../../environments/environment';

const REFRESH_URL = `${environment.apiUrl}/auth/refresh`;
const ME_URL = `${environment.apiUrl}/users/me`;
const MOCK_TOKEN = { accessToken: 'tok-abc' };
const MOCK_USER = { id: 'u1', email: 'a@b.com', role: 'USER', isEmailVerified: true };

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
