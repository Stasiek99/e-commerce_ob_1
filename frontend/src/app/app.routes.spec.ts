import { Route, Routes } from '@angular/router';
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

// ---------------------------------------------------------------------------
// WCAG 2.4.2 (Page Titled) — EAA compliance
// Every leaf route must declare a unique title so screen readers announce
// distinct page names on navigation instead of the static "Aromaterie".
// ---------------------------------------------------------------------------

describe('app.routes — WCAG 2.4.2: unique titles on every route', () => {
  function collectLeafRoutes(
    routeList: Routes,
    prefix = '',
  ): { path: string; title: unknown }[] {
    const results: { path: string; title: unknown }[] = [];
    for (const route of routeList) {
      const fullPath = [prefix, route.path].filter(Boolean).join('/');
      if (route.children?.length) {
        results.push(...collectLeafRoutes(route.children, fullPath));
      } else {
        results.push({ path: fullPath, title: route.title });
      }
    }
    return results;
  }

  const leafRoutes = collectLeafRoutes(routes);

  it('every leaf route defines a title property', () => {
    const untitled = leafRoutes.filter((r) => !r.title);
    expect(untitled).toEqual([]);
  });

  it('all route titles are unique', () => {
    const titles = leafRoutes.map((r) => r.title);
    const uniqueTitles = new Set(titles);
    expect(uniqueTitles.size).toBe(titles.length);
  });

  describe('critical routes carry their expected Polish titles', () => {
    function findRoute(path: string): Route | undefined {
      return routes.find((r) => r.path === path);
    }

    it('cart → "Koszyk"', () => {
      expect(findRoute('cart')?.title).toBe('Koszyk');
    });

    it('checkout → "Realizacja zamówienia"', () => {
      expect(findRoute('checkout')?.title).toBe('Realizacja zamówienia');
    });

    it('auth/login → "Logowanie"', () => {
      expect(findRoute('auth/login')?.title).toBe('Logowanie');
    });

    it('legal/privacy → "Polityka prywatności"', () => {
      expect(findRoute('legal/privacy')?.title).toBe('Polityka prywatności');
    });

    it('legal/terms → "Regulamin"', () => {
      expect(findRoute('legal/terms')?.title).toBe('Regulamin');
    });

    it('checkout/success → "Zamówienie złożone"', () => {
      expect(findRoute('checkout/success')?.title).toBe('Zamówienie złożone');
    });
  });
});

