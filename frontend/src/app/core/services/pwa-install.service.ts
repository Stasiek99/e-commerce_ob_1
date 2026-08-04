import { Injectable, PLATFORM_ID, inject, signal } from "@angular/core";
import { isPlatformBrowser } from "@angular/common";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

@Injectable({ providedIn: "root" })
export class PwaInstallService {
  private readonly platformId = inject(PLATFORM_ID);

  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  /** True when the browser has a deferred install prompt ready to show. */
  readonly canInstall = signal(false);
  /** True after the user accepted the install prompt this session. */
  readonly isInstalled = signal(false);

  constructor() {
    if (!isPlatformBrowser(this.platformId)) return;
    // Already running as installed PWA — nothing to offer.
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    window.addEventListener("beforeinstallprompt", (e: Event) => {
      e.preventDefault();
      this.deferredPrompt = e as BeforeInstallPromptEvent;
      this.canInstall.set(true);
    });

    window.addEventListener("appinstalled", () => {
      this.deferredPrompt = null;
      this.canInstall.set(false);
      this.isInstalled.set(true);
    });
  }

  async promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
    if (!this.deferredPrompt) return "unavailable";

    await this.deferredPrompt.prompt();
    const { outcome } = await this.deferredPrompt.userChoice;

    if (outcome === "accepted") {
      this.deferredPrompt = null;
      this.canInstall.set(false);
    }

    return outcome;
  }
}
