import { readFileSync } from 'fs';
import { join } from 'path';

describe('index.html — third-party resource hints', () => {
  let html: string;

  beforeAll(() => {
    html = readFileSync(join(__dirname, '../src/index.html'), 'utf-8');
  });

  it('does not load the InPost GeoWidget stylesheet render-blocking', () => {
    // Injected by ScriptLoaderService from the checkout locker-picker click
    // instead — see CheckoutPageComponent.openLockerPicker().
    expect(html).not.toContain('geowidget.easypack24.net/css/easypack.css');
  });

  it('does not load the InPost GeoWidget SDK on every page', () => {
    expect(html).not.toContain('geowidget.easypack24.net/js/sdk-for-javascript.js');
  });

  it('does not load the Turnstile challenge script on every page', () => {
    // Injected by TurnstileService.getToken() on the first challenge instead.
    expect(html).not.toContain('challenges.cloudflare.com/turnstile');
  });

  it('keeps a dns-prefetch hint for geowidget.easypack24.net (on-demand origin)', () => {
    expect(html).toContain('<link rel="dns-prefetch" href="https://geowidget.easypack24.net"');
  });

  it('keeps a dns-prefetch hint for challenges.cloudflare.com (on-demand origin)', () => {
    expect(html).toContain('<link rel="dns-prefetch" href="https://challenges.cloudflare.com"');
  });

  it('contains a preconnect hint for www.googletagmanager.com (GTM origin)', () => {
    expect(html).toContain('<link rel="preconnect" href="https://www.googletagmanager.com"');
  });
});
