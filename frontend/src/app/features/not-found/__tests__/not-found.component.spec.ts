import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouterLink, provideRouter } from '@angular/router';
import { Meta } from '@angular/platform-browser';
import { NotFoundComponent } from '../not-found.component';
import { SeoService } from '../../../core/services/seo.service';

function setup() {
  const mockSeo = { updatePageMeta: jest.fn() };
  const mockMeta = { updateTag: jest.fn() };

  TestBed.configureTestingModule({
    imports: [NotFoundComponent],
    providers: [
      provideRouter([]),
      { provide: SeoService, useValue: mockSeo },
      { provide: Meta, useValue: mockMeta },
    ],
    schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
  });

  TestBed.overrideComponent(NotFoundComponent, {
    set: { imports: [RouterLink], schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA] },
  });

  const fixture = TestBed.createComponent(NotFoundComponent);

  return { fixture, mockSeo, mockMeta };
}

describe('NotFoundComponent', () => {
  afterEach(() => jest.clearAllMocks());

  // ─── SEO / meta ───────────────────────────────────────────────────────────

  describe('ngOnInit — SEO', () => {
    it('calls seo.updatePageMeta with the correct title, description, and /404 path', () => {
      const { fixture, mockSeo } = setup();

      fixture.detectChanges();

      expect(mockSeo.updatePageMeta).toHaveBeenCalledWith({
        title: 'Nie znaleziono strony',
        description: 'Strona, której szukasz, nie istnieje lub została przeniesiona.',
        path: '/404',
      });
    });

    it('sets the robots meta tag to noindex, nofollow', () => {
      const { fixture, mockMeta } = setup();

      fixture.detectChanges();

      expect(mockMeta.updateTag).toHaveBeenCalledWith({
        name: 'robots',
        content: 'noindex, nofollow',
      });
    });
  });

  // ─── Template ─────────────────────────────────────────────────────────────

  describe('template rendering', () => {
    it('renders "404" inside .page__code', () => {
      const { fixture } = setup();
      fixture.detectChanges();

      const el = fixture.nativeElement.querySelector('.page__code');
      expect(el).not.toBeNull();
      expect(el.textContent.trim()).toBe('404');
    });

    it('renders the "Nie znaleziono strony" heading in .page__heading', () => {
      const { fixture } = setup();
      fixture.detectChanges();

      const heading = fixture.nativeElement.querySelector('.page__heading');
      expect(heading).not.toBeNull();
      expect(heading.textContent).toContain('Nie znaleziono strony');
    });

    it('renders a home-page link pointing to /', () => {
      const { fixture } = setup();
      fixture.detectChanges();

      const links: HTMLAnchorElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('a'),
      );
      const hrefs = links.map((a) => a.getAttribute('href'));
      expect(hrefs).toContain('/');
    });

    it('renders a products link pointing to /products', () => {
      const { fixture } = setup();
      fixture.detectChanges();

      const links: HTMLAnchorElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('a'),
      );
      const hrefs = links.map((a) => a.getAttribute('href'));
      expect(hrefs).toContain('/products');
    });
  });
});
