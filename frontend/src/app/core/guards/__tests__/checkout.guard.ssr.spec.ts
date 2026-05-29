/**
 * SSR guard tests for checkoutGuard.
 *
 * Invariant: sessionStorage.getItem() must NOT be called on the server
 * (PLATFORM_ID = 'server'). Angular Universal executes route guards
 * server-side; an unguarded sessionStorage call throws ReferenceError
 * in Node and returns a 500 for the prerendered route.
 */

import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { PLATFORM_ID, signal } from '@angular/core';
import { checkoutGuard } from '../checkout.guard';
import { CartService } from '../../services/cart.service';
import { AuthService } from '../../services/auth.service';

function runGuard() {
  return TestBed.runInInjectionContext(() => checkoutGuard({} as any, {} as any));
}

describe('checkoutGuard — SSR platform guard', () => {
  let mockRouter: { createUrlTree: jest.Mock; navigate: jest.Mock };
  let mockCart: { items: jest.Mock };
  let mockAuth: { isAuthenticated: jest.Mock };

  function setup(platformId: string, authenticated: boolean, cartEmpty: boolean) {
    mockRouter = {
      createUrlTree: jest.fn((cmds) => ({ commands: cmds })),
      navigate: jest.fn(),
    };
    mockCart  = { items: jest.fn().mockReturnValue(cartEmpty ? [] : [{ id: '1' }]) };
    mockAuth  = { isAuthenticated: jest.fn().mockReturnValue(authenticated) };

    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: platformId },
        { provide: Router, useValue: mockRouter },
        { provide: CartService, useValue: mockCart },
        { provide: AuthService, useValue: mockAuth },
      ],
    });
  }

  afterEach(() => {
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  // ── server platform ────────────────────────────────────────────────────────

  it('does not access sessionStorage on the server when unauthenticated', () => {
    setup('server', false, false);

    const getItemSpy = jest.spyOn(Storage.prototype, 'getItem');

    runGuard();

    expect(getItemSpy).not.toHaveBeenCalled();
  });

  it('redirects to /checkout/auth-choice on the server when unauthenticated', () => {
    setup('server', false, false);

    runGuard();

    expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/checkout/auth-choice']);
  });

  // ── browser platform ───────────────────────────────────────────────────────

  it('returns true for an authenticated user in the browser', () => {
    setup('browser', true, false);

    const result = runGuard();

    expect(result).toBe(true);
  });

  it('returns true for a guest who set checkout_guest flag in the browser', () => {
    setup('browser', false, false);
    jest.spyOn(Storage.prototype, 'getItem').mockReturnValue('1');

    const result = runGuard();

    expect(result).toBe(true);
  });

  it('redirects to /checkout/auth-choice for an unauthenticated user without guest flag', () => {
    setup('browser', false, false);
    jest.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);

    runGuard();

    expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/checkout/auth-choice']);
  });

  it('redirects to /cart when the cart is empty regardless of auth state', () => {
    setup('browser', true, true);

    runGuard();

    expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/cart']);
  });
});
