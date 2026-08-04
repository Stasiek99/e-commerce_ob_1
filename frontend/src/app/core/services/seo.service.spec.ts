import { TestBed } from "@angular/core/testing";
import { Router } from "@angular/router";
import { DOCUMENT } from "@angular/common";
import { SeoService, ProductSeoInput, SellerInfo } from "./seo.service";

function getRobotsMeta(doc: Document): string | null {
  return (
    doc.querySelector('meta[name="robots"]')?.getAttribute("content") ?? null
  );
}

function getCanonicalHref(doc: Document): string | null {
  return (
    doc.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null
  );
}

function getJsonLd(doc: Document): Record<string, unknown> | null {
  const el = doc.getElementById("ld-product");
  if (!el) return null;
  return JSON.parse(el.textContent ?? "null") as Record<string, unknown>;
}

function getOrgJsonLd(doc: Document): Record<string, unknown> | null {
  const el = doc.getElementById("ld-organization");
  if (!el) return null;
  return JSON.parse(el.textContent ?? "null") as Record<string, unknown>;
}

function getOrgGraph(doc: Document): Record<string, unknown>[] {
  const ld = getOrgJsonLd(doc);
  return (ld?.["@graph"] as Record<string, unknown>[]) ?? [];
}

function getGraph(doc: Document): Record<string, unknown>[] {
  const ld = getJsonLd(doc);
  return (ld?.["@graph"] as Record<string, unknown>[]) ?? [];
}

function getProductNode(doc: Document): Record<string, unknown> | undefined {
  return getGraph(doc).find((n) => n["@type"] === "Product");
}

function getBreadcrumbNode(doc: Document): Record<string, unknown> | undefined {
  return getGraph(doc).find((n) => n["@type"] === "BreadcrumbList");
}

const SELLER: SellerInfo = {
  name: "Aromaterie",
  legalName: "Aromaterie Sp. z o.o.",
  street: "Kwiatowa 1",
  postalCode: "00-001",
  city: "Warszawa",
  nip: "1234567890",
  email: "kontakt@aromaterie.pl",
};

const PERFUME: ProductSeoInput = {
  name: "Rose Oud",
  slug: "rose-oud",
  brand: "Chogan",
  shortDescription: "Ciepły orientalny zapach.",
  images: [{ url: "https://cdn.example.com/rose-oud.jpg" }],
  variants: [
    { priceInCents: 12900, stock: 5 },
    { priceInCents: 18900, stock: 0 },
  ],
  avgRating: 4.7,
  reviewCount: 23,
  category: { name: "Perfumy", slug: "perfume" },
};

describe("SeoService", () => {
  let service: SeoService;
  let doc: Document;

  function setup(): SeoService {
    TestBed.configureTestingModule({
      providers: [
        SeoService,
        { provide: Router, useValue: { url: "/products" } },
      ],
    });
    service = TestBed.inject(SeoService);
    doc = TestBed.inject(DOCUMENT);
    return service;
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    doc.querySelectorAll('meta[name="robots"]').forEach((el) => el.remove());
    doc.querySelectorAll('link[rel="canonical"]').forEach((el) => el.remove());
    doc.querySelectorAll("#ld-product").forEach((el) => el.remove());
    doc.querySelectorAll("#ld-organization").forEach((el) => el.remove());
  });

  // ── robots tag default ────────────────────────────────────────────────────

  describe("updatePageMeta — robots default", () => {
    it("sets robots=index,follow after updatePageMeta", () => {
      setup().updatePageMeta({ title: "Perfumy", path: "/products/perfume" });

      expect(getRobotsMeta(doc)).toBe("index,follow");
    });

    it("resets robots to index,follow even when called multiple times", () => {
      const svc = setup();

      svc.updatePageMeta({ title: "First", path: "/products" });
      svc.updatePageMeta({ title: "Second", path: "/products/diffusers" });

      expect(getRobotsMeta(doc)).toBe("index,follow");
    });
  });

  // ── setRobotsTag ──────────────────────────────────────────────────────────

  describe("setRobotsTag", () => {
    it("sets robots meta to noindex,follow on filtered pages", () => {
      setup().setRobotsTag("noindex,follow");

      expect(getRobotsMeta(doc)).toBe("noindex,follow");
    });

    it("sets robots meta to index,follow when called explicitly", () => {
      setup().setRobotsTag("index,follow");

      expect(getRobotsMeta(doc)).toBe("index,follow");
    });

    it("overwrites a previous noindex when called with index,follow", () => {
      const svc = setup();
      svc.setRobotsTag("noindex,follow");

      svc.setRobotsTag("index,follow");

      expect(getRobotsMeta(doc)).toBe("index,follow");
    });
  });

  // ── noindex is cleared on next navigation ─────────────────────────────────

  describe("noindex cleared by subsequent updatePageMeta", () => {
    it("resets noindex,follow back to index,follow when navigating to a clean page", () => {
      const svc = setup();
      svc.updatePageMeta({ title: "Filtered", path: "/products/perfume" });
      svc.setRobotsTag("noindex,follow");

      svc.updatePageMeta({
        title: "Clean category",
        path: "/products/perfume",
      });

      expect(getRobotsMeta(doc)).toBe("index,follow");
    });

    it("does not leave stale noindex when navigating from a filtered to an unfiltered page", () => {
      const svc = setup();
      svc.setRobotsTag("noindex,follow");
      expect(getRobotsMeta(doc)).toBe("noindex,follow");

      svc.updatePageMeta({ title: "Perfumy", path: "/products/perfume" });

      expect(getRobotsMeta(doc)).toBe("index,follow");
    });
  });

  // ── canonical always uses clean path ──────────────────────────────────────

  describe("canonical URL", () => {
    it("sets canonical to the provided path without query params", () => {
      setup().updatePageMeta({ title: "Perfumy", path: "/products/perfume" });

      expect(getCanonicalHref(doc)).toBe(
        "https://aromaterie.pl/products/perfume",
      );
    });

    it("sets canonical to /products when no slug is present", () => {
      setup().updatePageMeta({
        title: "Wszystkie produkty",
        path: "/products",
      });

      expect(getCanonicalHref(doc)).toBe("https://aromaterie.pl/products");
    });

    it("updates canonical on each call without duplicating the link tag", () => {
      const svc = setup();
      svc.updatePageMeta({ title: "A", path: "/products/perfume" });
      svc.updatePageMeta({ title: "B", path: "/products/diffusers" });

      expect(doc.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
      expect(getCanonicalHref(doc)).toBe(
        "https://aromaterie.pl/products/diffusers",
      );
    });
  });

  // ── setProductJsonLd — @graph structure ───────────────────────────────────

  describe("setProductJsonLd — @graph output structure", () => {
    it("emits a single #ld-product script tag", () => {
      setup().setProductJsonLd(PERFUME);

      expect(doc.querySelectorAll("#ld-product")).toHaveLength(1);
    });

    it("uses @graph as the top-level structure", () => {
      setup().setProductJsonLd(PERFUME);

      const ld = getJsonLd(doc);
      expect(ld?.["@context"]).toBe("https://schema.org");
      expect(Array.isArray(ld?.["@graph"])).toBe(true);
    });

    it("replaces the script tag on re-call without duplicating", () => {
      const svc = setup();
      svc.setProductJsonLd(PERFUME);
      svc.setProductJsonLd({ ...PERFUME, name: "Updated Name" });

      expect(doc.querySelectorAll("#ld-product")).toHaveLength(1);
      expect(getProductNode(doc)?.["name"]).toBe("Updated Name");
    });
  });

  // ── setProductJsonLd — availability ──────────────────────────────────────

  describe("setProductJsonLd — availability", () => {
    it("sets availability to InStock when at least one variant has stock > 0", () => {
      const input: ProductSeoInput = {
        ...PERFUME,
        variants: [
          { priceInCents: 12900, stock: 3 },
          { priceInCents: 18900, stock: 0 },
        ],
      };

      setup().setProductJsonLd(input);

      const offer = getProductNode(doc)?.["offers"] as Record<string, unknown>;
      expect(offer["availability"]).toBe("https://schema.org/InStock");
    });

    it("sets availability to OutOfStock when all variants have stock 0", () => {
      const input: ProductSeoInput = {
        ...PERFUME,
        variants: [
          { priceInCents: 12900, stock: 0 },
          { priceInCents: 18900, stock: 0 },
        ],
      };

      setup().setProductJsonLd(input);

      const offer = getProductNode(doc)?.["offers"] as Record<string, unknown>;
      expect(offer["availability"]).toBe("https://schema.org/OutOfStock");
    });

    it("defaults to InStock when variants carry no stock field", () => {
      const input: ProductSeoInput = {
        ...PERFUME,
        variants: [{ priceInCents: 12900 }],
      };

      setup().setProductJsonLd(input);

      const offer = getProductNode(doc)?.["offers"] as Record<string, unknown>;
      expect(offer["availability"]).toBe("https://schema.org/InStock");
    });

    it("defaults to InStock when variants array is absent", () => {
      const input: ProductSeoInput = { name: "Test", slug: "test" };

      setup().setProductJsonLd(input);

      const offer = getProductNode(doc)?.["offers"] as Record<string, unknown>;
      expect(offer["availability"]).toBe("https://schema.org/InStock");
    });
  });

  // ── setProductJsonLd — BreadcrumbList ─────────────────────────────────────

  describe("setProductJsonLd — BreadcrumbList", () => {
    it("includes BreadcrumbList in @graph when category is provided", () => {
      setup().setProductJsonLd(PERFUME);

      expect(getBreadcrumbNode(doc)).toBeDefined();
    });

    it("omits BreadcrumbList from @graph when category is null", () => {
      setup().setProductJsonLd({ ...PERFUME, category: null });

      expect(getBreadcrumbNode(doc)).toBeUndefined();
    });

    it("omits BreadcrumbList from @graph when category is not provided", () => {
      const { category: _cat, ...noCategory } = PERFUME;
      setup().setProductJsonLd(noCategory);

      expect(getBreadcrumbNode(doc)).toBeUndefined();
    });

    it("breadcrumb has 3 items: Home → Category → Product", () => {
      setup().setProductJsonLd(PERFUME);

      const items = getBreadcrumbNode(doc)?.["itemListElement"] as Array<
        Record<string, unknown>
      >;
      expect(items).toHaveLength(3);
      expect(items[0]["position"]).toBe(1);
      expect(items[1]["position"]).toBe(2);
      expect(items[2]["position"]).toBe(3);
    });

    it("breadcrumb item 1 links to the site root", () => {
      setup().setProductJsonLd(PERFUME);

      const items = getBreadcrumbNode(doc)?.["itemListElement"] as Array<
        Record<string, unknown>
      >;
      expect(items[0]["item"]).toBe("https://aromaterie.pl");
    });

    it("breadcrumb item 2 links to the category URL", () => {
      setup().setProductJsonLd(PERFUME);

      const items = getBreadcrumbNode(doc)?.["itemListElement"] as Array<
        Record<string, unknown>
      >;
      expect(items[1]["item"]).toBe("https://aromaterie.pl/category/perfume");
      expect(items[1]["name"]).toBe("Perfumy");
    });

    it("breadcrumb item 3 is the product name with no item URL", () => {
      setup().setProductJsonLd(PERFUME);

      const items = getBreadcrumbNode(doc)?.["itemListElement"] as Array<
        Record<string, unknown>
      >;
      expect(items[2]["name"]).toBe("Rose Oud");
      expect(items[2]["item"]).toBeUndefined();
    });
  });

  // ── setProductJsonLd — aggregateRating ───────────────────────────────────

  describe("setProductJsonLd — aggregateRating", () => {
    it("includes aggregateRating when avgRating and reviewCount are set", () => {
      setup().setProductJsonLd(PERFUME);

      const product = getProductNode(doc);
      const ar = product?.["aggregateRating"] as Record<string, unknown>;
      expect(ar["@type"]).toBe("AggregateRating");
      expect(ar["ratingValue"]).toBe("4.7");
      expect(ar["reviewCount"]).toBe(23);
    });

    it("omits aggregateRating when reviewCount is 0", () => {
      setup().setProductJsonLd({ ...PERFUME, reviewCount: 0 });

      expect(getProductNode(doc)?.["aggregateRating"]).toBeUndefined();
    });

    it("omits aggregateRating when avgRating is null", () => {
      setup().setProductJsonLd({ ...PERFUME, avgRating: null });

      expect(getProductNode(doc)?.["aggregateRating"]).toBeUndefined();
    });
  });

  // ── setProductJsonLd — offer type ─────────────────────────────────────────

  describe("setProductJsonLd — offer type", () => {
    it("uses a single Offer for a product with one variant", () => {
      const input: ProductSeoInput = {
        ...PERFUME,
        variants: [{ priceInCents: 12900, stock: 5 }],
      };

      setup().setProductJsonLd(input);

      const offer = getProductNode(doc)?.["offers"] as Record<string, unknown>;
      expect(offer["@type"]).toBe("Offer");
      expect(offer["price"]).toBe("129.00");
    });

    it("uses AggregateOffer for a product with multiple variants", () => {
      setup().setProductJsonLd(PERFUME);

      const offer = getProductNode(doc)?.["offers"] as Record<string, unknown>;
      expect(offer["@type"]).toBe("AggregateOffer");
      expect(offer["lowPrice"]).toBe("129.00");
      expect(offer["highPrice"]).toBe("189.00");
    });
  });

  // ── setOrganizationJsonLd ─────────────────────────────────────────────────

  describe("setOrganizationJsonLd", () => {
    it("emits a single #ld-organization script tag", () => {
      setup().setOrganizationJsonLd(SELLER);

      expect(doc.querySelectorAll("#ld-organization")).toHaveLength(1);
    });

    it("does not overwrite #ld-product when called", () => {
      const svc = setup();
      svc.setProductJsonLd(PERFUME);
      svc.setOrganizationJsonLd(SELLER);

      expect(doc.querySelectorAll("#ld-product")).toHaveLength(1);
      expect(doc.querySelectorAll("#ld-organization")).toHaveLength(1);
    });

    it("uses @graph as the top-level structure with @context schema.org", () => {
      setup().setOrganizationJsonLd(SELLER);

      const ld = getOrgJsonLd(doc);
      expect(ld?.["@context"]).toBe("https://schema.org");
      expect(Array.isArray(ld?.["@graph"])).toBe(true);
    });

    it("includes an Organization node with correct name and taxID", () => {
      setup().setOrganizationJsonLd(SELLER);

      const orgNode = getOrgGraph(doc).find(
        (n) => n["@type"] === "Organization",
      );
      expect(orgNode).toBeDefined();
      expect(orgNode?.["name"]).toBe("Aromaterie");
      expect(orgNode?.["taxID"]).toBe("1234567890");
    });

    it("Organization node includes a PostalAddress with all required fields", () => {
      setup().setOrganizationJsonLd(SELLER);

      const orgNode = getOrgGraph(doc).find(
        (n) => n["@type"] === "Organization",
      );
      const address = orgNode?.["address"] as Record<string, unknown>;
      expect(address["@type"]).toBe("PostalAddress");
      expect(address["streetAddress"]).toBe("Kwiatowa 1");
      expect(address["postalCode"]).toBe("00-001");
      expect(address["addressLocality"]).toBe("Warszawa");
      expect(address["addressCountry"]).toBe("PL");
    });

    it("includes a WebSite node with a SearchAction pointing to /products", () => {
      setup().setOrganizationJsonLd(SELLER);

      const webNode = getOrgGraph(doc).find((n) => n["@type"] === "WebSite");
      expect(webNode).toBeDefined();
      expect(webNode?.["url"]).toBe("https://aromaterie.pl");

      const action = webNode?.["potentialAction"] as Record<string, unknown>;
      expect(action["@type"]).toBe("SearchAction");
      const target = action["target"] as Record<string, unknown>;
      expect(target["urlTemplate"]).toContain(
        "/products?q={search_term_string}",
      );
    });

    it("replaces existing #ld-organization on re-call without duplicating", () => {
      const svc = setup();
      svc.setOrganizationJsonLd(SELLER);
      svc.setOrganizationJsonLd({ ...SELLER, name: "Updated Name" });

      expect(doc.querySelectorAll("#ld-organization")).toHaveLength(1);
      const orgNode = getOrgGraph(doc).find(
        (n) => n["@type"] === "Organization",
      );
      expect(orgNode?.["name"]).toBe("Updated Name");
    });
  });
});
