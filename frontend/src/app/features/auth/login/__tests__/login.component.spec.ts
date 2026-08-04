/**
 * Open-redirect guard tests for LoginComponent.
 *
 * Invariant: returnTo must never pass an absolute URL or protocol-relative URL
 * to router.navigateByUrl(). An attacker can craft
 *   /auth/login?returnTo=https://attacker.com
 * to redirect post-login victims to a phishing page.
 */

import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { ActivatedRoute } from "@angular/router";
import { of } from "rxjs";
import { LoginComponent } from "../login.component";
import { AuthService } from "../../../../core/services/auth.service";
import { CartService } from "../../../../core/services/cart.service";
import { ToastService } from "../../../../core/services/toast.service";

function setup(
  returnToParam: string | undefined = undefined,
  errorParam: string | undefined = undefined,
) {
  const mockAuth = { login: jest.fn(), loginWithGoogle: jest.fn() };
  const mockCart = { mergeWithServer: jest.fn().mockReturnValue(of({})) };
  const mockToast = { success: jest.fn(), error: jest.fn() };
  const mockRouter = { navigateByUrl: jest.fn(), navigate: jest.fn() };

  const queryParams: Record<string, string> = {};
  if (returnToParam !== undefined) queryParams["returnTo"] = returnToParam;
  if (errorParam !== undefined) queryParams["error"] = errorParam;

  TestBed.configureTestingModule({
    imports: [LoginComponent],
    providers: [
      { provide: AuthService, useValue: mockAuth },
      { provide: CartService, useValue: mockCart },
      { provide: ToastService, useValue: mockToast },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParams } } },
      { provide: "Router", useValue: mockRouter },
    ],
    schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
  });

  // Provide Router via the token Angular resolves for inject(Router)
  TestBed.overrideProvider({ token: "Router" } as any, {
    useValue: mockRouter,
  });

  const fixture = TestBed.createComponent(LoginComponent);
  // Inject the real router mock via the component's DI
  const routerToken = (fixture.componentRef.injector as any).get
    ? undefined
    : undefined;

  const component = fixture.componentInstance;
  fixture.detectChanges();

  return { fixture, component, mockAuth, mockCart, mockToast, mockRouter };
}

describe("LoginComponent — returnTo sanitization (open-redirect guard)", () => {
  afterEach(() => TestBed.resetTestingModule());

  // ── returnTo property sanitization ──────────────────────────────────────────

  it("sets returnTo to null when query param is an absolute URL", () => {
    const { component } = setup("https://attacker.com/steal-token");

    expect(component.returnTo).toBeNull();
  });

  it("sets returnTo to null when query param is a protocol-relative URL", () => {
    const { component } = setup("//attacker.com");

    expect(component.returnTo).toBeNull();
  });

  it("sets returnTo to null when query param is absent", () => {
    const { component } = setup(undefined);

    expect(component.returnTo).toBeNull();
  });

  it("sets returnTo to the path when query param is a safe relative URL", () => {
    const { component } = setup("/account/orders");

    expect(component.returnTo).toBe("/account/orders");
  });

  it('sets returnTo to the root path when query param is exactly "/"', () => {
    const { component } = setup("/");

    expect(component.returnTo).toBe("/");
  });
});

describe("LoginComponent — Google OAuth rejection toast", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("shows the account-conflict message when error=account_conflict", () => {
    const { mockToast } = setup(undefined, "account_conflict");

    expect(mockToast.error).toHaveBeenCalledTimes(1);
    expect(mockToast.error).toHaveBeenCalledWith(
      expect.stringContaining("zarejestrowane"),
    );
  });

  it("shows the generic OAuth-failure message when error=oauth_failed", () => {
    const { mockToast } = setup(undefined, "oauth_failed");

    expect(mockToast.error).toHaveBeenCalledTimes(1);
    expect(mockToast.error).toHaveBeenCalledWith(
      expect.stringContaining("Google"),
    );
  });

  it("does not show a toast when no error query param is present", () => {
    const { mockToast } = setup();

    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("ignores an unrecognized error value", () => {
    const { mockToast } = setup(undefined, "something_unexpected");

    expect(mockToast.error).not.toHaveBeenCalled();
  });
});

describe('LoginComponent — field-error role="alert" (WCAG 3.3.1)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it("renders no field-error paragraphs when form is pristine and untouched", () => {
    const { fixture } = setup();

    const errors = fixture.nativeElement.querySelectorAll(".field-error");

    expect(errors.length).toBe(0);
  });

  it('renders email error paragraph with role="alert" when field is touched and empty', () => {
    const { fixture, component } = setup();

    component.form.get("email")!.markAsTouched();
    fixture.detectChanges();

    const emailErrors: NodeListOf<Element> =
      fixture.nativeElement.querySelectorAll("p.field-error");
    expect(emailErrors.length).toBeGreaterThan(0);
    expect(emailErrors[0].getAttribute("role")).toBe("alert");
  });

  it('renders password error paragraph with role="alert" when field is touched and empty', () => {
    const { fixture, component } = setup();

    component.form.get("password")!.markAsTouched();
    fixture.detectChanges();

    const pwErrors: NodeListOf<Element> =
      fixture.nativeElement.querySelectorAll("p.field-error");
    expect(pwErrors.length).toBeGreaterThan(0);
    expect(pwErrors[0].getAttribute("role")).toBe("alert");
  });

  it('all field-error paragraphs carry role="alert" after a failed submit attempt', () => {
    const { fixture, component } = setup();

    component.submit();
    fixture.detectChanges();

    const errors: NodeListOf<Element> =
      fixture.nativeElement.querySelectorAll("p.field-error");
    expect(errors.length).toBe(2);
    errors.forEach((el) => {
      expect(el.getAttribute("role")).toBe("alert");
    });
  });
});
