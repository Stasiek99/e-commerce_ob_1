/**
 * MagicLinkComponent — email enumeration guard.
 *
 * Invariant: the UI must show the same "check your inbox" confirmation
 * regardless of whether requestMagicLink() succeeds or errors, matching
 * AuthService.requestMagicLink()'s server-side silence on unknown emails.
 * A differing UI response (e.g. only showing success on next()) would let
 * an attacker enumerate registered accounts.
 */

import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { ActivatedRoute } from "@angular/router";
import { of, throwError } from "rxjs";
import { MagicLinkComponent } from "../magic-link.component";
import { AuthService } from "../../../../core/services/auth.service";

function setup(requestMock: jest.Mock) {
  TestBed.configureTestingModule({
    imports: [MagicLinkComponent],
    providers: [
      { provide: AuthService, useValue: { requestMagicLink: requestMock } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParams: {} } } },
    ],
    schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
  });

  const fixture = TestBed.createComponent(MagicLinkComponent);
  const component = fixture.componentInstance;
  fixture.detectChanges();

  return { fixture, component };
}

describe("MagicLinkComponent — email enumeration guard", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("does nothing on submit while the form is invalid", () => {
    const requestMock = jest.fn().mockReturnValue(of({}));
    const { component } = setup(requestMock);

    component.form.get("email")!.setValue("not-an-email");
    component.submit();

    expect(requestMock).not.toHaveBeenCalled();
    expect(component.sent).toBe(false);
  });

  it("sets sent=true when requestMagicLink() succeeds", () => {
    const requestMock = jest.fn().mockReturnValue(of({}));
    const { component } = setup(requestMock);

    component.form.get("email")!.setValue("user@example.com");
    component.submit();

    expect(requestMock).toHaveBeenCalledWith("user@example.com");
    expect(component.sent).toBe(true);
    expect(component.loading).toBe(false);
  });

  it("still sets sent=true when requestMagicLink() errors — never reveals whether the email exists", () => {
    const requestMock = jest
      .fn()
      .mockReturnValue(throwError(() => new Error("boom")));
    const { component } = setup(requestMock);

    component.form.get("email")!.setValue("user@example.com");
    component.submit();

    expect(component.sent).toBe(true);
    expect(component.loading).toBe(false);
  });
});
