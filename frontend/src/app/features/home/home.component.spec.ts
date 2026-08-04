/**
 * Regression harness for HomeComponent accessibility fixes:
 *  1. prefers-reduced-motion: skip scroll animation, show content immediately
 *  2. expandHero(): keyboard/click trigger that fully expands the hero
 *  3. [attr.inert] on .expand-content: hidden content unreachable via Tab
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

  it("sets showContent to true immediately", () => {
    expect(component.showContent).toBe(true);
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

  it("starts with showContent=false", () => {
    expect(component.showContent).toBe(false);
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

  it("sets showContent to true", () => {
    component.expandHero();
    expect(component.showContent).toBe(true);
  });

  it("sets mediaFullyExpanded to true", () => {
    component.expandHero();
    expect(component.mediaFullyExpanded).toBe(true);
  });

  it("is idempotent when called a second time", () => {
    component.expandHero();
    component.expandHero();
    expect(component.scrollProgress).toBe(1);
    expect(component.showContent).toBe(true);
    expect(component.mediaFullyExpanded).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite 4 — [inert] on .expand-content
// ---------------------------------------------------------------------------

describe("HomeComponent — expand-content [inert] attribute", () => {
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

  it("has inert attribute when showContent is false", () => {
    const el: HTMLElement =
      fixture.nativeElement.querySelector(".expand-content");
    expect(el.hasAttribute("inert")).toBe(true);
  });

  it("removes inert attribute when showContent is true", () => {
    component.showContent = true;
    fixture.detectChanges();

    const el: HTMLElement =
      fixture.nativeElement.querySelector(".expand-content");
    expect(el.hasAttribute("inert")).toBe(false);
  });

  it("restores inert attribute when showContent goes back to false", () => {
    component.showContent = true;
    fixture.detectChanges();

    component.showContent = false;
    fixture.detectChanges();

    const el: HTMLElement =
      fixture.nativeElement.querySelector(".expand-content");
    expect(el.hasAttribute("inert")).toBe(true);
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

  it("clicking the button sets showContent to true", () => {
    const btn: HTMLButtonElement =
      fixture.nativeElement.querySelector("button.expand-hint");
    btn.click();
    expect(component.showContent).toBe(true);
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
