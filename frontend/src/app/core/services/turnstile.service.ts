import { Injectable, PLATFORM_ID, inject } from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import { environment } from "../../../environments/environment";
import { ScriptLoaderService } from "./script-loader.service";

const TURNSTILE_API_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      size?: "invisible" | "normal" | "compact";
      execution?: "render" | "execute";
      callback?: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
    },
  ): string;
  execute(widgetId: string): void;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

@Injectable({ providedIn: "root" })
export class TurnstileService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly scriptLoader = inject(ScriptLoaderService);
  private readonly siteKey = environment.turnstileSiteKey;
  private container: HTMLDivElement | null = null;
  private widgetId: string | null = null;

  async getToken(): Promise<string> {
    if (!isPlatformBrowser(this.platformId)) {
      return ""; // SSR — challenges cannot run server-side
    }
    if (!this.siteKey) {
      if (environment.production) {
        throw new Error(
          "[Turnstile] TURNSTILE_SITE_KEY is not set for production. " +
            "Set it in Vercel environment variables and trigger a redeploy.",
        );
      }
      return ""; // dev bypass
    }

    // Loaded here rather than from index.html: the challenge script is only
    // needed by the handful of forms that submit a token, so keeping it off
    // every page load removes ~60KB of third-party JS from the critical path.
    if (!window.turnstile) {
      await this.scriptLoader
        .loadScript(TURNSTILE_API_URL)
        .catch(() => undefined);
    }
    const api = window.turnstile;
    if (!api) return "";

    return new Promise<string>((resolve) => {
      if (!this.container) {
        this.container = document.createElement("div");
        this.container.style.cssText =
          "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
        document.body.appendChild(this.container);
      }

      if (this.widgetId !== null) {
        api.remove(this.widgetId);
        this.widgetId = null;
      }

      this.widgetId = api.render(this.container, {
        sitekey: this.siteKey,
        size: "invisible",
        execution: "execute",
        callback: (token) => resolve(token),
        "error-callback": () => resolve(""),
        "expired-callback": () => resolve(""),
      });

      api.execute(this.widgetId);
    });
  }
}
