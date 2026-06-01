import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ProductCardComponent, ProductCardData } from './product-card.component';
import { CartService } from '../../core/services/cart.service';
import { WishlistService } from '../../core/services/wishlist.service';
import { ToastService } from '../../core/services/toast.service';

type VariantInput = NonNullable<ProductCardData['variants']>[number];

const makeVariant = (overrides: Partial<VariantInput> = {}): VariantInput => ({
  id: 'v-1',
  label: '100ml',
  priceInCents: 14900,
  stock: 10,
  ...overrides,
});

const makeProduct = (overrides: Partial<ProductCardData> = {}): ProductCardData => ({
  id: 'prod-1',
  name: 'Test Perfume',
  slug: 'test-perfume',
  brand: 'Aromaterie',
  images: [{ url: 'https://example.com/img.jpg' }],
  variants: [makeVariant()],
  ...overrides,
});

describe('ProductCardComponent — compareAtPriceInCents sale display', () => {
  let fixture: ComponentFixture<ProductCardComponent>;
  let component: ProductCardComponent;

  const mockCart = { addItem: jest.fn() };
  const mockWishlist = {
    isInWishlist: jest.fn().mockReturnValue(false),
    toggle: jest.fn(),
  };
  const mockToast = { info: jest.fn(), success: jest.fn(), error: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [ProductCardComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: CartService, useValue: mockCart },
        { provide: WishlistService, useValue: mockWishlist },
        { provide: ToastService, useValue: mockToast },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProductCardComponent);
    component = fixture.componentInstance;
  });

  // ── no sale price ────────────────────────────────────────────────────────

  describe('when compareAtPriceInCents is null', () => {
    beforeEach(() => {
      component.product = makeProduct({
        variants: [makeVariant({ compareAtPriceInCents: null })],
      });
      fixture.detectChanges();
    });

    it('does not render the PROMOCJA badge', () => {
      const badge = fixture.debugElement.query(By.css('.product-card__sale-badge'));
      expect(badge).toBeNull();
    });

    it('does not render the compare-price element', () => {
      const compare = fixture.debugElement.query(By.css('.product-card__compare-price'));
      expect(compare).toBeNull();
    });

    it('does not apply the sale modifier class to the price element', () => {
      const price = fixture.debugElement.query(By.css('.product-card__price'));
      expect(price.nativeElement.classList.contains('product-card__price--sale')).toBe(false);
    });
  });

  describe('when compareAtPriceInCents is undefined (field absent from DTO)', () => {
    beforeEach(() => {
      component.product = makeProduct({
        variants: [{ id: 'v-1', label: '100ml', priceInCents: 14900, stock: 10 }],
      });
      fixture.detectChanges();
    });

    it('does not render the PROMOCJA badge', () => {
      const badge = fixture.debugElement.query(By.css('.product-card__sale-badge'));
      expect(badge).toBeNull();
    });

    it('does not apply the sale modifier class', () => {
      const price = fixture.debugElement.query(By.css('.product-card__price'));
      expect(price.nativeElement.classList.contains('product-card__price--sale')).toBe(false);
    });
  });

  // ── with sale price ──────────────────────────────────────────────────────

  describe('when compareAtPriceInCents is set (variant is on sale)', () => {
    beforeEach(() => {
      component.product = makeProduct({
        variants: [makeVariant({ priceInCents: 9900, compareAtPriceInCents: 14900 })],
      });
      fixture.detectChanges();
    });

    it('renders the PROMOCJA badge with correct label', () => {
      const badge = fixture.debugElement.query(By.css('.product-card__sale-badge'));
      expect(badge).not.toBeNull();
      expect(badge.nativeElement.textContent.trim()).toBe('PROMOCJA');
    });

    it('renders the compare-price element', () => {
      const compare = fixture.debugElement.query(By.css('.product-card__compare-price'));
      expect(compare).not.toBeNull();
    });

    it('compare-price shows the original (higher) price formatted as PLN', () => {
      const compare = fixture.debugElement.query(By.css('.product-card__compare-price'));
      // PricePipe: 14900 → "149,00 zł"
      expect(compare.nativeElement.textContent).toContain('149,00 zł');
    });

    it('applies the sale modifier class to the price element', () => {
      const price = fixture.debugElement.query(By.css('.product-card__price'));
      expect(price.nativeElement.classList.contains('product-card__price--sale')).toBe(true);
    });

    it('current sale price is still rendered', () => {
      const price = fixture.debugElement.query(By.css('.product-card__price'));
      // PricePipe: 9900 → "99,00 zł"
      expect(price.nativeElement.textContent).toContain('99,00 zł');
    });
  });
});
