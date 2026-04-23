import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { CartService } from '../services/cart.service';

export const checkoutGuard: CanActivateFn = () => {
  const cart   = inject(CartService);
  const auth   = inject(AuthService);
  const router = inject(Router);

  if (!cart.items().length) {
    return router.createUrlTree(['/cart']);
  }

  if (auth.isAuthenticated()) return true;

  // Guest explicitly chose to continue without an account this session
  if (sessionStorage.getItem('checkout_guest') === '1') return true;

  return router.createUrlTree(['/checkout/auth-choice']);
};
