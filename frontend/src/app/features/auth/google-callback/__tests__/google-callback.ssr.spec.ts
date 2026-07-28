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
import { CartService } from '../../../../core/services/cart.service';

function mockCart() {
  return { mergeWithServer: jest.fn().mockReturnValue(of({})), loadCart: jest.fn() };
}

function createComponent(platformId: string, exchangeMock: jest.Mock) {
  TestBed.configureTestingModule({
    imports: [GoogleCallbackComponent],
    providers: [
      { provide: PLATFORM_ID, useValue: platformId },
      { provide: AuthService, useValue: { exchangeOAuthToken: exchangeMock } },
      { provide: CartService, useValue: mockCart() },
      { provide: Router, useValue: { navigate: jest.fn(), navigateByUrl: jest.fn() } },
    ],
  });

  const fixture = TestBed.createComponent(GoogleCallbackComponent);
  fixture.detectChanges(); // triggers ngOnInit
  return fixture;
}

function createComponentWithReturnTo(returnTo: string | null, router: { navigate: jest.Mock; navigateByUrl: jest.Mock }) {
  const exchangeMock = jest.fn().mockReturnValue(of({}));
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
    if (key === 'auth_return_to') return returnTo;
    return null;
  });
  jest.spyOn(Storage.prototype, 'removeItem').mockReturnValue(undefined);

  TestBed.configureTestingModule({
    imports: [GoogleCallbackComponent],
    providers: [
      { provide: PLATFORM_ID, useValue: 'browser' },
      { provide: AuthService, useValue: { exchangeOAuthToken: exchangeMock } },
      { provide: CartService, useValue: mockCart() },
      { provide: Router, useValue: router },
    ],
  });

  TestBed.createComponent(GoogleCallbackComponent).detectChanges();
}

describe('GoogleCallbackComponent — open-redirect guard on returnTo', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
  });

  it('navigates to / when returnTo is an absolute URL (phishing attempt)', () => {
    const router = { navigate: jest.fn(), navigateByUrl: jest.fn() };

    createComponentWithReturnTo('https://attacker.com/steal-token', router);

    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('navigates to / when returnTo is a protocol-relative URL (//attacker.com)', () => {
    const router = { navigate: jest.fn(), navigateByUrl: jest.fn() };

    createComponentWithReturnTo('//attacker.com', router);

    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('navigates to the relative path when returnTo is a safe internal route', () => {
    const router = { navigate: jest.fn(), navigateByUrl: jest.fn() };

    createComponentWithReturnTo('/account/profile', router);

    expect(router.navigateByUrl).toHaveBeenCalledWith('/account/profile');
  });

  it('navigates to / when sessionStorage has no returnTo entry (returns null)', () => {
    const router = { navigate: jest.fn(), navigateByUrl: jest.fn() };

    createComponentWithReturnTo(null, router);

    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('navigates to / for a bare empty string returnTo', () => {
    const router = { navigate: jest.fn(), navigateByUrl: jest.fn() };

    createComponentWithReturnTo('', router);

    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
  });
});

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
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
      if (key === 'auth_return_to') return '/';
      return null;
    });
    jest.spyOn(Storage.prototype, 'removeItem').mockReturnValue(undefined);

    createComponent('browser', exchangeMock);

    expect(exchangeMock).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
  });

  it('navigates to /auth/login when exchangeOAuthToken() errors in the browser', () => {
    const exchangeMock = jest.fn().mockReturnValue(throwError(() => new Error('OAuth failed')));
    const router = { navigate: jest.fn(), navigateByUrl: jest.fn() };
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) => {
      if (key === 'auth_return_to') return '/';
      return null;
    });
    jest.spyOn(Storage.prototype, 'removeItem').mockReturnValue(undefined);

    TestBed.configureTestingModule({
      imports: [GoogleCallbackComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: AuthService, useValue: { exchangeOAuthToken: exchangeMock } },
        { provide: CartService, useValue: mockCart() },
        { provide: Router, useValue: router },
      ],
    });

    TestBed.createComponent(GoogleCallbackComponent).detectChanges();

    expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
    jest.restoreAllMocks();
  });
});

describe('GoogleCallbackComponent — no dead CSRF state mechanism', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
  });

  it('does not read or write the legacy oauth_state sessionStorage key', () => {
    const getItemSpy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation((key: string) =>
      key === 'auth_return_to' ? '/account' : null,
    );
    const removeItemSpy = jest.spyOn(Storage.prototype, 'removeItem').mockReturnValue(undefined);
    const exchangeMock = jest.fn().mockReturnValue(of({}));
    const router = { navigate: jest.fn(), navigateByUrl: jest.fn() };

    TestBed.configureTestingModule({
      imports: [GoogleCallbackComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: AuthService, useValue: { exchangeOAuthToken: exchangeMock } },
        { provide: CartService, useValue: mockCart() },
        { provide: Router, useValue: router },
      ],
    });
    TestBed.createComponent(GoogleCallbackComponent).detectChanges();

    expect(getItemSpy).not.toHaveBeenCalledWith('oauth_state');
    expect(removeItemSpy).not.toHaveBeenCalledWith('oauth_state');
    expect(exchangeMock).toHaveBeenCalledTimes(1);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/account');
  });
});
