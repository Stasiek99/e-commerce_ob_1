/**
 * Verifies that the targeted Helmet configuration (fix for blanket /admin bypass)
 * keeps X-Frame-Options, X-Content-Type-Options, and Referrer-Policy active on
 * /admin routes while only disabling Content-Security-Policy there.
 */
import * as express from 'express';
import * as http from 'http';
import helmet from 'helmet';

function buildApp(): express.Express {
  const app = express();

  const helmetDefault = helmet();
  const helmetAdminJs = helmet({ contentSecurityPolicy: false });

  app.use((req: any, res: any, next: any) => {
    if (req.path.startsWith('/admin')) return helmetAdminJs(req, res, next);
    helmetDefault(req, res, next);
  });

  app.get('/admin/dashboard', (_req, res) => res.json({ ok: true }));
  app.get('/api/products', (_req, res) => res.json({ ok: true }));

  return app;
}

function request(
  server: http.Server,
  path: string,
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.get(`http://127.0.0.1:${addr.port}${path}`, (res) => {
      res.resume();
      resolve({ statusCode: res.statusCode ?? 0, headers: res.headers });
    });
    req.on('error', reject);
  });
}

describe('Helmet middleware — targeted CSP-only bypass for /admin', () => {
  let server: http.Server;

  beforeAll(
    () =>
      new Promise<void>((resolve) => {
        server = buildApp().listen(0, '127.0.0.1', resolve);
      }),
  );

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  describe('/admin routes', () => {
    let headers: http.IncomingHttpHeaders;

    beforeAll(async () => {
      ({ headers } = await request(server, '/admin/dashboard'));
    });

    it('sets x-frame-options to SAMEORIGIN or DENY', () => {
      expect(headers['x-frame-options']).toMatch(/^(SAMEORIGIN|DENY)$/i);
    });

    it('sets x-content-type-options to nosniff', () => {
      expect(headers['x-content-type-options']).toBe('nosniff');
    });

    it('sets referrer-policy', () => {
      expect(headers['referrer-policy']).toBeTruthy();
    });

    it('does NOT set content-security-policy (CSP disabled for AdminJS)', () => {
      expect(headers['content-security-policy']).toBeUndefined();
    });
  });

  describe('non-admin routes', () => {
    let headers: http.IncomingHttpHeaders;

    beforeAll(async () => {
      ({ headers } = await request(server, '/api/products'));
    });

    it('sets x-frame-options', () => {
      expect(headers['x-frame-options']).toMatch(/^(SAMEORIGIN|DENY)$/i);
    });

    it('sets x-content-type-options to nosniff', () => {
      expect(headers['x-content-type-options']).toBe('nosniff');
    });

    it('sets content-security-policy', () => {
      expect(headers['content-security-policy']).toBeTruthy();
    });

    it('sets referrer-policy', () => {
      expect(headers['referrer-policy']).toBeTruthy();
    });
  });
});
