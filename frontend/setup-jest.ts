import { setupZoneTestEnv } from "jest-preset-angular/setup-env/zone";
setupZoneTestEnv();

// jsdom doesn't implement matchMedia. Taiga UI 5's TUI_DARK_MODE token calls
// WA_WINDOW.matchMedia('(prefers-color-scheme: dark)') eagerly at injection,
// which throws in every spec that provides Taiga UI without this stub.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (media: string) => ({
    matches: false,
    media,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});
