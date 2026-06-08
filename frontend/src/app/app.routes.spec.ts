import { routes } from './app.routes';
import { authGuard } from './core/guards/auth.guard';

// Invariant: /wishlist and /returns must carry canActivate: [authGuard].
// Without the guard the router renders the component for unauthenticated users,
// which triggers unhandled 401 errors and ErrorInterceptor refresh-retry loops.

describe('app.routes — auth protection on /wishlist and /returns', () => {
  function findRoute(path: string) {
    return routes.find((r) => r.path === path);
  }

  describe('/wishlist', () => {
    it('route is defined in the route table', () => {
      expect(findRoute('wishlist')).toBeDefined();
    });

    it('has canActivate configured', () => {
      expect(findRoute('wishlist')?.canActivate).toBeDefined();
    });

    it('includes authGuard so unauthenticated users are redirected to login', () => {
      expect(findRoute('wishlist')?.canActivate).toContain(authGuard);
    });
  });

  describe('/returns', () => {
    it('route is defined in the route table', () => {
      expect(findRoute('returns')).toBeDefined();
    });

    it('has canActivate configured', () => {
      expect(findRoute('returns')?.canActivate).toBeDefined();
    });

    it('includes authGuard so unauthenticated users are redirected to login', () => {
      expect(findRoute('returns')?.canActivate).toContain(authGuard);
    });
  });
});
