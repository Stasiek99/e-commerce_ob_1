/**
 * SSR guard tests for CheckoutAuthChoiceComponent.
 *
 * Invariant: sessionStorage.setItem() must NOT be called on the server
 * (PLATFORM_ID = 'server'). Without the isPlatformBrowser guard, calling
 * continueAsGuest() server-side throws ReferenceError in Node.
 */

import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { PLATFORM_ID } from "@angular/core";
import { CheckoutAuthChoiceComponent } from "../checkout-auth-choice.component";
import { CartService } from "../../../../core/services/cart.service";
import { AuthService } from "../../../../core/services/auth.service";

function createComponent(platformId: string) {
  const mockCart = { items: jest.fn().mockReturnValue([{ id: "1" }]) };
  const mockAuth = { isAuthenticated: jest.fn().mockReturnValue(false) };

  TestBed.configureTestingModule({
    imports: [CheckoutAuthChoiceComponent],
    providers: [
      provideRouter([]),
      { provide: PLATFORM_ID, useValue: platformId },
      { provide: CartService, useValue: mockCart },
      { provide: AuthService, useValue: mockAuth },
    ],
  });

  const fixture = TestBed.createComponent(CheckoutAuthChoiceComponent);
  const component = fixture.componentInstance;
  const router = TestBed.inject(Router);
  jest.spyOn(router, "navigate").mockResolvedValue(true);
  fixture.detectChanges();
  return { fixture, component, router };
}

describe("CheckoutAuthChoiceComponent — continueAsGuest SSR guard", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  // ── server platform ────────────────────────────────────────────────────────

  it("does not call sessionStorage.setItem() on the server platform", () => {
    const setItemSpy = jest.spyOn(Storage.prototype, "setItem");
    const { component } = createComponent("server");

    component.continueAsGuest();

    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it("still navigates to /checkout on the server platform after continueAsGuest", () => {
    const { component, router } = createComponent("server");

    component.continueAsGuest();

    expect(router.navigate).toHaveBeenCalledWith(["/checkout"]);
  });

  // ── browser platform ───────────────────────────────────────────────────────

  it("sets checkout_guest in sessionStorage in the browser", () => {
    const setItemSpy = jest.spyOn(Storage.prototype, "setItem");
    const { component } = createComponent("browser");

    component.continueAsGuest();

    expect(setItemSpy).toHaveBeenCalledWith("checkout_guest", "1");
  });

  it("navigates to /checkout after setting the guest flag in the browser", () => {
    jest.spyOn(Storage.prototype, "setItem");
    const { component, router } = createComponent("browser");

    component.continueAsGuest();

    expect(router.navigate).toHaveBeenCalledWith(["/checkout"]);
  });
});
