/**
 * Surface inventory for the responsive audit.
 *
 * Only routes reachable without a session live here. The guarded ones
 * (/account/*, /wishlist, /returns, /checkout) need a logged-in user and a
 * seeded cart; they are listed in GUARDED below so the gap stays visible
 * rather than silently uncovered.
 *
 * `slug: true` means the path carries a :slug that audit.mjs fills in at run
 * time from the live catalog — hardcoding one would rot the first time the
 * seed changes.
 */
export const ROUTES = [
  { path: '/', name: 'home' },
  { path: '/products', name: 'catalog' },
  { path: '/products?search=zzzzzzz', name: 'catalog-empty' },
  { path: '/category/perfume', name: 'category' },
  { path: '/products/:slug', name: 'product-detail', slug: true },
  { path: '/dobierz-zapach', name: 'finder' },
  { path: '/cart', name: 'cart-empty' },
  { path: '/checkout/auth-choice', name: 'checkout-auth-choice' },
  { path: '/checkout/success', name: 'checkout-success' },
  { path: '/checkout/failure', name: 'checkout-failure' },
  { path: '/auth/login', name: 'login' },
  { path: '/auth/register', name: 'register' },
  { path: '/auth/forgot-password', name: 'forgot-password' },
  { path: '/auth/magic-link', name: 'magic-link' },
  { path: '/orders/track', name: 'track-order' },
  { path: '/legal/terms', name: 'legal-terms' },
  { path: '/legal/privacy', name: 'legal-privacy' },
  { path: '/legal/withdrawal', name: 'legal-withdrawal' },
  { path: '/partnership', name: 'partnership' },
  { path: '/nie-ma-takiej-strony', name: 'not-found' },
];

/** Known blind spots — need auth/cart fixtures before they can be audited. */
export const GUARDED = [
  '/checkout',
  '/account',
  '/account/orders',
  '/account/orders/:id',
  '/account/profile',
  '/account/addresses',
  '/wishlist',
  '/returns',
];

export const VIEWPORTS = [
  { name: '360-galaxy', width: 360, height: 740 },
  { name: '390-iphone12', width: 390, height: 844 },
  { name: '430-iphone-max', width: 430, height: 932 },
  { name: '768-tablet', width: 768, height: 1024 },
  { name: '1440-desktop', width: 1440, height: 900 },
];
