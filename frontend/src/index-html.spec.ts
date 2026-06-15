import { readFileSync } from 'fs';
import { join } from 'path';

describe('index.html — preconnect hints', () => {
  let html: string;

  beforeAll(() => {
    html = readFileSync(join(__dirname, '../src/index.html'), 'utf-8');
  });

  it('contains a preconnect hint for geowidget.easypack24.net (render-blocking CSS origin)', () => {
    expect(html).toContain(
      '<link rel="preconnect" href="https://geowidget.easypack24.net"',
    );
  });

  it('contains a preconnect hint for challenges.cloudflare.com (Turnstile origin)', () => {
    expect(html).toContain(
      '<link rel="preconnect" href="https://challenges.cloudflare.com"',
    );
  });

  it('contains a preconnect hint for www.googletagmanager.com (GTM origin)', () => {
    expect(html).toContain(
      '<link rel="preconnect" href="https://www.googletagmanager.com"',
    );
  });

  it('places preconnect hints before the external stylesheet to allow early DNS resolution', () => {
    const preconnectIndex = html.indexOf('<link rel="preconnect"');
    const stylesheetIndex = html.indexOf(
      '<link rel="stylesheet" href="https://geowidget.easypack24.net',
    );
    expect(preconnectIndex).toBeGreaterThanOrEqual(0);
    expect(stylesheetIndex).toBeGreaterThanOrEqual(0);
    expect(preconnectIndex).toBeLessThan(stylesheetIndex);
  });
});
