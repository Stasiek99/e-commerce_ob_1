/**
 * PWA contract tests — offline catalog & push notifications
 *
 * Validates:
 *   1. manifest.webmanifest  — installability & branding
 *   2. ngsw-config.json      — offline catalog cache contract
 *   3. app.config.ts         — service-worker provider wired
 *
 * ⚠️  Push notifications are NOT yet implemented:
 *      No SwPush service, no VAPID key, no subscription management.
 *      When implemented, add a PushNotificationService spec here.
 */

import * as fs from "fs";
import * as path from "path";
import { appConfig } from "./app.config";

// ─── path helpers ────────────────────────────────────────────────────────────

// __dirname = frontend/src/app  →  ../.. = frontend/
const frontendRoot = path.resolve(__dirname, "../..");

function readJson<T>(relativeToFrontend: string): T {
  return JSON.parse(
    fs.readFileSync(path.join(frontendRoot, relativeToFrontend), "utf-8"),
  ) as T;
}

// ─── types ───────────────────────────────────────────────────────────────────

interface WebManifest {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  lang: string;
  icons: Array<{ src: string; sizes: string; type: string; purpose?: string }>;
}

interface NgswConfig {
  navigationRequestStrategy: string;
  assetGroups: Array<{
    name: string;
    installMode: string;
    updateMode?: string;
    resources: { files?: string[]; urls?: string[] };
  }>;
  dataGroups: Array<{
    name: string;
    urls: string[];
    cacheConfig: {
      strategy: string;
      maxSize: number;
      maxAge: string;
      timeout: string;
    };
  }>;
}

// ─── manifest.webmanifest ────────────────────────────────────────────────────

describe("manifest.webmanifest", () => {
  let manifest: WebManifest;

  beforeAll(() => {
    manifest = readJson<WebManifest>("src/manifest.webmanifest");
  });

  it("has required identity fields for PWA installability", () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
  });

  it("display is standalone for native-app feel", () => {
    expect(manifest.display).toBe("standalone");
  });

  it("has a 192×192 icon (required by Chrome install prompt)", () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain("192x192");
  });

  it("has a 512×512 icon (required for splash screens)", () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toContain("512x512");
  });

  it("theme_color matches brand gold #c9a96e", () => {
    expect(manifest.theme_color).toBe("#c9a96e");
  });

  it("lang is set to pl (Polish market)", () => {
    expect(manifest.lang).toBe("pl");
  });

  it("background_color is set (prevents white flash on launch)", () => {
    expect(manifest.background_color).toBeTruthy();
  });
});

// ─── ngsw-config.json — offline cache contract ───────────────────────────────

describe("ngsw-config.json (offline catalog)", () => {
  let config: NgswConfig;

  beforeAll(() => {
    config = readJson<NgswConfig>("ngsw-config.json");
  });

  // navigation strategy
  it("uses freshness navigation strategy (network-first, falls back to cache)", () => {
    expect(config.navigationRequestStrategy).toBe("freshness");
  });

  // asset groups
  it("has app-shell asset group with prefetch install mode", () => {
    const group = config.assetGroups.find((g) => g.name === "app-shell");
    expect(group).toBeDefined();
    expect(group!.installMode).toBe("prefetch");
  });

  it("app-shell caches core JS/CSS/manifest files", () => {
    const group = config.assetGroups.find((g) => g.name === "app-shell")!;
    const files = group.resources.files ?? [];
    expect(files.some((f) => f.includes(".js"))).toBe(true);
    expect(files.some((f) => f.includes(".css"))).toBe(true);
    expect(files).toContain("/manifest.webmanifest");
  });

  it("has assets group with lazy install and prefetch update", () => {
    const group = config.assetGroups.find((g) => g.name === "assets");
    expect(group).toBeDefined();
    expect(group!.installMode).toBe("lazy");
    expect(group!.updateMode).toBe("prefetch");
  });

  // data group — product catalog
  it("has a product-catalog data group for offline browsing", () => {
    const group = config.dataGroups.find((g) => g.name === "product-catalog");
    expect(group).toBeDefined();
  });

  it("product-catalog covers /products** API endpoint", () => {
    const group = config.dataGroups.find((g) => g.name === "product-catalog")!;
    expect(group.urls.some((u) => u.includes("/products"))).toBe(true);
  });

  it("product-catalog covers /categories** API endpoint", () => {
    const group = config.dataGroups.find((g) => g.name === "product-catalog")!;
    expect(group.urls.some((u) => u.includes("/categories"))).toBe(true);
  });

  it("product-catalog uses freshness strategy (network-first, stale on timeout)", () => {
    const group = config.dataGroups.find((g) => g.name === "product-catalog")!;
    expect(group.cacheConfig.strategy).toBe("freshness");
  });

  it("product-catalog falls back to cache after 5 s network timeout", () => {
    const group = config.dataGroups.find((g) => g.name === "product-catalog")!;
    expect(group.cacheConfig.timeout).toBe("5s");
  });

  it("product-catalog cache entries expire after 1 day", () => {
    const group = config.dataGroups.find((g) => g.name === "product-catalog")!;
    expect(group.cacheConfig.maxAge).toBe("1d");
  });

  it("product-catalog holds at most 50 cached responses", () => {
    const group = config.dataGroups.find((g) => g.name === "product-catalog")!;
    expect(group.cacheConfig.maxSize).toBe(50);
  });
});

// ─── app.config.ts — service-worker registration ─────────────────────────────
//
// Angular EnvironmentProviders are circular objects (InjectionToken → factory
// → token) — JSON.stringify throws. Read the source file instead to assert the
// declared configuration without coupling to Angular's internal shapes.

describe("appConfig service-worker registration", () => {
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(
      path.join(frontendRoot, "src/app/app.config.ts"),
      "utf-8",
    );
  });

  it("has a non-empty providers array at runtime", () => {
    expect(Array.isArray(appConfig.providers)).toBe(true);
    expect(appConfig.providers.length).toBeGreaterThan(0);
  });

  it("calls provideServiceWorker with ngsw-worker.js", () => {
    expect(source).toContain('provideServiceWorker("ngsw-worker.js"');
  });

  it("registers SW only when stable (not on first paint) with 30 s timeout", () => {
    expect(source).toContain(
      'registrationStrategy: "registerWhenStable:30000"',
    );
  });

  it("SW is disabled in dev mode (production-only registration)", () => {
    expect(source).toContain("enabled: !isDevMode()");
  });
});

// ─── app.config.ts — auth initializer SSR guard ──────────────────────────────
//
// The auth refresh appInitializer must skip in SSR/prerender.
// Without the guard, every prerendered product page fires an extra
// POST /auth/refresh against the backend (all returning 401), multiplying
// build-time network calls by the number of prerendered routes.

describe("appConfig auth initializer — SSR/prerender guard", () => {
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(
      path.join(frontendRoot, "src/app/app.config.ts"),
      "utf-8",
    );
  });

  it("imports isPlatformBrowser from @angular/common", () => {
    expect(source).toMatch(
      /isPlatformBrowser.*from\s+['"]@angular\/common['"]/,
    );
  });

  it("imports PLATFORM_ID from @angular/core", () => {
    expect(source).toContain("PLATFORM_ID");
  });

  it("guards auth.refresh() with !isPlatformBrowser(inject(PLATFORM_ID))", () => {
    expect(source).toMatch(/!isPlatformBrowser\(inject\(PLATFORM_ID\)\)/);
  });

  it("returns early when platform is not browser (no auth refresh in SSR)", () => {
    expect(source).toMatch(
      /if\s*\(!isPlatformBrowser\(inject\(PLATFORM_ID\)\)\)\s*return/,
    );
  });
});

// ─── push notifications — implementation gap ──────────────────────────────────

/**
 * ⚠️  The following tests are intentionally pending.
 *
 *  Push notifications require:
 *    1. Backend: VAPID key pair, POST /notifications/subscribe endpoint, web-push library
 *    2. Frontend: PushNotificationService wrapping SwPush, subscription opt-in UI
 *    3. ngsw-config: no changes needed — SwPush uses the existing SW
 *
 *  When implemented, replace each `it.todo` with a full spec.
 */
describe("push notifications (⚠️ not yet implemented)", () => {
  it.todo("PushNotificationService exists and wraps SwPush");
  it.todo(
    "requestSubscription() calls swPush.requestSubscription with VAPID key",
  );
  it.todo(
    "requestSubscription() POSTs subscription to /api/notifications/subscribe",
  );
  it.todo(
    "requestSubscription() handles NotAllowedError (user denied permission)",
  );
  it.todo("requestSubscription() handles non-HTTPS environment gracefully");
  it.todo(
    "unsubscribe() calls swPush.unsubscribe and DELETE /api/notifications/subscribe",
  );
  it.todo("messages$ forwards SwPush.messages observable to consumers");
});
