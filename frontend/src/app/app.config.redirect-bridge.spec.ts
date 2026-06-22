/**
 * Regression guard for bridgeGuardRedirectsToHttp (app.config.ts).
 *
 * Angular Universal does not turn a guard-returned UrlTree into a real HTTP
 * redirect on its own — without this bridge, a guard redirect (e.g.
 * checkoutGuard sending an empty cart from /checkout to /cart) would render
 * silently under the original URL at status 200 instead of issuing a 3xx.
 */

import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { NavigationEnd, NavigationStart, Router } from '@angular/router';
import { Subject } from 'rxjs';

import { bridgeGuardRedirectsToHttp } from './app.config';
import { RESPONSE } from './core/tokens/ssr.tokens';

function setup(
  platformId: string,
  responseOverride?: { headersSent: boolean; redirect: jest.Mock } | null,
) {
  const events = new Subject<unknown>();
  const mockRouter = { events: events.asObservable() } as unknown as Router;
  const mockResponse = responseOverride ?? { headersSent: false, redirect: jest.fn() };

  const providers: unknown[] = [
    { provide: PLATFORM_ID, useValue: platformId },
    { provide: Router, useValue: mockRouter },
  ];
  if (responseOverride !== null) {
    providers.push({ provide: RESPONSE, useValue: mockResponse });
  }

  TestBed.configureTestingModule({ providers });

  return { events, mockResponse };
}

describe('bridgeGuardRedirectsToHttp', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('redirects when the final navigation lands on a different URL than requested (server)', () => {
    const { events, mockResponse } = setup('server');

    TestBed.runInInjectionContext(() => bridgeGuardRedirectsToHttp());

    events.next(new NavigationStart(1, '/checkout'));
    events.next(new NavigationEnd(1, '/cart', '/cart'));

    expect(mockResponse.redirect).toHaveBeenCalledWith(302, '/cart');
  });

  it('does not redirect when navigation settles on the requested URL (server)', () => {
    const { events, mockResponse } = setup('server');

    TestBed.runInInjectionContext(() => bridgeGuardRedirectsToHttp());

    events.next(new NavigationStart(1, '/products/abc'));
    events.next(new NavigationEnd(1, '/products/abc', '/products/abc'));

    expect(mockResponse.redirect).not.toHaveBeenCalled();
  });

  it('only acts on the first NavigationEnd and then unsubscribes', () => {
    const { events, mockResponse } = setup('server');

    TestBed.runInInjectionContext(() => bridgeGuardRedirectsToHttp());

    events.next(new NavigationStart(1, '/checkout'));
    events.next(new NavigationEnd(1, '/cart', '/cart'));
    events.next(new NavigationStart(2, '/cart'));
    events.next(new NavigationEnd(2, '/account', '/account'));

    expect(mockResponse.redirect).toHaveBeenCalledTimes(1);
    expect(mockResponse.redirect).toHaveBeenCalledWith(302, '/cart');
  });

  it('does not redirect again if headers were already sent', () => {
    const { events, mockResponse } = setup('server', { headersSent: true, redirect: jest.fn() });

    TestBed.runInInjectionContext(() => bridgeGuardRedirectsToHttp());

    events.next(new NavigationStart(1, '/checkout'));
    events.next(new NavigationEnd(1, '/cart', '/cart'));

    expect(mockResponse.redirect).not.toHaveBeenCalled();
  });

  it('is a no-op in the browser, regardless of RESPONSE availability', () => {
    const { events, mockResponse } = setup('browser');

    expect(() => TestBed.runInInjectionContext(() => bridgeGuardRedirectsToHttp())).not.toThrow();

    events.next(new NavigationStart(1, '/checkout'));
    events.next(new NavigationEnd(1, '/cart', '/cart'));

    expect(mockResponse.redirect).not.toHaveBeenCalled();
  });

  it('is a no-op on the server when RESPONSE is not provided', () => {
    setup('server', null);

    expect(() => TestBed.runInInjectionContext(() => bridgeGuardRedirectsToHttp())).not.toThrow();
  });
});
