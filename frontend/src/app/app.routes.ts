import { Routes } from "@angular/router";
import { authGuard } from "./core/guards/auth.guard";
import { checkoutGuard } from "./core/guards/checkout.guard";
import { guestGuard } from "./core/guards/guest.guard";

export const routes: Routes = [
  {
    path: "",
    title: "Strona główna",
    loadComponent: () =>
      import("./features/home/home.component").then((m) => m.HomeComponent),
  },
  {
    path: "products",
    title: "Sklep",
    data: { preload: true },
    loadComponent: () =>
      import("./features/catalog/product-list/product-list.component").then(
        (m) => m.ProductListComponent,
      ),
  },
  {
    path: "products/:slug",
    title: "Produkt",
    data: { preload: true },
    loadComponent: () =>
      import("./features/catalog/product-detail/product-detail.component").then(
        (m) => m.ProductDetailComponent,
      ),
  },
  {
    path: "category/:slug",
    title: "Kategoria",
    data: { preload: true },
    loadComponent: () =>
      import("./features/catalog/product-list/product-list.component").then(
        (m) => m.ProductListComponent,
      ),
  },
  {
    // Polish slug on purpose: this route's job is to rank for "dobór zapachu"
    // style queries, and the URL is part of that signal.
    path: "dobierz-zapach",
    title: "Dobierz zapach",
    data: { preload: true },
    loadComponent: () =>
      import("./features/finder/finder-page.component").then(
        (m) => m.FinderPageComponent,
      ),
  },
  {
    path: "cart",
    title: "Koszyk",
    data: { preload: true },
    loadComponent: () =>
      import("./features/cart/cart-page/cart-page.component").then(
        (m) => m.CartPageComponent,
      ),
  },
  {
    path: "checkout",
    title: "Realizacja zamówienia",
    canActivate: [checkoutGuard],
    loadComponent: () =>
      import("./features/checkout/checkout-page/checkout-page.component").then(
        (m) => m.CheckoutPageComponent,
      ),
  },
  {
    path: "checkout/auth-choice",
    title: "Logowanie do zamówienia",
    loadComponent: () =>
      import("./features/checkout/checkout-auth-choice/checkout-auth-choice.component").then(
        (m) => m.CheckoutAuthChoiceComponent,
      ),
  },
  {
    path: "checkout/success",
    title: "Zamówienie złożone",
    loadComponent: () =>
      import("./features/checkout/checkout-success/checkout-success.component").then(
        (m) => m.CheckoutSuccessComponent,
      ),
  },
  {
    path: "checkout/failure",
    title: "Błąd płatności",
    loadComponent: () =>
      import("./features/checkout/checkout-failure/checkout-failure.component").then(
        (m) => m.CheckoutFailureComponent,
      ),
  },
  {
    path: "auth/login",
    title: "Logowanie",
    canActivate: [guestGuard],
    loadComponent: () =>
      import("./features/auth/login/login.component").then(
        (m) => m.LoginComponent,
      ),
  },
  {
    path: "auth/register",
    title: "Rejestracja",
    canActivate: [guestGuard],
    loadComponent: () =>
      import("./features/auth/register/register.component").then(
        (m) => m.RegisterComponent,
      ),
  },
  {
    path: "auth/callback",
    title: "Logowanie przez Google",
    loadComponent: () =>
      import("./features/auth/google-callback/google-callback.component").then(
        (m) => m.GoogleCallbackComponent,
      ),
  },
  {
    path: "auth/verify-email",
    title: "Weryfikacja e-mail",
    loadComponent: () =>
      import("./features/auth/verify-email/verify-email.component").then(
        (m) => m.VerifyEmailComponent,
      ),
  },
  {
    path: "auth/forgot-password",
    title: "Przypomnij hasło",
    loadComponent: () =>
      import("./features/auth/forgot-password/forgot-password.component").then(
        (m) => m.ForgotPasswordComponent,
      ),
  },
  {
    path: "auth/reset-password",
    title: "Resetowanie hasła",
    loadComponent: () =>
      import("./features/auth/reset-password/reset-password.component").then(
        (m) => m.ResetPasswordComponent,
      ),
  },
  {
    path: "auth/magic-link",
    title: "Logowanie linkiem",
    loadComponent: () =>
      import("./features/auth/magic-link/magic-link.component").then(
        (m) => m.MagicLinkComponent,
      ),
  },
  {
    path: "auth/magic-login",
    title: "Weryfikacja linku logowania",
    loadComponent: () =>
      import("./features/auth/magic-login/magic-login.component").then(
        (m) => m.MagicLoginComponent,
      ),
  },
  {
    path: "account",
    canActivate: [authGuard],
    children: [
      {
        path: "",
        title: "Moje konto",
        loadComponent: () =>
          import("./features/account/dashboard/dashboard.component").then(
            (m) => m.DashboardComponent,
          ),
        pathMatch: "full",
      },
      {
        path: "orders",
        title: "Moje zamówienia",
        loadComponent: () =>
          import("./features/account/orders/order-list.component").then(
            (m) => m.OrderListComponent,
          ),
      },
      {
        path: "orders/:id",
        title: "Szczegóły zamówienia",
        loadComponent: () =>
          import("./features/account/orders/order-detail.component").then(
            (m) => m.OrderDetailComponent,
          ),
      },
      {
        path: "profile",
        title: "Mój profil",
        loadComponent: () =>
          import("./features/account/profile/profile.component").then(
            (m) => m.ProfileComponent,
          ),
      },
      {
        path: "addresses",
        title: "Moje adresy",
        loadComponent: () =>
          import("./features/account/addresses/addresses.component").then(
            (m) => m.AddressesComponent,
          ),
      },
    ],
  },
  {
    path: "orders/track",
    title: "Śledzenie zamówienia",
    loadComponent: () =>
      import("./features/orders/track-order/track-order.component").then(
        (m) => m.TrackOrderComponent,
      ),
  },
  {
    path: "wishlist",
    title: "Lista życzeń",
    canActivate: [authGuard],
    loadComponent: () =>
      import("./features/wishlist/wishlist.component").then(
        (m) => m.WishlistComponent,
      ),
  },
  {
    path: "returns",
    title: "Zwrot towaru",
    canActivate: [authGuard],
    loadComponent: () =>
      import("./features/returns/return-request/return-request.component").then(
        (m) => m.ReturnRequestComponent,
      ),
  },
  {
    path: "legal/terms",
    title: "Regulamin",
    loadComponent: () =>
      import("./features/legal/terms/terms.component").then(
        (m) => m.TermsComponent,
      ),
  },
  {
    path: "legal/privacy",
    title: "Polityka prywatności",
    loadComponent: () =>
      import("./features/legal/privacy/privacy.component").then(
        (m) => m.PrivacyComponent,
      ),
  },
  {
    path: "legal/withdrawal",
    title: "Prawo do odstąpienia od umowy",
    loadComponent: () =>
      import("./features/legal/withdrawal/withdrawal.component").then(
        (m) => m.WithdrawalComponent,
      ),
  },
  {
    path: "partnership",
    title: "Współpraca",
    loadComponent: () =>
      import("./features/partnership/partnership.component").then(
        (m) => m.PartnershipComponent,
      ),
  },
  {
    path: "**",
    title: "Nie znaleziono strony",
    loadComponent: () =>
      import("./features/not-found/not-found.component").then(
        (m) => m.NotFoundComponent,
      ),
  },
];
