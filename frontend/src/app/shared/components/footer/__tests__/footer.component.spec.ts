import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { FooterComponent } from '../footer.component';
import { environment } from '../../../../../environments/environment';

function setup() {
  TestBed.configureTestingModule({
    imports: [FooterComponent],
    providers: [provideRouter([])],
  });
  const fixture = TestBed.createComponent(FooterComponent);
  fixture.detectChanges();
  return { fixture };
}

describe('FooterComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  describe('ODR platform link (EU Reg. 524/2013 Art. 14)', () => {
    function getOdrLink(fixture: ReturnType<typeof setup>['fixture']) {
      return fixture.debugElement
        .queryAll(By.css('.footer__legal a'))
        .find((el) => (el.nativeElement as HTMLAnchorElement).href.includes('ec.europa.eu/consumers/odr'));
    }

    it('renders an ODR link in the legal nav section', () => {
      const { fixture } = setup();

      expect(getOdrLink(fixture)).toBeTruthy();
    });

    it('ODR link points to the EC platform URL', () => {
      const { fixture } = setup();

      const link = getOdrLink(fixture)!;
      expect(link.nativeElement.getAttribute('href')).toBe('https://ec.europa.eu/consumers/odr');
    });

    it('ODR link opens in a new tab', () => {
      const { fixture } = setup();

      const link = getOdrLink(fixture)!;
      expect(link.nativeElement.getAttribute('target')).toBe('_blank');
    });

    it('ODR link has rel="noopener" to prevent tab-napping', () => {
      const { fixture } = setup();

      const link = getOdrLink(fixture)!;
      expect(link.nativeElement.getAttribute('rel')).toContain('noopener');
    });

    it('ODR link text contains "Platforma ODR"', () => {
      const { fixture } = setup();

      const link = getOdrLink(fixture)!;
      expect(link.nativeElement.textContent).toContain('Platforma ODR');
    });

    it('ODR link is always visible — not gated on any user state', () => {
      const { fixture } = setup();

      // Rendered unconditionally regardless of auth or cart state
      expect(getOdrLink(fixture)).toBeTruthy();
    });
  });

  // ── UŚUDE Art. 5 — mandatory seller identity block ───────────────────────────
  // Art. 5(1) UŚUDE requires legalName, address, NIP, REGON, KRS/CEIDG, and contact
  // email to be displayed "clearly and unambiguously, accessible at any time" on every page.

  describe('UŚUDE Art. 5 — mandatory seller identity block', () => {
    function getSellerBlock(fixture: ReturnType<typeof setup>['fixture']) {
      return fixture.debugElement.query(By.css('address.footer__seller'));
    }

    it('renders the footer__seller address block on every page load', () => {
      const { fixture } = setup();

      expect(getSellerBlock(fixture)).toBeTruthy();
    });

    it('seller block has aria-label "Dane sprzedawcy" for screen-reader accessibility', () => {
      const { fixture } = setup();

      const block = getSellerBlock(fixture);
      expect(block.nativeElement.getAttribute('aria-label')).toBe('Dane sprzedawcy');
    });

    it('renders seller legal name from environment.seller', () => {
      const { fixture } = setup();

      const block = getSellerBlock(fixture);
      expect(block.nativeElement.textContent).toContain(environment.seller.legalName);
    });

    it('renders NIP identifier from environment.seller', () => {
      const { fixture } = setup();

      const block = getSellerBlock(fixture);
      expect(block.nativeElement.textContent).toContain(environment.seller.nip);
    });

    it('renders REGON identifier from environment.seller', () => {
      const { fixture } = setup();

      const block = getSellerBlock(fixture);
      expect(block.nativeElement.textContent).toContain(environment.seller.regon);
    });

    it('renders KRS/CEIDG number from environment.seller', () => {
      const { fixture } = setup();

      const block = getSellerBlock(fixture);
      expect(block.nativeElement.textContent).toContain(environment.seller.krs);
    });

    it('renders street address from environment.seller', () => {
      const { fixture } = setup();

      const block = getSellerBlock(fixture);
      expect(block.nativeElement.textContent).toContain(environment.seller.street);
    });

    it('renders city from environment.seller', () => {
      const { fixture } = setup();

      const block = getSellerBlock(fixture);
      expect(block.nativeElement.textContent).toContain(environment.seller.city);
    });

    it('renders contact email as a mailto: link', () => {
      const { fixture } = setup();

      const emailLink = fixture.debugElement.query(By.css('address.footer__seller a'));
      expect(emailLink.nativeElement.getAttribute('href')).toBe(`mailto:${environment.seller.email}`);
    });

    it('email link displays the email address as its visible text', () => {
      const { fixture } = setup();

      const emailLink = fixture.debugElement.query(By.css('address.footer__seller a'));
      expect(emailLink.nativeElement.textContent.trim()).toBe(environment.seller.email);
    });

    it('seller block is rendered unconditionally — not gated on auth or cart state', () => {
      const { fixture } = setup();

      expect(getSellerBlock(fixture)).toBeTruthy();
    });
  });
});
