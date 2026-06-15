import { HttpInterceptorFn } from '@angular/common/http';
import { isPlatformServer } from '@angular/common';
import { PLATFORM_ID, inject } from '@angular/core';
import { timeout } from 'rxjs/operators';

// HTTP calls that take longer than this during SSR are aborted so the render
// can still complete (with empty/error state) within the outer 10s Promise.race
// window in server.ts, rather than blocking until Vercel's 30s hard cut.
const SSR_HTTP_TIMEOUT_MS = 8_000;

export const ssrTimeoutInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isPlatformServer(inject(PLATFORM_ID))) return next(req);
  return next(req).pipe(timeout(SSR_HTTP_TIMEOUT_MS));
};
