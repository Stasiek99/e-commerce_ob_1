/**
 * Regression harness for HomeComponent accessibility fixes:
 *  1. prefers-reduced-motion: skip scroll animation, show content immediately
 *  2. expandHero(): keyboard/click trigger that fully expands the hero
 *  3. .expand-content renders visible and non-inert unconditionally,
 *     including under SSR/prerender (platformId "server") — it used to stay
 *     opacity: 0 + inert until a showContent flag flipped true from the
 *     scroll-hijack handlers, which meant the prerendered HTML for "/"
 *     shipped with the entire shop invisible and inert to any user whose JS
 *     failed and to any crawler that doesn't execute it.
 *  4. button.expand-hint: keyboard-accessible trigger; removed when expanded
 */

import { PLATFORM_ID, NO_ERRORS_SCHEMA } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { HomeComponent } from "./home.component";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockMatchMedia = (matches: boolean) => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn().mockReturnValue({ matches }),
  });
};

const buildModule = async (reducedMotion: boolean, platformId = "browser") => {
  mockMatchMedia(reducedMotion);
  jest.spyOn(window, "scrollTo").mockImplementation(() => undefined);

  await TestBed.configureTestingModule({
    imports: [HomeComponent],
    providers: [{ provide: PLATFORM_ID, useValue: platformId }],
  })
    .overrideComponent(HomeComponent, {
      set: { imports: [], schemas: [NO_ERRORS_SCHEMA] },
    })
    .compileComponents();

  const fixture: ComponentFixture<HomeComponent> =
    TestBed.createComponent(HomeComponent);
  fixture.detectChanges();
  return fixture;
};

// ---------------------------------------------------------------------------
// Suite 1 — prefers-reduced-motion: reduce
// ---------------------------------------------------------------------------

describe("HomeComponent — prefers-reduced-motion: reduce → instant expansion", () => {
  let component: HomeComponent;

  beforeEach(async () => {
    const fixture = await buildModule(true);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    jest.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it("sets scrollProgress to 1 immediately", () => {
    expect(component.scrollProgress).toBe(1);
  });

  it("sets mediaFullyExpanded to true immediately", () => {
    expect(component.mediaFullyExpanded).toBe(true);
  });

  it("does not register a wheel event listener", () => {
    const spy = jest.spyOn(window, "addEventListener");
    // re-run ngOnInit in isolation to capture calls
    component.ngOnDestroy();
    component.ngOnInit();

    const wheelCalls = spy.mock.calls.filter(([event]) => event === "wheel");
    expect(wheelCalls).toHaveLength(0);
  });

  it("does not call window.scrollTo(0,0) when reduced motion skips animation", () => {
    const scrollSpy = window.scrollTo as jest.Mock;
    scrollSpy.mockClear();

    component.ngOnDestroy();
    component.ngOnInit();

    expect(scrollSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — normal motion: animation setup runs
// ---------------------------------------------------------------------------

describe("HomeComponent — no prefers-reduced-motion → animation setup", () => {
  let component: HomeComponent;

  beforeEach(async () => {
    const fixture = await buildModule(false);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    jest.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it("starts with scrollProgress=0", () => {
    expect(component.scrollProgress).toBe(0);
  });

  it("starts with mediaFullyExpanded=false", () => {
    expect(component.mediaFullyExpanded).toBe(false);
  });

  it("calls window.scrollTo(0,0) to lock scroll at top", () => {
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — expandHero()
// ---------------------------------------------------------------------------

describe("HomeComponent — expandHero()", () => {
  let component: HomeComponent;

  beforeEach(async () => {
    const fixture = await buildModule(false);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    jest.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it("sets scrollProgress to 1", () => {
    component.expandHero();
    expect(component.scrollProgress).toBe(1);
  });

  it("sets mediaFullyExpanded to true", () => {
    component.expandHero();
    expect(component.mediaFullyExpanded).toBe(true);
  });

  it("is idempotent when called a second time", () => {
    component.expandHero();
    component.expandHero();
    expect(component.scrollProgress).toBe(1);
    expect(component.mediaFullyExpanded).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite 4 — .expand-content is always visible, never inert
// ---------------------------------------------------------------------------

describe("HomeComponent — .expand-content visibility", () => {
  it("has no inert attribute before the hero animation starts", async () => {
    const fixture = await buildModule(false);
    const el: HTMLElement =
      fixture.nativeElement.querySelector(".expand-content");
    expect(el.hasAttribute("inert")).toBe(false);
  });

  it("has no inert attribute once the hero is fully expanded", async () => {
    const fixture = await buildModule(false);
    fixture.componentInstance.expandHero();
    fixture.detectChanges();

    const el: HTMLElement =
      fixture.nativeElement.querySelector(".expand-content");
    expect(el.hasAttribute("inert")).toBe(false);
  });

  it("has no inert attribute under SSR (platformId: server)", async () => {
    // Pins the prerender regression: "/" is a static-prerendered route, so
    // this is what actually ships in the CDN-served HTML before any JS runs.
    const fixture = await buildModule(false, "server");
    const el: HTMLElement =
      fixture.nativeElement.querySelector(".expand-content");
    expect(el.hasAttribute("inert")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Suite 5 — keyboard trigger button (.expand-hint)
// ---------------------------------------------------------------------------

describe("HomeComponent — keyboard trigger button (.expand-hint)", () => {
  let component: HomeComponent;
  let fixture: ComponentFixture<HomeComponent>;

  beforeEach(async () => {
    fixture = await buildModule(false);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    jest.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it("renders button.expand-hint when mediaFullyExpanded is false", () => {
    const btn: HTMLButtonElement | null =
      fixture.nativeElement.querySelector("button.expand-hint");
    expect(btn).not.toBeNull();
  });

  it("removes button.expand-hint when mediaFullyExpanded is true", () => {
    component.mediaFullyExpanded = true;
    fixture.detectChanges();

    const btn: HTMLButtonElement | null =
      fixture.nativeElement.querySelector("button.expand-hint");
    expect(btn).toBeNull();
  });

  it("clicking the button sets scrollProgress to 1", () => {
    const btn: HTMLButtonElement =
      fixture.nativeElement.querySelector("button.expand-hint");
    btn.click();
    expect(component.scrollProgress).toBe(1);
  });

  it("clicking the button sets mediaFullyExpanded to true", () => {
    const btn: HTMLButtonElement =
      fixture.nativeElement.querySelector("button.expand-hint");
    btn.click();
    expect(component.mediaFullyExpanded).toBe(true);
  });

  it("button carries an aria-label for screen readers", () => {
    const btn: HTMLButtonElement =
      fixture.nativeElement.querySelector("button.expand-hint");
    expect(btn.getAttribute("aria-label")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Suite 6 — SSR guard (non-browser platform)
// ---------------------------------------------------------------------------

describe("HomeComponent — SSR: non-browser platform skips all browser APIs", () => {
  afterEach(() => {
    jest.clearAllMocks();
    TestBed.resetTestingModule();
  });

  it("does not call matchMedia in a server context", async () => {
    const matchMediaSpy = jest.fn();
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: matchMediaSpy,
    });

    await buildModule(false, "server");

    expect(matchMediaSpy).not.toHaveBeenCalled();
  });

  it("leaves scrollProgress at 0 in a server context", async () => {
    const fixture = await buildModule(false, "server");
    expect(fixture.componentInstance.scrollProgress).toBe(0);
  });
});
