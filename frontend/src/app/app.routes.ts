import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { checkoutGuard } from './core/guards/checkout.guard';
import { guestGuard } from './core/guards/guest.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/home/home.component').then((m) => m.HomeComponent),
  },
  {
    path: 'products',
    loadComponent: () =>
      import('./features/catalog/product-list/product-list.component').then(
        (m) => m.ProductListComponent,
      ),
  },
  {
    path: 'products/:slug',
    loadComponent: () =>
      import('./features/catalog/product-detail/product-detail.component').then(
        (m) => m.ProductDetailComponent,
      ),
  },
  {
    path: 'category/:slug',
    loadComponent: () =>
      import('./features/catalog/product-list/product-list.component').then(
        (m) => m.ProductListComponent,
      ),
  },
  {
    path: 'cart',
    loadComponent: () =>
      import('./features/cart/cart-page/cart-page.component').then(
        (m) => m.CartPageComponent,
      ),
  },
  {
    path: 'checkout',
    canActivate: [checkoutGuard],
    loadComponent: () =>
      import('./features/checkout/checkout-page/checkout-page.component').then(
        (m) => m.CheckoutPageComponent,
      ),
  },
  {
    path: 'checkout/auth-choice',
    loadComponent: () =>
      import('./features/checkout/checkout-auth-choice/checkout-auth-choice.component').then(
        (m) => m.CheckoutAuthChoiceComponent,
      ),
  },
  {
    path: 'checkout/success',
    loadComponent: () =>
      import('./features/checkout/checkout-success/checkout-success.component').then(
        (m) => m.CheckoutSuccessComponent,
      ),
  },
  {
    path: 'checkout/failure',
    loadComponent: () =>
      import('./features/checkout/checkout-failure/checkout-failure.component').then(
        (m) => m.CheckoutFailureComponent,
      ),
  },
  {
    path: 'auth/login',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'auth/register',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/register/register.component').then(
        (m) => m.RegisterComponent,
      ),
  },
  {
    path: 'auth/callback',
    loadComponent: () =>
      import('./features/auth/google-callback/google-callback.component').then(
        (m) => m.GoogleCallbackComponent,
      ),
  },
  {
    path: 'auth/verify-email',
    loadComponent: () =>
      import('./features/auth/verify-email/verify-email.component').then(
        (m) => m.VerifyEmailComponent,
      ),
  },
  {
    path: 'auth/forgot-password',
    loadComponent: () =>
      import('./features/auth/forgot-password/forgot-password.component').then(
        (m) => m.ForgotPasswordComponent,
      ),
  },
  {
    path: 'auth/reset-password',
    loadComponent: () =>
      import('./features/auth/reset-password/reset-password.component').then(
        (m) => m.ResetPasswordComponent,
      ),
  },
  {
    path: 'account',
    canActivate: [authGuard],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./features/account/dashboard/dashboard.component').then(
            (m) => m.DashboardComponent,
          ),
        pathMatch: 'full',
      },
      {
        path: 'orders',
        loadComponent: () =>
          import('./features/account/orders/order-list.component').then(
            (m) => m.OrderListComponent,
          ),
      },
      {
        path: 'orders/:id',
        loadComponent: () =>
          import('./features/account/orders/order-detail.component').then(
            (m) => m.OrderDetailComponent,
          ),
      },
      {
        path: 'profile',
        loadComponent: () =>
          import('./features/account/profile/profile.component').then(
            (m) => m.ProfileComponent,
          ),
      },
      {
        path: 'addresses',
        loadComponent: () =>
          import('./features/account/addresses/addresses.component').then(
            (m) => m.AddressesComponent,
          ),
      },
    ],
  },
  {
    path: 'orders/track',
    loadComponent: () =>
      import('./features/orders/track-order/track-order.component').then(
        (m) => m.TrackOrderComponent,
      ),
  },
  {
    path: 'wishlist',
    loadComponent: () =>
      import('./features/wishlist/wishlist.component').then((m) => m.WishlistComponent),
  },
  {
    path: 'returns',
    loadComponent: () =>
      import('./features/returns/return-request/return-request.component').then(
        (m) => m.ReturnRequestComponent,
      ),
  },
  {
    path: 'legal/terms',
    loadComponent: () =>
      import('./features/legal/terms/terms.component').then((m) => m.TermsComponent),
  },
  {
    path: 'legal/privacy',
    loadComponent: () =>
      import('./features/legal/privacy/privacy.component').then((m) => m.PrivacyComponent),
  },
  {
    path: 'legal/withdrawal',
    loadComponent: () =>
      import('./features/legal/withdrawal/withdrawal.component').then(
        (m) => m.WithdrawalComponent,
      ),
  },
  {
    path: 'partnership',
    loadComponent: () =>
      import('./features/partnership/partnership.component').then(
        (m) => m.PartnershipComponent,
      ),
  },
  {
    path: '**',
    loadComponent: () =>
      import('./features/not-found/not-found.component').then(
        (m) => m.NotFoundComponent,
      ),
  },
];
