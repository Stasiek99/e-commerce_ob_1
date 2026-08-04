import { bootstrapApplication } from "@angular/platform-browser";
import { appConfig } from "./app/app.config";
import { AppComponent } from "./app/app.component";
import { installEarlyErrorCapture } from "./app/core/sentry";

// Buffers errors thrown before the SDK finishes loading; the SDK itself is
// fetched on idle from an app initializer. See app/core/sentry.ts.
installEarlyErrorCapture();

bootstrapApplication(AppComponent, appConfig).catch((err) => {
  if (err?.name === "ChunkLoadError" || err?.message?.includes("chunk")) {
    window.location.reload();
    return;
  }
  console.error(err);
});
