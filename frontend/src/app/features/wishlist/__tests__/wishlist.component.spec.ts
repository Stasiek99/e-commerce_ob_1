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

  TestBed.overrideComponent(WishlistComponent, {
    set: { imports: [], schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA] },
  });

  const fixture = TestBed.createComponent(WishlistComponent);
  const router = TestBed.inject(Router);
  const navigateSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);

  return { fixture, navigateSpy, mockToast, loadingSignal, itemsSignal };
}

describe('WishlistComponent — empty wishlist keeps empty-state visible (no redirect)', () => {
  afterEach(() => jest.clearAllMocks());

  it('does NOT navigate away when wishlist is empty and not loading', () => {
    const { fixture, navigateSpy } = setup([], false);

    fixture.detectChanges();
    TestBed.flushEffects();

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('does NOT navigate away while wishlist is still loading', () => {
    const { fixture, navigateSpy } = setup([], true);

    fixture.detectChanges();
    TestBed.flushEffects();

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('does NOT navigate away when loading finishes with an empty list', () => {
    const { fixture, navigateSpy, loadingSignal } = setup([], true);

    fixture.detectChanges();
    TestBed.flushEffects();

    loadingSignal.set(false);
    TestBed.flushEffects();

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('does NOT navigate away when wishlist has items', () => {
    const product = { id: 'p1', name: 'Wildman', slug: 'wildman', variants: [{ id: 'v1', stock: 5 }] };
    const { fixture, navigateSpy } = setup([product], false);

    fixture.detectChanges();
    TestBed.flushEffects();

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('does NOT call the info toast on empty wishlist — empty-state UI handles messaging', () => {
    const { fixture, mockToast } = setup([], false);

    fixture.detectChanges();
    TestBed.flushEffects();

    expect(mockToast.info).not.toHaveBeenCalled();
  });

  it('does NOT navigate away when items signal transitions from non-empty to empty', () => {
    const product = { id: 'p1', name: 'Wildman', slug: 'wildman', variants: [{ id: 'v1', stock: 5 }] };
    const { fixture, navigateSpy, itemsSignal } = setup([product], false);

    fixture.detectChanges();
    TestBed.flushEffects();

    itemsSignal.set([]);
    TestBed.flushEffects();

    expect(navigateSpy).not.toHaveBeenCalled();
  });
});
