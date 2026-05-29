/**
 * SSR guard tests for GoogleCallbackComponent.
 *
 * Invariant: exchangeOAuthToken() must NOT be called on the server
 * (PLATFORM_ID = 'server'). The callback component reads sessionStorage
 * and calls the API inside ngOnInit; without a browser guard this
 * throws ReferenceError in Node and returns 500 for the SSR route.
 */

import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { PLATFORM_ID } from '@angular/core';
import { of, throwError } from 'rxjs';
import { GoogleCallbackComponent } from '../google-callback.component';
import { AuthService } from '../../../../core/services/auth.service';

function createComponent(platformId: string, exchangeMock: jest.Mock) {
  TestBed.configureTestingModule({
    imports: [GoogleCallbackComponent],
    providers: [
      { provide: PLATFORM_ID, useValue: platformId },
      { provide: AuthService, useValue: { exchangeOAuthToken: exchangeMock } },
      { provide: Router, useValue: { navigate: jest.fn(), navigateByUrl: jest.fn() } },
    ],
  });

  const fixture = TestBed.createComponent(GoogleCallbackComponent);
  fixture.detectChanges(); // triggers ngOnInit
  return fixture;
}

describe('GoogleCallbackComponent — SSR platform guard', () => {
  afterEach(() => TestBed.resetTestingModule());

  // ── server platform ────────────────────────────────────────────────────────

  it('does not call exchangeOAuthToken() on the server platform', () => {
    const exchangeMock = jest.fn().mockReturnValue(of({}));

    createComponent('server', exchangeMock);

    expect(exchangeMock).not.toHaveBeenCalled();
  });

  it('does not access sessionStorage on the server platform', () => {
    const getItemSpy = jest.spyOn(Storage.prototype, 'getItem');
    const exchangeMock = jest.fn().mockReturnValue(of({}));

    createComponent('server', exchangeMock);

    expect(getItemSpy).not.toHaveBeenCalled();
    getItemSpy.mockRestore();
  });

  // ── browser platform ───────────────────────────────────────────────────────

  it('calls exchangeOAuthToken() exactly once in the browser', () => {
    const exchangeMock = jest.fn().mockReturnValue(of({}));
    jest.spyOn(Storage.prototype, 'getItem').mockReturnValue('/');
    jest.spyOn(Storage.prototype, 'removeItem').mockReturnValue(undefined);

    createComponent('browser', exchangeMock);

    expect(exchangeMock).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });

  it('navigates to /auth/login when exchangeOAuthToken() errors in the browser', () => {
    const exchangeMock = jest.fn().mockReturnValue(throwError(() => new Error('OAuth failed')));
    const router = { navigate: jest.fn(), navigateByUrl: jest.fn() };
    jest.spyOn(Storage.prototype, 'getItem').mockReturnValue('/');
    jest.spyOn(Storage.prototype, 'removeItem').mockReturnValue(undefined);

    TestBed.configureTestingModule({
      imports: [GoogleCallbackComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: AuthService, useValue: { exchangeOAuthToken: exchangeMock } },
        { provide: Router, useValue: router },
      ],
    });

    TestBed.createComponent(GoogleCallbackComponent).detectChanges();

    expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
    jest.restoreAllMocks();
  });
});
