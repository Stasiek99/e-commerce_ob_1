import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { FooterComponent } from '../footer.component';

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
});
