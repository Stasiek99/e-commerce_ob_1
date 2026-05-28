import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { WishlistComponent } from '../wishlist.component';
import { WishlistService } from '../../../core/services/wishlist.service';
import { CartService } from '../../../core/services/cart.service';
import { ToastService } from '../../../core/services/toast.service';
import { AuthService } from '../../../core/services/auth.service';

function setup(wishlistItems: unknown[] = [], loading = false) {
  const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
  const mockCart = { addItem: jest.fn(), refreshFromServer: jest.fn() };
  const mockAuth = { isAuthenticated: jest.fn().mockReturnValue(false) };

  const itemsSignal = signal(wishlistItems);
  const loadingSignal = signal(loading);

  const mockWishlist = {
    items: itemsSignal,
    loading: loadingSignal,
    setNotify: jest.fn(),
  };

  TestBed.configureTestingModule({
    imports: [WishlistComponent],
    providers: [
      provideRouter([]),
      { provide: WishlistService, useValue: mockWishlist },
      { provide: CartService, useValue: mockCart },
      { provide: ToastService, useValue: mockToast },
      { provide: AuthService, useValue: mockAuth },
    ],
    schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
  });

  // Strip RouterLink from the component's own imports so detectChanges doesn't
  // try to hydrate it against an empty router state (no root route configured).
  TestBed.overrideComponent(WishlistComponent, {
    set: { imports: [], schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA] },
  });

  const fixture = TestBed.createComponent(WishlistComponent);
  const router = TestBed.inject(Router);
  const navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);

  return { fixture, navigateSpy, mockToast, loadingSignal };
}

describe('WishlistComponent — empty wishlist redirect', () => {
  afterEach(() => jest.clearAllMocks());

  it('navigates to /products when wishlist is empty and not loading', () => {
    const { fixture, navigateSpy } = setup([], false);

    fixture.detectChanges();
    TestBed.flushEffects();

    expect(navigateSpy).toHaveBeenCalledWith(['/products']);
  });

  it('shows an info toast before redirecting so the user knows why', () => {
    const { fixture, navigateSpy, mockToast } = setup([], false);

    fixture.detectChanges();
    TestBed.flushEffects();

    expect(mockToast.info).toHaveBeenCalledWith(
      'Nie masz jeszcze żadnych ulubionych produktów.',
    );
    expect(navigateSpy).toHaveBeenCalledWith(['/products']);
  });

  it('fires toast before navigate — not after', () => {
    const callOrder: string[] = [];
    const { fixture, navigateSpy, mockToast } = setup([], false);
    mockToast.info.mockImplementation(() => callOrder.push('toast'));
    navigateSpy.mockImplementation(() => { callOrder.push('navigate'); return Promise.resolve(true); });

    fixture.detectChanges();
    TestBed.flushEffects();

    expect(callOrder).toEqual(['toast', 'navigate']);
  });

  it('does NOT redirect while still loading', () => {
    const { fixture, navigateSpy, loadingSignal } = setup([], true);

    fixture.detectChanges();
    TestBed.flushEffects();

    expect(navigateSpy).not.toHaveBeenCalled();

    loadingSignal.set(false);
    TestBed.flushEffects();

    expect(navigateSpy).toHaveBeenCalledWith(['/products']);
  });

  it('does NOT redirect when wishlist has items', () => {
    const product = { id: 'p1', name: 'Wildman', slug: 'wildman', variants: [{ id: 'v1', stock: 5 }] };
    const { fixture, navigateSpy } = setup([product], false);

    fixture.detectChanges();
    TestBed.flushEffects();

    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
