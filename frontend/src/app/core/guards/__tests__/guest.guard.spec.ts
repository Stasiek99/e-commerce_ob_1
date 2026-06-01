import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot } from '@angular/router';
import { guestGuard } from '../guest.guard';
import { AuthService } from '../../services/auth.service';

function runGuard() {
  return TestBed.runInInjectionContext(() =>
    guestGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
  );
}

describe('guestGuard', () => {
  let mockRouter: { createUrlTree: jest.Mock };
  let mockAuth: { isAuthenticated: jest.Mock };

  beforeEach(() => {
    mockRouter = { createUrlTree: jest.fn((cmds) => ({ commands: cmds })) };
    mockAuth   = { isAuthenticated: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: mockRouter },
        { provide: AuthService, useValue: mockAuth },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('returns true when the user is a guest (not authenticated)', () => {
    mockAuth.isAuthenticated.mockReturnValue(false);

    const result = runGuard();

    expect(result).toBe(true);
    expect(mockRouter.createUrlTree).not.toHaveBeenCalled();
  });

  it('redirects authenticated users to /account', () => {
    mockAuth.isAuthenticated.mockReturnValue(true);

    runGuard();

    expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/account']);
  });

  it('does not allow access to the route when user is authenticated', () => {
    mockAuth.isAuthenticated.mockReturnValue(true);

    const result = runGuard();

    expect(result).not.toBe(true);
  });
});
