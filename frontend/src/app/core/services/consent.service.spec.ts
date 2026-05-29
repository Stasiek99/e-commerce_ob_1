import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { ConsentService } from './consent.service';

const STORAGE_KEY = 'cookie_consent_v1';

describe('ConsentService', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => TestBed.resetTestingModule());

  function setup(platform: 'browser' | 'server' = 'browser'): ConsentService {
    TestBed.configureTestingModule({
      providers: [
        ConsentService,
        { provide: PLATFORM_ID, useValue: platform },
      ],
    });
    return TestBed.inject(ConsentService);
  }

  // ── Initial state ─────────────────────────────────────────────────────────

  describe('initial state (no prior consent)', () => {
    it('hasDecided is false for a new visitor', () => {
      expect(setup().hasDecided()).toBe(false);
    });

    it('analyticsConsented is false for a new visitor', () => {
      expect(setup().analyticsConsented()).toBe(false);
    });
  });

  describe('initial state (prior "accept all" consent in localStorage)', () => {
    beforeEach(() =>
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ analytics: true, v: 1 })),
    );

    it('hasDecided is true', () => {
      expect(setup().hasDecided()).toBe(true);
    });

    it('analyticsConsented is true', () => {
      expect(setup().analyticsConsented()).toBe(true);
    });
  });

  describe('initial state (prior "reject" consent in localStorage)', () => {
    beforeEach(() =>
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ analytics: false, v: 1 })),
    );

    it('hasDecided is true', () => {
      expect(setup().hasDecided()).toBe(true);
    });

    it('analyticsConsented is false', () => {
      expect(setup().analyticsConsented()).toBe(false);
    });
  });

  describe('localStorage edge cases', () => {
    it('treats malformed JSON as no consent (hasDecided stays false)', () => {
      localStorage.setItem(STORAGE_KEY, 'not-json{{{');
      expect(setup().hasDecided()).toBe(false);
    });

    it('ignores stale consent whose version is not 1 (forces re-consent)', () => {
      // Simulates a future schema bump: v=2 means this code doesn't understand it.
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ analytics: true, v: 2 }));
      expect(setup().hasDecided()).toBe(false);
    });
  });

  // ── acceptAll() ────────────────────────────────────────────────────────────

  describe('acceptAll()', () => {
    it('sets hasDecided to true', () => {
      const svc = setup();
      svc.acceptAll();
      expect(svc.hasDecided()).toBe(true);
    });

    it('sets analyticsConsented to true', () => {
      const svc = setup();
      svc.acceptAll();
      expect(svc.analyticsConsented()).toBe(true);
    });

    it('persists {analytics: true, v: 1} to localStorage', () => {
      setup().acceptAll();
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ analytics: true, v: 1 });
    });
  });

  // ── rejectNonEssential() ──────────────────────────────────────────────────

  describe('rejectNonEssential()', () => {
    it('sets hasDecided to true', () => {
      const svc = setup();
      svc.rejectNonEssential();
      expect(svc.hasDecided()).toBe(true);
    });

    it('keeps analyticsConsented false', () => {
      const svc = setup();
      svc.rejectNonEssential();
      expect(svc.analyticsConsented()).toBe(false);
    });

    it('persists {analytics: false, v: 1} to localStorage', () => {
      setup().rejectNonEssential();
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ analytics: false, v: 1 });
    });
  });

  // ── bannerVisible ─────────────────────────────────────────────────────────

  describe('bannerVisible', () => {
    it('is true in browser when no consent stored', () => {
      expect(setup('browser').bannerVisible()).toBe(true);
    });

    it('is false in browser once user has accepted', () => {
      const svc = setup('browser');
      svc.acceptAll();
      expect(svc.bannerVisible()).toBe(false);
    });

    it('is false in browser once user has rejected', () => {
      const svc = setup('browser');
      svc.rejectNonEssential();
      expect(svc.bannerVisible()).toBe(false);
    });

    it('is false in browser when prior consent is already in localStorage', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ analytics: true, v: 1 }));
      expect(setup('browser').bannerVisible()).toBe(false);
    });

    it('is false on the server — SSR HTML must never include the banner', () => {
      expect(setup('server').bannerVisible()).toBe(false);
    });
  });

  // ── SSR ───────────────────────────────────────────────────────────────────

  describe('server (SSR)', () => {
    it('hasDecided is false even when localStorage has a valid entry', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ analytics: true, v: 1 }));
      expect(setup('server').hasDecided()).toBe(false);
    });

    it('analyticsConsented is false on the server', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ analytics: true, v: 1 }));
      expect(setup('server').analyticsConsented()).toBe(false);
    });

    it('acceptAll() does not write to localStorage on the server', () => {
      setup('server').acceptAll();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('rejectNonEssential() does not write to localStorage on the server', () => {
      setup('server').rejectNonEssential();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });
});
