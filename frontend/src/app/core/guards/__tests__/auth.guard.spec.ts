import { TestBed } from "@angular/core/testing";
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
} from "@angular/router";
import { authGuard } from "../auth.guard";
import { AuthService } from "../../services/auth.service";

function runGuard(stateUrl: string) {
  const state = { url: stateUrl } as RouterStateSnapshot;
  return TestBed.runInInjectionContext(() =>
    authGuard({} as ActivatedRouteSnapshot, state),
  );
}

describe("authGuard", () => {
  let mockRouter: { createUrlTree: jest.Mock };
  let mockAuth: { isAuthenticated: jest.Mock };

  beforeEach(() => {
    mockRouter = {
      createUrlTree: jest.fn((cmds, opts) => ({
        commands: cmds,
        extras: opts,
      })),
    };
    mockAuth = { isAuthenticated: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: mockRouter },
        { provide: AuthService, useValue: mockAuth },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it("returns true when the user is authenticated", () => {
    mockAuth.isAuthenticated.mockReturnValue(true);

    const result = runGuard("/account/orders/123");

    expect(result).toBe(true);
    expect(mockRouter.createUrlTree).not.toHaveBeenCalled();
  });

  it("redirects to /auth/login with returnTo when the user is unauthenticated", () => {
    mockAuth.isAuthenticated.mockReturnValue(false);

    runGuard("/account/orders/123");

    expect(mockRouter.createUrlTree).toHaveBeenCalledWith(["/auth/login"], {
      queryParams: { returnTo: "/account/orders/123" },
    });
  });

  it("preserves the full deep-link URL including query string as returnTo", () => {
    mockAuth.isAuthenticated.mockReturnValue(false);

    runGuard("/account/orders?page=2");

    expect(mockRouter.createUrlTree).toHaveBeenCalledWith(["/auth/login"], {
      queryParams: { returnTo: "/account/orders?page=2" },
    });
  });

  it("does not pass returnTo when accessing the root path", () => {
    mockAuth.isAuthenticated.mockReturnValue(false);

    runGuard("/");

    expect(mockRouter.createUrlTree).toHaveBeenCalledWith(["/auth/login"], {
      queryParams: { returnTo: "/" },
    });
  });
});
