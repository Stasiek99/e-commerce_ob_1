/**
 * SSR guard tests for VerifyEmailComponent.
 *
 * Invariant: the single-use verification token must only be consumed by the
 * real browser. Without the isPlatformBrowser guard, the SSR render consumes
 * the token server-side, then hydration's repeat call hits the backend's
 * used-token guard and overwrites the genuine success with an error.
 */

import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { of, throwError } from 'rxjs';
import { VerifyEmailComponent } from '../verify-email.component';
import { AuthService } from '../../../../core/services/auth.service';

function createComponent(platformId: string, queryParams: Record<string, string>, mockAuth: any) {
  TestBed.configureTestingModule({
    imports: [VerifyEmailComponent],
    providers: [
      { provide: PLATFORM_ID, useValue: platformId },
      { provide: AuthService, useValue: mockAuth },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParams } } },
    ],
  });

  const fixture = TestBed.createComponent(VerifyEmailComponent);
  const component = fixture.componentInstance;
  fixture.detectChanges();
  return { fixture, component };
}

describe('VerifyEmailComponent — token-consumption SSR guard', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // ── server platform ────────────────────────────────────────────────────────

  it('does not call auth.verifyEmail() on the server platform', () => {
    const mockAuth = { verifyEmail: jest.fn(), loadCurrentUser: jest.fn() };

    createComponent('server', { token: 'abc123' }, mockAuth);

    expect(mockAuth.verifyEmail).not.toHaveBeenCalled();
  });

  it('leaves state as pending on the server platform, never setting error', () => {
    const mockAuth = { verifyEmail: jest.fn(), loadCurrentUser: jest.fn() };

    const { component } = createComponent('server', { token: 'abc123' }, mockAuth);

    expect(component.state).toBe('pending');
  });

  // ── browser platform ───────────────────────────────────────────────────────

  it('calls auth.verifyEmail() exactly once with the query-param token in the browser', () => {
    const mockAuth = { verifyEmail: jest.fn().mockReturnValue(of({ type: 'email_verification' })), loadCurrentUser: jest.fn() };

    createComponent('browser', { token: 'abc123' }, mockAuth);

    expect(mockAuth.verifyEmail).toHaveBeenCalledTimes(1);
    expect(mockAuth.verifyEmail).toHaveBeenCalledWith('abc123');
  });

  it('sets state to success and refreshes the current user when verification succeeds in the browser', () => {
    const mockAuth = { verifyEmail: jest.fn().mockReturnValue(of({ type: 'email_verification' })), loadCurrentUser: jest.fn() };

    const { component } = createComponent('browser', { token: 'abc123' }, mockAuth);

    expect(component.state).toBe('success');
    expect(mockAuth.loadCurrentUser).toHaveBeenCalledTimes(1);
  });

  it('sets state to error when the backend rejects the token in the browser', () => {
    const mockAuth = {
      verifyEmail: jest.fn().mockReturnValue(throwError(() => new Error('used token'))),
      loadCurrentUser: jest.fn(),
    };

    const { component } = createComponent('browser', { token: 'already-used' }, mockAuth);

    expect(component.state).toBe('error');
  });

  it('sets state to error without calling auth.verifyEmail() when no token is present in the browser', () => {
    const mockAuth = { verifyEmail: jest.fn(), loadCurrentUser: jest.fn() };

    const { component } = createComponent('browser', {}, mockAuth);

    expect(component.state).toBe('error');
    expect(mockAuth.verifyEmail).not.toHaveBeenCalled();
  });
});
