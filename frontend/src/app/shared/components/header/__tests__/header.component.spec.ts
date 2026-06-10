import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { DeferBlockBehavior, DeferBlockState } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { HeaderComponent } from '../header.component';
import { CartService } from '../../../../core/services/cart.service';
import { AuthService } from '../../../../core/services/auth.service';
import { WishlistService } from '../../../../core/services/wishlist.service';

function setup(wishlistCount = 0) {
  const wishlistCountSignal = signal(wishlistCount);
  const mockWishlist = {
    count: wishlistCountSignal,
    items: signal([]),
    loading: signal(false),
    isInWishlist: jest.fn().mockReturnValue(false),
    toggle: jest.fn(),
    setNotify: jest.fn(),
  };

  TestBed.configureTestingModule({
    imports: [HeaderComponent],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: WishlistService, useValue: mockWishlist },
      { provide: CartService, useValue: { itemCount: signal(0) } },
      { provide: AuthService, useValue: { isAuthenticated: signal(false) } },
    ],
    deferBlockBehavior: DeferBlockBehavior.Manual,
  });

  TestBed.overrideComponent(HeaderComponent, {
    set: {
      imports: [ReactiveFormsModule],
      schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
    },
  });

  const fixture = TestBed.createComponent(HeaderComponent);
  fixture.detectChanges();
  return { fixture, wishlistCountSignal };
}

function setupWithCounts(cartCount: number, wishlistCount = 0) {
  const cartCountSignal = signal(cartCount);
  const wishlistCountSignal = signal(wishlistCount);
  const mockWishlist = {
    count: wishlistCountSignal,
    items: signal([]),
    loading: signal(false),
    isInWishlist: jest.fn().mockReturnValue(false),
    toggle: jest.fn(),
    setNotify: jest.fn(),
  };

  TestBed.configureTestingModule({
    imports: [HeaderComponent],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: WishlistService, useValue: mockWishlist },
      { provide: CartService, useValue: { itemCount: cartCountSignal } },
      { provide: AuthService, useValue: { isAuthenticated: signal(false) } },
    ],
    deferBlockBehavior: DeferBlockBehavior.Manual,
  });

  TestBed.overrideComponent(HeaderComponent, {
    set: {
      imports: [ReactiveFormsModule],
      schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
    },
  });

  const fixture = TestBed.createComponent(HeaderComponent);
  fixture.detectChanges();
  return { fixture, cartCountSignal, wishlistCountSignal };
}

describe('HeaderComponent — wishlist badge @defer (SSR hydration guard)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('does not render wishlist badge before deferred block resolves', () => {
    // Simulates what the SSR Lambda sees: the deferred block is absent from
    // the initial serialized DOM, so Angular hydration never sees a 0→N mismatch.
    const { fixture } = setup(3);

    const badge = fixture.debugElement.query(By.css('.header__wishlist-badge'));

    expect(badge).toBeNull();
  });

  it('renders badge with correct count after deferred block resolves when count > 0', async () => {
    const { fixture } = setup(3);

    const deferBlocks = await fixture.getDeferBlocks();
    await deferBlocks[0].render(DeferBlockState.Complete);
    fixture.detectChanges();

    const badge = fixture.debugElement.query(By.css('.header__wishlist-badge'));

    expect(badge).not.toBeNull();
    expect(badge.nativeElement.textContent.trim()).toBe('3');
  });

  it('does not render badge after deferred block resolves when count is 0', async () => {
    const { fixture } = setup(0);

    const deferBlocks = await fixture.getDeferBlocks();
    await deferBlocks[0].render(DeferBlockState.Complete);
    fixture.detectChanges();

    const badge = fixture.debugElement.query(By.css('.header__wishlist-badge'));

    expect(badge).toBeNull();
  });

  it('badge count updates reactively when wishlist count changes after defer resolves', async () => {
    const { fixture, wishlistCountSignal } = setup(1);

    const deferBlocks = await fixture.getDeferBlocks();
    await deferBlocks[0].render(DeferBlockState.Complete);
    fixture.detectChanges();

    wishlistCountSignal.set(5);
    fixture.detectChanges();

    const badge = fixture.debugElement.query(By.css('.header__wishlist-badge'));
    expect(badge.nativeElement.textContent.trim()).toBe('5');
  });
});

// ── WCAG 4.1.3 — accessible badge names ───────────────────────────────────────

describe('HeaderComponent — WCAG 4.1.3 cart link accessible name', () => {
  afterEach(() => TestBed.resetTestingModule());

  function getCartLink(fixture: ReturnType<typeof setupWithCounts>['fixture']) {
    return fixture.debugElement.query(By.css('.header__action-link--cart'));
  }

  it('aria-label is "Koszyk" when cart is empty', () => {
    const { fixture } = setupWithCounts(0);

    const link = getCartLink(fixture);

    expect(link.nativeElement.getAttribute('aria-label')).toBe('Koszyk');
  });

  it('aria-label is "Koszyk (3 produktów)" when cart has 3 items', () => {
    const { fixture } = setupWithCounts(3);

    const link = getCartLink(fixture);

    expect(link.nativeElement.getAttribute('aria-label')).toBe('Koszyk (3 produktów)');
  });

  it('aria-label updates reactively when cart count changes from 0 to 2', () => {
    const { fixture, cartCountSignal } = setupWithCounts(0);

    cartCountSignal.set(2);
    fixture.detectChanges();

    expect(getCartLink(fixture).nativeElement.getAttribute('aria-label')).toBe('Koszyk (2 produktów)');
  });

  it('aria-label returns to "Koszyk" when cart is emptied', () => {
    const { fixture, cartCountSignal } = setupWithCounts(1);

    cartCountSignal.set(0);
    fixture.detectChanges();

    expect(getCartLink(fixture).nativeElement.getAttribute('aria-label')).toBe('Koszyk');
  });

  it('cart badge span has aria-hidden="true" so the count is not double-announced', () => {
    const { fixture } = setupWithCounts(4);

    fixture.detectChanges();
    const badge = fixture.debugElement.query(By.css('.header__cart-badge'));

    expect(badge).not.toBeNull();
    expect(badge.nativeElement.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('HeaderComponent — WCAG 4.1.3 wishlist link accessible name', () => {
  afterEach(() => TestBed.resetTestingModule());

  function getWishlistLink(fixture: ReturnType<typeof setupWithCounts>['fixture']) {
    return fixture.debugElement.query(By.css('.header__action-link--wishlist'));
  }

  it('aria-label is "Ulubione" when wishlist is empty', () => {
    const { fixture } = setupWithCounts(0, 0);

    const link = getWishlistLink(fixture);

    expect(link.nativeElement.getAttribute('aria-label')).toBe('Ulubione');
  });

  it('aria-label is "Ulubione (5 produktów)" when wishlist has 5 items', () => {
    const { fixture } = setupWithCounts(0, 5);

    const link = getWishlistLink(fixture);

    expect(link.nativeElement.getAttribute('aria-label')).toBe('Ulubione (5 produktów)');
  });

  it('aria-label updates reactively when wishlist count changes', () => {
    const { fixture, wishlistCountSignal } = setupWithCounts(0, 0);

    wishlistCountSignal.set(3);
    fixture.detectChanges();

    expect(getWishlistLink(fixture).nativeElement.getAttribute('aria-label')).toBe('Ulubione (3 produktów)');
  });

  it('wishlist badge has aria-hidden="true" after defer resolves so count is not double-announced', async () => {
    const { fixture } = setupWithCounts(0, 2);

    const deferBlocks = await fixture.getDeferBlocks();
    await deferBlocks[0].render(DeferBlockState.Complete);
    fixture.detectChanges();

    const badge = fixture.debugElement.query(By.css('.header__wishlist-badge'));
    expect(badge).not.toBeNull();
    expect(badge.nativeElement.getAttribute('aria-hidden')).toBe('true');
  });
});

// ── WCAG 4.1.2 — mobile nav panel focus trap ──────────────────────────────────

describe('HeaderComponent — mobile nav panel focus trap (WCAG)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('mobile nav panel is absent from DOM when menu is closed', () => {
    const { fixture } = setup();

    const panel = fixture.debugElement.query(By.css('.mobile-nav__links'));

    expect(panel).toBeNull();
  });

  it('mobile nav panel has role="dialog" when menu is open', () => {
    const { fixture } = setup();
    const component = fixture.componentInstance;

    component.toggleMobileMenu();
    fixture.detectChanges();

    const panel = fixture.debugElement.query(By.css('.mobile-nav__links'));
    expect(panel.nativeElement.getAttribute('role')).toBe('dialog');
  });

  it('mobile nav panel has aria-modal="true" when menu is open', () => {
    const { fixture } = setup();
    const component = fixture.componentInstance;

    component.toggleMobileMenu();
    fixture.detectChanges();

    const panel = fixture.debugElement.query(By.css('.mobile-nav__links'));
    expect(panel.nativeElement.getAttribute('aria-modal')).toBe('true');
  });

  it('mobile nav panel has aria-label="Menu nawigacyjne" when menu is open', () => {
    const { fixture } = setup();
    const component = fixture.componentInstance;

    component.toggleMobileMenu();
    fixture.detectChanges();

    const panel = fixture.debugElement.query(By.css('.mobile-nav__links'));
    expect(panel.nativeElement.getAttribute('aria-label')).toBe('Menu nawigacyjne');
  });

  it('restores focus to hamburger button when closeMobileMenu is called after opening', () => {
    const { fixture } = setup();
    const component = fixture.componentInstance;

    const hamburger = fixture.debugElement.query(By.css('.header__hamburger'));
    jest.spyOn(hamburger.nativeElement, 'focus');

    component.toggleMobileMenu();
    fixture.detectChanges();

    component.closeMobileMenu();

    expect(hamburger.nativeElement.focus).toHaveBeenCalledTimes(1);
  });

  it('restores focus to hamburger button when toggleMobileMenu closes the panel', () => {
    const { fixture } = setup();
    const component = fixture.componentInstance;

    const hamburger = fixture.debugElement.query(By.css('.header__hamburger'));
    jest.spyOn(hamburger.nativeElement, 'focus');

    component.toggleMobileMenu(); // open
    component.toggleMobileMenu(); // close

    expect(hamburger.nativeElement.focus).toHaveBeenCalledTimes(1);
  });

  it('does not call focus on hamburger when closeMobileMenu is called without prior open', () => {
    const { fixture } = setup();
    const component = fixture.componentInstance;

    const hamburger = fixture.debugElement.query(By.css('.header__hamburger'));
    jest.spyOn(hamburger.nativeElement, 'focus');

    component.closeMobileMenu(); // called without toggleMobileMenu first

    expect(hamburger.nativeElement.focus).not.toHaveBeenCalled();
  });
});
