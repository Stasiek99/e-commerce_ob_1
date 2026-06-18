import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { ToastService } from '../services/toast.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const toastService = inject(ToastService);

  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      // X-Retry marks a request that already went through one refresh cycle.
      // Blocking it here prevents infinite 401 loops.
      if (
        err.status === 401 &&
        !req.url.includes('/auth/') &&
        !req.headers.has('X-Retry')
      ) {
        return authService.refresh().pipe(
          switchMap((res) => {
            const retried = req.clone({
              setHeaders: {
                Authorization: `Bearer ${res.accessToken}`,
                'X-Retry': '1',
              },
            });
            return next(retried);
          }),
          catchError((refreshErr) => {
            authService.clearSession();
            router.navigate(['/auth/login']);
            return throwError(() => refreshErr);
          }),
        );
      }

      if (err.status === 429) {
        const retryAfterSeconds = parseInt(err.headers.get('Retry-After') ?? '', 10);
        const message = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? `Za dużo żądań, spróbuj ponownie za ${retryAfterSeconds}s.`
          : 'Za dużo żądań, spróbuj ponownie za chwilę.';
        toastService.error(message);
      }

      return throwError(() => err);
    }),
  );
};
