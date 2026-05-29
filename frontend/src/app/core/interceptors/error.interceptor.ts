import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);

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
            authService.logout().subscribe();
            return throwError(() => refreshErr);
          }),
        );
      }
      return throwError(() => err);
    }),
  );
};
