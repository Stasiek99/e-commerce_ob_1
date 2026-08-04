import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { ReactiveFormsModule } from "@angular/forms";
import { provideHttpClient } from "@angular/common/http";
import { provideHttpClientTesting } from "@angular/common/http/testing";
import { provideRouter } from "@angular/router";
import { CheckoutPageComponent } from "../checkout-page.component";
import { CartService } from "../../../../core/services/cart.service";
import { AuthService } from "../../../../core/services/auth.service";
import { ToastService } from "../../../../core/services/toast.service";
import { AnalyticsService } from "../../../../core/services/analytics.service";
import { TurnstileService } from "../../../../core/services/turnstile.service";
import { PricePipe } from "../../../../shared/pipes/price.pipe";

function setup() {
  const mockCart = {
    items: jest.fn().mockReturnValue([]),
    totalInCents: jest.fn().mockReturnValue(0),
    refreshFromServer: jest.fn(),
    getSessionId: jest.fn().mockReturnValue("sess-test"),
    clear: jest.fn(),
  };
  const mockAuth = {
    isAuthenticated: jest.fn().mockReturnValue(false),
    currentUser: jest.fn().mockReturnValue(null),
  };
  const mockTurnstile = { getToken: jest.fn().mockResolvedValue("") };

  TestBed.configureTestingModule({
    imports: [CheckoutPageComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: CartService, useValue: mockCart },
      { provide: AuthService, useValue: mockAuth },
      {
        provide: ToastService,
        useValue: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
      },
      {
        provide: AnalyticsService,
        useValue: { trackBeginCheckout: jest.fn(), trackPurchase: jest.fn() },
      },
      { provide: TurnstileService, useValue: mockTurnstile },
    ],
    schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
  });

  TestBed.overrideComponent(CheckoutPageComponent, {
    set: {
      imports: [ReactiveFormsModule, PricePipe],
      schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
    },
  });

  const fixture = TestBed.createComponent(CheckoutPageComponent);
  const component = fixture.componentInstance;
  fixture.detectChanges();

  return { component, fixture };
}

describe("CheckoutPageComponent — DPD modal accessibility (WCAG 2.1.2 / EAA)", () => {
  afterEach(() => jest.clearAllMocks());

  // ── Focus restoration ───────────────────────────────────────────────

  it("restores focus to the triggering button when the modal is closed", () => {
    const { component } = setup();

    const triggerBtn = document.createElement("button");
    document.body.appendChild(triggerBtn);
    triggerBtn.focus();

    component.openDpdPicker();

    // Simulate focus moving into the modal
    const dummyInput = document.createElement("input");
    document.body.appendChild(dummyInput);
    dummyInput.focus();

    component.closeDpdModal();

    expect(document.activeElement).toBe(triggerBtn);

    document.body.removeChild(triggerBtn);
    document.body.removeChild(dummyInput);
  });

  it("restores focus when the modal is closed via DPD postMessage selection", () => {
    const { component } = setup();

    const triggerBtn = document.createElement("button");
    document.body.appendChild(triggerBtn);
    triggerBtn.focus();

    component.openDpdPicker();

    // Simulate valid DPD widget postMessage — triggers closeDpdModal() internally
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: "https://api.dpd.cz",
        data: {
          dpdWidget: {
            id: "WAW01B",
            street: "ul. Złota 7",
            zip_code: "00-019",
            city: "Warszawa",
          },
        },
      }),
    );

    expect(document.activeElement).toBe(triggerBtn);

    document.body.removeChild(triggerBtn);
  });

  it("does not throw when closeDpdModal is called without a prior open (no opener element)", () => {
    const { component } = setup();

    expect(() => component.closeDpdModal()).not.toThrow();
  });

  it("does not restore focus to a stale opener after a second close call", () => {
    const { component } = setup();

    const triggerBtn = document.createElement("button");
    document.body.appendChild(triggerBtn);
    triggerBtn.focus();

    component.openDpdPicker();
    component.closeDpdModal(); // first close — focus restored, opener nulled

    const unrelatedEl = document.createElement("button");
    document.body.appendChild(unrelatedEl);
    unrelatedEl.focus();

    component.closeDpdModal(); // second call — opener is null, focus should stay on unrelated

    expect(document.activeElement).toBe(unrelatedEl);

    document.body.removeChild(triggerBtn);
    document.body.removeChild(unrelatedEl);
  });

  // ── ARIA attributes on the modal container ──────────────────────────

  it('renders the modal content with role="dialog" when the modal is open', () => {
    const { component, fixture } = setup();

    component.dpdModalOpen.set(true);
    fixture.detectChanges();

    const content: HTMLElement | null =
      fixture.nativeElement.querySelector(".dpd-modal-content");

    expect(content?.getAttribute("role")).toBe("dialog");
  });

  it('renders the modal content with aria-modal="true" when the modal is open', () => {
    const { component, fixture } = setup();

    component.dpdModalOpen.set(true);
    fixture.detectChanges();

    const content: HTMLElement | null =
      fixture.nativeElement.querySelector(".dpd-modal-content");

    expect(content?.getAttribute("aria-modal")).toBe("true");
  });

  it("renders the modal content with a Polish aria-label when the modal is open", () => {
    const { component, fixture } = setup();

    component.dpdModalOpen.set(true);
    fixture.detectChanges();

    const content: HTMLElement | null =
      fixture.nativeElement.querySelector(".dpd-modal-content");

    expect(content?.getAttribute("aria-label")).toBe(
      "Wybierz punkt odbioru DPD",
    );
  });

  it("does not render the modal dialog container when the modal is closed", () => {
    const { component, fixture } = setup();

    component.dpdModalOpen.set(false);
    fixture.detectChanges();

    const content = fixture.nativeElement.querySelector(".dpd-modal-content");

    expect(content).toBeNull();
  });
});
