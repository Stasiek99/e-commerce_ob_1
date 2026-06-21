/**
 * SSR guard + flow tests for MagicLoginComponent.
 *
 * Invariant: verifyMagicLink() must NOT be called on the server
 * (PLATFORM_ID = 'server'). The token is single-use — an SSR render
 * consuming it would make the genuine browser request fail against the
 * backend's used-token guard.
 */

import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { PLATFORM_ID } from '@angular/core';
import { of, throwError } from 'rxjs';
import { MagicLoginComponent } from '../magic-login.component';
import { AuthService } from '../../../../core/services/auth.service';
import { CartService } from '../../../../core/services/cart.service';
import { ToastService } from '../../../../core/services/toast.service';

function createComponent(
  platformId: string,
  token: string | undefined,
  overrides: {
    verifyMock?: jest.Mock;
    mergeMock?: jest.Mock;
    toastError?: jest.Mock;
    router?: { navigate: jest.Mock; navigateByUrl: jest.Mock };
  } = {},
) {
  const verifyMock = overrides.verifyMock ?? jest.fn().mockReturnValue(of({ accessToken: 'tok' }));
  const mergeMock = overrides.mergeMock ?? jest.fn().mockReturnValue(of({}));
  const toastError = overrides.toastError ?? jest.fn();
  const router = overrides.router ?? { navigate: jest.fn(), navigateByUrl: jest.fn() };

  TestBed.configureTestingModule({
    imports: [MagicLoginComponent],
    providers: [
      { provide: PLATFORM_ID, useValue: platformId },
      { provide: AuthService, useValue: { verifyMagicLink: verifyMock } },
      { provide: CartService, useValue: { mergeWithServer: mergeMock } },
      { provide: ToastService, useValue: { error: toastError, success: jest.fn() } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParams: token ? { token } : {} } } },
      { provide: Router, useValue: router },
    ],
  });

  const fixture = TestBed.createComponent(MagicLoginComponent);
  fixture.detectChanges(); // triggers ngOnInit
  return { fixture, verifyMock, mergeMock, toastError, router };
}

describe('MagicLoginComponent — SSR platform guard', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('does not call verifyMagicLink() on the server platform', () => {
    const { verifyMock } = createComponent('server', 'raw-token');

    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('does not navigate on the server platform', () => {
    const { router } = createComponent('server', 'raw-token');

    expect(router.navigate).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });
});

describe('MagicLoginComponent — missing token', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('redirects to /auth/login without calling verifyMagicLink() when no token query param is present', () => {
    const { verifyMock, router } = createComponent('browser', undefined);

    expect(verifyMock).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
  });
});

describe('MagicLoginComponent — successful verification', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('calls verifyMagicLink() with the token from the query params', () => {
    const { verifyMock } = createComponent('browser', 'raw-token-123');

    expect(verifyMock).toHaveBeenCalledWith('raw-token-123');
  });

  it('merges the anonymous cart with the server cart on success', () => {
    const { mergeMock } = createComponent('browser', 'raw-token-123');

    expect(mergeMock).toHaveBeenCalledWith('');
  });

  it('navigates to / on success', () => {
    const { router } = createComponent('browser', 'raw-token-123');

    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
  });
});

describe('MagicLoginComponent — invalid or expired token', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows an error toast when verifyMagicLink() fails', () => {
    const verifyMock = jest.fn().mockReturnValue(throwError(() => new Error('Invalid or expired magic link')));
    const { toastError } = createComponent('browser', 'expired-token', { verifyMock });

    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('nieprawidłowy'));
  });

  it('redirects to /auth/login when verifyMagicLink() fails', () => {
    const verifyMock = jest.fn().mockReturnValue(throwError(() => new Error('Invalid or expired magic link')));
    const { router } = createComponent('browser', 'expired-token', { verifyMock });

    expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
  });

  it('does not merge the cart when verification fails', () => {
    const verifyMock = jest.fn().mockReturnValue(throwError(() => new Error('Invalid or expired magic link')));
    const mergeMock = jest.fn().mockReturnValue(of({}));
    createComponent('browser', 'expired-token', { verifyMock, mergeMock });

    expect(mergeMock).not.toHaveBeenCalled();
  });
});
