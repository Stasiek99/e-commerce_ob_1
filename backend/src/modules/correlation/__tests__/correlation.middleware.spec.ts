import { CorrelationMiddleware } from '../correlation.middleware';
import { getCorrelationId } from '../correlation-id.storage';
import type { Request, Response, NextFunction } from 'express';

type CorrelationRequest = Request & { correlationId?: string };

function makeReq(headers: Record<string, string> = {}): CorrelationRequest {
  return { headers } as CorrelationRequest;
}

function makeRes() {
  const headers: Record<string, string> = {};
  return {
    setHeader: jest.fn((key: string, value: string) => { headers[key] = value; }),
    _headers: headers,
  };
}

describe('CorrelationMiddleware', () => {
  let middleware: CorrelationMiddleware;

  beforeEach(() => {
    middleware = new CorrelationMiddleware();
  });

  it('uses an existing x-correlation-id header', (done) => {
    const req = makeReq({ 'x-correlation-id': 'existing-id' });
    const res = makeRes();

    middleware.use(req, res as unknown as Response, (() => {
      expect(req.correlationId).toBe('existing-id');
      done();
    }) as NextFunction);
  });

  it('generates a UUID when no x-correlation-id header is present', (done) => {
    const req = makeReq();
    const res = makeRes();

    middleware.use(req, res as unknown as Response, (() => {
      expect(req.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      done();
    }) as NextFunction);
  });

  it('echoes the correlation ID back in the response header', (done) => {
    const req = makeReq({ 'x-correlation-id': 'reply-id' });
    const res = makeRes();

    middleware.use(req, res as unknown as Response, (() => {
      expect(res.setHeader).toHaveBeenCalledWith('x-correlation-id', 'reply-id');
      done();
    }) as NextFunction);
  });

  it('propagates the ID through AsyncLocalStorage so next() can read it', (done) => {
    const req = makeReq({ 'x-correlation-id': 'als-id' });
    const res = makeRes();

    middleware.use(req, res as unknown as Response, (() => {
      expect(getCorrelationId()).toBe('als-id');
      done();
    }) as NextFunction);
  });

  it('generates a unique ID per request', (done) => {
    const ids: string[] = [];
    let completed = 0;

    const collect = () => {
      middleware.use(makeReq(), makeRes() as unknown as Response, (() => {
        ids.push(getCorrelationId()!);
        if (++completed === 2) {
          expect(ids[0]).not.toBe(ids[1]);
          done();
        }
      }) as NextFunction);
    };

    collect();
    collect();
  });
});
