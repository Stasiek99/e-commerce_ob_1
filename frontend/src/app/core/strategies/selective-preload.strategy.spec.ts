import { TestBed } from "@angular/core/testing";
import { Route } from "@angular/router";
import { of } from "rxjs";
import { SelectivePreloadStrategy } from "./selective-preload.strategy";

describe("SelectivePreloadStrategy", () => {
  let strategy: SelectivePreloadStrategy;

  const loadFn = jest.fn(() => of("loaded"));

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [SelectivePreloadStrategy] });
    strategy = TestBed.inject(SelectivePreloadStrategy);
    jest.clearAllMocks();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // ── allowlisted routes (data.preload = true) ───────────────────────────────

  it("calls fn() and returns its observable when data.preload is true", (done) => {
    const route: Route = { path: "products", data: { preload: true } };
    const emissions: unknown[] = [];

    strategy.preload(route, loadFn).subscribe({
      next: (v) => emissions.push(v),
      complete: () => {
        expect(loadFn).toHaveBeenCalledTimes(1);
        expect(emissions).toEqual(["loaded"]);
        done();
      },
    });
  });

  // ── non-allowlisted routes — all must return EMPTY (no emission) ───────────

  it("returns EMPTY and does not call fn() when data.preload is false", (done) => {
    const route: Route = { path: "account", data: { preload: false } };
    const emissions: unknown[] = [];

    strategy.preload(route, loadFn).subscribe({
      next: (v) => emissions.push(v),
      complete: () => {
        expect(loadFn).not.toHaveBeenCalled();
        expect(emissions).toHaveLength(0);
        done();
      },
    });
  });

  it("returns EMPTY and does not call fn() when route has no data property", (done) => {
    const route: Route = { path: "auth/login" };
    const emissions: unknown[] = [];

    strategy.preload(route, loadFn).subscribe({
      next: (v) => emissions.push(v),
      complete: () => {
        expect(loadFn).not.toHaveBeenCalled();
        expect(emissions).toHaveLength(0);
        done();
      },
    });
  });

  it("returns EMPTY and does not call fn() when data is present but preload key is absent", (done) => {
    const route: Route = { path: "wishlist", data: { someOtherFlag: true } };
    const emissions: unknown[] = [];

    strategy.preload(route, loadFn).subscribe({
      next: (v) => emissions.push(v),
      complete: () => {
        expect(loadFn).not.toHaveBeenCalled();
        expect(emissions).toHaveLength(0);
        done();
      },
    });
  });
});
