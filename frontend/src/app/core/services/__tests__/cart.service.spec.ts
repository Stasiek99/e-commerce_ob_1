import { TestBed, fakeAsync, tick } from "@angular/core/testing";
import { Subject } from "rxjs";
import { provideHttpClient } from "@angular/common/http";
import {
  provideHttpClientTesting,
  HttpTestingController,
} from "@angular/common/http/testing";
import { PLATFORM_ID } from "@angular/core";
import { CartService } from "../cart.service";
import { ToastService } from "../toast.service";

const mockToast = {
  error: jest.fn(),
  success: jest.fn(),
  info: jest.fn(),
};

function setup(platformId: "browser" | "server" = "browser") {
  TestBed.configureTestingModule({
    providers: [
      CartService,
      { provide: PLATFORM_ID, useValue: platformId },
      { provide: ToastService, useValue: mockToast },
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });

  const service = TestBed.inject(CartService);
  const http = TestBed.inject(HttpTestingController);

  if (platformId === "browser") {
    // Flush the loadCart() call made in the constructor
    http
      .expectOne((req) => req.url.includes("/cart"))
      .flush({
        id: "cart-1",
        items: [],
        itemCount: 0,
        totalInCents: 0,
      });
  }

  return { service, http };
}

const mockItems = [
  {
    id: "ci-1",
    productVariantId: "pv-1",
    quantity: 2,
    productName: "Dior Sauvage",
    variantLabel: "100ml",
    priceInCents: 34900,
    imageUrl: null,
    slug: "dior-sauvage",
    sku: "DS-100",
    stock: 5,
  },
  {
    id: "ci-2",
    productVariantId: "pv-2",
    quantity: 1,
    productName: "Chanel No 5",
    variantLabel: "50ml",
    priceInCents: 44900,
    imageUrl: null,
    slug: "chanel-no-5",
    sku: "CN5-50",
    stock: 3,
  },
];

describe("CartService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });

  // ── clear() ─────────────────────────────────────────────────────────────────

  describe("clear()", () => {
    it("resets items signal to an empty array", () => {
      const { service } = setup();

      service.refreshFromServer({
        id: "cart-1",
        items: mockItems,
        itemCount: 3,
        totalInCents: 114700,
      });

      service.clear();

      expect(service.items()).toEqual([]);
    });

    it("resets cartId signal to null", () => {
      const { service } = setup();

      service.refreshFromServer({
        id: "cart-1",
        items: mockItems,
        itemCount: 3,
        totalInCents: 114700,
      });
      expect(service.cartId()).toBe("cart-1");

      service.clear();

      expect(service.cartId()).toBeNull();
    });

    it("reduces itemCount computed signal to 0", () => {
      const { service } = setup();

      service.refreshFromServer({
        id: "cart-1",
        items: mockItems,
        itemCount: 3,
        totalInCents: 114700,
      });
      expect(service.itemCount()).toBe(3);

      service.clear();

      expect(service.itemCount()).toBe(0);
    });

    it("reduces totalInCents computed signal to 0", () => {
      const { service } = setup();

      service.refreshFromServer({
        id: "cart-1",
        items: mockItems,
        itemCount: 3,
        totalInCents: 114700,
      });
      expect(service.totalInCents()).toBe(114700);

      service.clear();

      expect(service.totalInCents()).toBe(0);
    });

    it("is idempotent — calling clear() twice leaves cart empty", () => {
      const { service } = setup();

      service.refreshFromServer({
        id: "cart-1",
        items: mockItems,
        itemCount: 3,
        totalInCents: 114700,
      });

      service.clear();
      service.clear();

      expect(service.items()).toEqual([]);
      expect(service.cartId()).toBeNull();
    });

    it("clear() on an already-empty cart does not throw", () => {
      const { service } = setup();

      expect(() => service.clear()).not.toThrow();
      expect(service.items()).toEqual([]);
      expect(service.cartId()).toBeNull();
    });

    it("completes all pending updateQueue subjects so debounce pipelines are torn down", () => {
      const { service } = setup();

      // Inject subjects directly so no HTTP pipeline is created (avoids afterEach verify issues)
      const subject1 = new Subject<number>();
      const subject2 = new Subject<number>();
      const queues = (service as any).updateQueues as Map<
        string,
        Subject<number>
      >;
      queues.set("pv-1", subject1);
      queues.set("pv-2", subject2);

      let pv1Done = false;
      let pv2Done = false;
      subject1.subscribe({
        complete: () => {
          pv1Done = true;
        },
      });
      subject2.subscribe({
        complete: () => {
          pv2Done = true;
        },
      });

      service.clear();

      expect(pv1Done).toBe(true);
      expect(pv2Done).toBe(true);
    });

    it("empties updateQueues Map so subsequent updateQuantity calls start fresh pipelines", () => {
      const { service } = setup();

      const queues = (service as any).updateQueues as Map<string, unknown>;
      queues.set("pv-1", new Subject<number>());
      queues.set("pv-2", new Subject<number>());
      expect(queues.size).toBe(2);

      service.clear();

      expect(queues.size).toBe(0);
    });
  });

  // ── refreshFromServer() ─────────────────────────────────────────────────────

  describe("refreshFromServer()", () => {
    it("updates items and cartId signals from server response", () => {
      const { service } = setup();

      service.refreshFromServer({
        id: "cart-42",
        items: mockItems,
        itemCount: 3,
        totalInCents: 114700,
      });

      expect(service.cartId()).toBe("cart-42");
      expect(service.items()).toHaveLength(2);
    });
  });

  // ── updateQuantity() — per-item queue fix ────────────────────────────────────
  // Invariants enforced by the fix:
  //  1. Concurrent updates to different variantIds both fire — no cancellation across items.
  //  2. After a server error the stream stays alive — the next updateQuantity still PATCHes.
  //  3. toast.error() is called on any HTTP error so the user learns about the failure.
  //  4. Rapid updates for the SAME variant are debounced — only the last quantity is sent.

  describe("updateQuantity()", () => {
    it("applies an optimistic update to the items signal immediately before the server responds", fakeAsync(() => {
      const { service, http } = setup();

      service.refreshFromServer({
        id: "cart-1",
        items: mockItems,
        itemCount: 3,
        totalInCents: 114700,
      });

      service.updateQuantity("pv-1", 5);

      expect(
        service.items().find((i) => i.productVariantId === "pv-1")?.quantity,
      ).toBe(5);

      tick(400);
      http.expectOne((req) => req.url.includes("pv-1")).flush({});
    }));

    it("sends PATCH for both pv-1 and pv-2 when updated concurrently — neither cancels the other", fakeAsync(() => {
      const { service, http } = setup();

      service.refreshFromServer({
        id: "cart-1",
        items: mockItems,
        itemCount: 3,
        totalInCents: 114700,
      });

      service.updateQuantity("pv-1", 3);
      service.updateQuantity("pv-2", 5);
      tick(400);

      const req1 = http.expectOne((req) => req.url.includes("pv-1"));
      const req2 = http.expectOne((req) => req.url.includes("pv-2"));

      expect(req1.request.body).toEqual({ quantity: 3 });
      expect(req2.request.body).toEqual({ quantity: 5 });

      req1.flush({});
      req2.flush({});
    }));

    it("debounces rapid updates for the same variant — only the last quantity is sent", fakeAsync(() => {
      const { service, http } = setup();

      service.refreshFromServer({
        id: "cart-1",
        items: mockItems,
        itemCount: 3,
        totalInCents: 114700,
      });

      service.updateQuantity("pv-1", 2);
      service.updateQuantity("pv-1", 3);
      service.updateQuantity("pv-1", 7);
      tick(400);

      const req = http.expectOne((req) => req.url.includes("pv-1"));
      expect(req.request.body).toEqual({ quantity: 7 });
      req.flush({});
    }));

    it("keeps the stream alive after a 400 error — subsequent updateQuantity for the same variant still fires PATCH", fakeAsync(() => {
      const { service, http } = setup();

      service.refreshFromServer({
        id: "cart-1",
        items: mockItems,
        itemCount: 3,
        totalInCents: 114700,
      });

      service.updateQuantity("pv-1", 3);
      tick(400);
      http
        .expectOne((req) => req.url.includes("pv-1"))
        .flush(
          { message: "Insufficient stock" },
          { status: 400, statusText: "Bad Request" },
        );

      // After the error the pipeline must still be subscribed
      service.updateQuantity("pv-1", 1);
      tick(400);

      const req2 = http.expectOne((req) => req.url.includes("pv-1"));
      req2.flush({});
    }));

    it("calls toast.error when PATCH returns a 400 error (e.g. insufficient stock)", fakeAsync(() => {
      const { service, http } = setup();

      service.refreshFromServer({
        id: "cart-1",
        items: mockItems,
        itemCount: 3,
        totalInCents: 114700,
      });

      service.updateQuantity("pv-1", 99);
      tick(400);
      http
        .expectOne((req) => req.url.includes("pv-1"))
        .flush(
          { message: "Insufficient stock" },
          { status: 400, statusText: "Bad Request" },
        );

      expect(mockToast.error).toHaveBeenCalledTimes(1);
    }));

    it("calls toast.error when PATCH returns a 500 server error", fakeAsync(() => {
      const { service, http } = setup();

      service.refreshFromServer({
        id: "cart-1",
        items: mockItems,
        itemCount: 3,
        totalInCents: 114700,
      });

      service.updateQuantity("pv-1", 3);
      tick(400);
      http
        .expectOne((req) => req.url.includes("pv-1"))
        .flush({}, { status: 500, statusText: "Internal Server Error" });

      expect(mockToast.error).toHaveBeenCalledTimes(1);
    }));

    it("does not call toast.error on a successful PATCH", fakeAsync(() => {
      const { service, http } = setup();

      service.refreshFromServer({
        id: "cart-1",
        items: mockItems,
        itemCount: 3,
        totalInCents: 114700,
      });

      service.updateQuantity("pv-1", 3);
      tick(400);
      http.expectOne((req) => req.url.includes("pv-1")).flush({});

      expect(mockToast.error).not.toHaveBeenCalled();
    }));
  });
});
