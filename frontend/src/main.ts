import * as Sentry from '@sentry/angular';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { environment } from './environments/environment';

if (environment.sentryDsn) {
  Sentry.init({
    dsn: environment.sentryDsn,
    environment: environment.production ? 'production' : 'development',
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: environment.sentryTracesSampleRate,
    tracePropagationTargets: environment.sentryTracePropagationTargets,
    sendDefaultPii: false,
  });
}

bootstrapApplication(AppComponent, appConfig).catch((err) => {
  if (err?.name === 'ChunkLoadError' || err?.message?.includes('chunk')) {
    window.location.reload();
    return;
  }
  console.error(err);
});
