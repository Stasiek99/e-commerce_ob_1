import { TestBed } from '@angular/core/testing';
import { computed } from '@angular/core';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { CookieConsentComponent } from './cookie-consent.component';
import { ConsentService } from '../../../core/services/consent.service';

function makeConsentMock(hasDecided: boolean) {
  return {
    hasDecided: computed(() => hasDecided),
    analyticsConsented: computed(() => false),
    acceptAll: jest.fn(),
    rejectNonEssential: jest.fn(),
  };
}

describe('CookieConsentComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  function setup(hasDecided = false) {
    const consent = makeConsentMock(hasDecided);
    TestBed.configureTestingModule({
      imports: [CookieConsentComponent],
      providers: [
        provideRouter([]),
        { provide: ConsentService, useValue: consent },
      ],
    });
    const fixture = TestBed.createComponent(CookieConsentComponent);
    fixture.detectChanges();
    return { fixture, consent };
  }

  // ── Visibility ─────────────────────────────────────────────────────────────

  describe('visibility', () => {
    it('renders the banner when the user has not yet decided', () => {
      const { fixture } = setup(false);
      expect(fixture.debugElement.query(By.css('[role="dialog"]'))).toBeTruthy();
    });

    it('hides the banner once the user has made a choice', () => {
      const { fixture } = setup(true);
      expect(fixture.debugElement.query(By.css('[role="dialog"]'))).toBeNull();
    });
  });

  // ── Accessibility ──────────────────────────────────────────────────────────

  describe('accessibility', () => {
    it('has role="dialog" on the banner container', () => {
      const { fixture } = setup(false);
      const banner = fixture.debugElement.query(By.css('.banner'));
      expect(banner.nativeElement.getAttribute('role')).toBe('dialog');
    });

    it('has aria-live="polite" so assistive technology announces it non-disruptively', () => {
      const { fixture } = setup(false);
      const banner = fixture.debugElement.query(By.css('[role="dialog"]'));
      expect(banner.nativeElement.getAttribute('aria-live')).toBe('polite');
    });

    it('has a non-empty aria-label describing the dialog purpose', () => {
      const { fixture } = setup(false);
      const banner = fixture.debugElement.query(By.css('[role="dialog"]'));
      const label = banner.nativeElement.getAttribute('aria-label');
      expect(label).toBeTruthy();
      expect(label.length).toBeGreaterThan(0);
    });
  });

  // ── Button actions ─────────────────────────────────────────────────────────

  describe('button actions', () => {
    function getButton(fixture: ReturnType<typeof setup>['fixture'], text: string) {
      return fixture.debugElement
        .queryAll(By.css('button'))
        .find(b => b.nativeElement.textContent.trim() === text);
    }

    it('"Akceptuj wszystkie" calls consent.acceptAll()', () => {
      const { fixture, consent } = setup(false);
      const btn = getButton(fixture, 'Akceptuj wszystkie');
      expect(btn).toBeTruthy();
      btn!.nativeElement.click();
      expect(consent.acceptAll).toHaveBeenCalledTimes(1);
    });

    it('"Tylko niezbędne" calls consent.rejectNonEssential()', () => {
      const { fixture, consent } = setup(false);
      const btn = getButton(fixture, 'Tylko niezbędne');
      expect(btn).toBeTruthy();
      btn!.nativeElement.click();
      expect(consent.rejectNonEssential).toHaveBeenCalledTimes(1);
    });

    it('"Akceptuj wszystkie" does not call rejectNonEssential()', () => {
      const { fixture, consent } = setup(false);
      getButton(fixture, 'Akceptuj wszystkie')!.nativeElement.click();
      expect(consent.rejectNonEssential).not.toHaveBeenCalled();
    });

    it('"Tylko niezbędne" does not call acceptAll()', () => {
      const { fixture, consent } = setup(false);
      getButton(fixture, 'Tylko niezbędne')!.nativeElement.click();
      expect(consent.acceptAll).not.toHaveBeenCalled();
    });
  });
});
