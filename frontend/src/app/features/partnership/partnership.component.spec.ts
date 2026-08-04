import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA } from "@angular/core";
import { TestBed, ComponentFixture } from "@angular/core/testing";
import { Subject } from "rxjs";
import { BreakpointObserver } from "@angular/cdk/layout";
import { Router } from "@angular/router";
import { PartnershipComponent } from "./partnership.component";

function setup() {
  const bpSubject = new Subject<{ matches: boolean }>();
  const mockBp = {
    observe: jest.fn().mockReturnValue(bpSubject.asObservable()),
  };
  const mockRouter = { navigate: jest.fn() };

  TestBed.configureTestingModule({
    imports: [PartnershipComponent],
    providers: [
      { provide: BreakpointObserver, useValue: mockBp },
      { provide: Router, useValue: mockRouter },
    ],
    schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
  });

  TestBed.overrideComponent(PartnershipComponent, {
    set: { imports: [], schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA] },
  });

  const fixture: ComponentFixture<PartnershipComponent> =
    TestBed.createComponent(PartnershipComponent);
  const component = fixture.componentInstance;
  fixture.detectChanges();

  return { fixture, component, bpSubject, mockRouter };
}

describe("PartnershipComponent", () => {
  afterEach(() => TestBed.resetTestingModule());

  // ── buttonSize breakpoint response ──────────────────────────────────────────

  describe("buttonSize breakpoint response", () => {
    it('starts with buttonSize "l" (default before any breakpoint emission)', () => {
      const { component } = setup();

      expect(component.buttonSize).toBe("l");
    });

    it('sets buttonSize to "m" when (max-width: 1000px) matches', () => {
      const { component, bpSubject } = setup();

      bpSubject.next({ matches: true });

      expect(component.buttonSize).toBe("m");
    });

    it('sets buttonSize back to "l" when breakpoint no longer matches', () => {
      const { component, bpSubject } = setup();

      bpSubject.next({ matches: true });
      bpSubject.next({ matches: false });

      expect(component.buttonSize).toBe("l");
    });
  });

  // ── subscription cleanup (takeUntilDestroyed) ──────────────────────────────

  describe("subscription cleanup", () => {
    it("stops updating buttonSize after the component is destroyed", () => {
      const { component, fixture, bpSubject } = setup();

      bpSubject.next({ matches: true });
      expect(component.buttonSize).toBe("m");

      fixture.destroy();

      bpSubject.next({ matches: false });
      expect(component.buttonSize).toBe("m"); // unchanged — subscription torn down
    });

    it("does not throw when the BreakpointObserver emits after destroy", () => {
      const { fixture, bpSubject } = setup();

      fixture.destroy();

      expect(() => bpSubject.next({ matches: true })).not.toThrow();
    });
  });

  // ── registerCta() — placeholder pending a real B2B decision ───────────────
  // All 6 "Zarejestruj się bezpośrednio" buttons previously had no handler at
  // all. Matches AnnouncementBannerComponent's existing routerLink="/" so every
  // "join" CTA on the site behaves consistently until a real target is decided.

  describe("registerCta", () => {
    it('navigates to "/" when clicked', () => {
      const { component, mockRouter } = setup();

      component.registerCta();

      expect(mockRouter.navigate).toHaveBeenCalledWith(["/"]);
    });
  });
});
