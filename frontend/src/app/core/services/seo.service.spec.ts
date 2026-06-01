import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { DOCUMENT } from '@angular/common';
import { SeoService } from './seo.service';

function getRobotsMeta(doc: Document): string | null {
  return doc.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null;
}

function getCanonicalHref(doc: Document): string | null {
  return doc.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null;
}

describe('SeoService', () => {
  let service: SeoService;
  let doc: Document;

  function setup(): SeoService {
    TestBed.configureTestingModule({
      providers: [
        SeoService,
        { provide: Router, useValue: { url: '/products' } },
      ],
    });
    service = TestBed.inject(SeoService);
    doc = TestBed.inject(DOCUMENT);
    return service;
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    doc.querySelectorAll('meta[name="robots"]').forEach(el => el.remove());
    doc.querySelectorAll('link[rel="canonical"]').forEach(el => el.remove());
    doc.querySelectorAll('#ld-product').forEach(el => el.remove());
  });

  // ── robots tag default ────────────────────────────────────────────────────

  describe('updatePageMeta — robots default', () => {
    it('sets robots=index,follow after updatePageMeta', () => {
      setup().updatePageMeta({ title: 'Perfumy', path: '/products/perfume' });

      expect(getRobotsMeta(doc)).toBe('index,follow');
    });

    it('resets robots to index,follow even when called multiple times', () => {
      const svc = setup();

      svc.updatePageMeta({ title: 'First', path: '/products' });
      svc.updatePageMeta({ title: 'Second', path: '/products/diffusers' });

      expect(getRobotsMeta(doc)).toBe('index,follow');
    });
  });

  // ── setRobotsTag ──────────────────────────────────────────────────────────

  describe('setRobotsTag', () => {
    it('sets robots meta to noindex,follow on filtered pages', () => {
      setup().setRobotsTag('noindex,follow');

      expect(getRobotsMeta(doc)).toBe('noindex,follow');
    });

    it('sets robots meta to index,follow when called explicitly', () => {
      setup().setRobotsTag('index,follow');

      expect(getRobotsMeta(doc)).toBe('index,follow');
    });

    it('overwrites a previous noindex when called with index,follow', () => {
      const svc = setup();
      svc.setRobotsTag('noindex,follow');

      svc.setRobotsTag('index,follow');

      expect(getRobotsMeta(doc)).toBe('index,follow');
    });
  });

  // ── noindex is cleared on next navigation ─────────────────────────────────

  describe('noindex cleared by subsequent updatePageMeta', () => {
    it('resets noindex,follow back to index,follow when navigating to a clean page', () => {
      const svc = setup();
      svc.updatePageMeta({ title: 'Filtered', path: '/products/perfume' });
      svc.setRobotsTag('noindex,follow');

      svc.updatePageMeta({ title: 'Clean category', path: '/products/perfume' });

      expect(getRobotsMeta(doc)).toBe('index,follow');
    });

    it('does not leave stale noindex when navigating from a filtered to an unfiltered page', () => {
      const svc = setup();
      svc.setRobotsTag('noindex,follow');
      expect(getRobotsMeta(doc)).toBe('noindex,follow');

      svc.updatePageMeta({ title: 'Perfumy', path: '/products/perfume' });

      expect(getRobotsMeta(doc)).toBe('index,follow');
    });
  });

  // ── canonical always uses clean path ──────────────────────────────────────

  describe('canonical URL', () => {
    it('sets canonical to the provided path without query params', () => {
      setup().updatePageMeta({ title: 'Perfumy', path: '/products/perfume' });

      expect(getCanonicalHref(doc)).toBe('https://aromaterie.pl/products/perfume');
    });

    it('sets canonical to /products when no slug is present', () => {
      setup().updatePageMeta({ title: 'Wszystkie produkty', path: '/products' });

      expect(getCanonicalHref(doc)).toBe('https://aromaterie.pl/products');
    });

    it('updates canonical on each call without duplicating the link tag', () => {
      const svc = setup();
      svc.updatePageMeta({ title: 'A', path: '/products/perfume' });
      svc.updatePageMeta({ title: 'B', path: '/products/diffusers' });

      expect(doc.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
      expect(getCanonicalHref(doc)).toBe('https://aromaterie.pl/products/diffusers');
    });
  });
});
