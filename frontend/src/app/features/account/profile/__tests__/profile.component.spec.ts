import { TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { Location } from '@angular/common';
import { ProfileComponent } from '../profile.component';
import { AuthService } from '../../../../core/services/auth.service';
import { ToastService } from '../../../../core/services/toast.service';

// jsdom does not implement URL.createObjectURL/revokeObjectURL — stub them so
// exportData()'s blob-download path can run under test.
URL.createObjectURL = jest.fn(() => 'blob:mock-url');
URL.revokeObjectURL = jest.fn();

function setup() {
  const mockUser = {
    id: 'user-1',
    email: 'jan@example.com',
    firstName: 'Jan',
    lastName: 'Kowalski',
    phone: null,
    nip: null,
    role: 'CUSTOMER',
    isEmailVerified: true,
  };

  const authService = {
    currentUser: jest.fn().mockReturnValue(mockUser),
    updateCurrentUser: jest.fn(),
    clearSession: jest.fn(),
  };

  const toastService = { success: jest.fn(), error: jest.fn() };
  const router = { navigate: jest.fn() };
  const location = { back: jest.fn() };

  TestBed.configureTestingModule({
    imports: [ProfileComponent, ReactiveFormsModule],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: authService },
      { provide: ToastService, useValue: toastService },
      { provide: Router, useValue: router },
      { provide: Location, useValue: location },
    ],
    schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
  });

  // Strip Taiga UI imports so template compiles without full Taiga setup.
  // schemas must be set on the component override, not just in configureTestingModule,
  // because standalone component templates are validated against the component's own schemas.
  TestBed.overrideComponent(ProfileComponent, {
    set: { imports: [ReactiveFormsModule], schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA] },
  });

  const fixture = TestBed.createComponent(ProfileComponent);
  const component = fixture.componentInstance;
  const httpMock = TestBed.inject(HttpTestingController);

  return { component, fixture, httpMock, authService, toastService, router, location };
}

describe('ProfileComponent — deleteAccount', () => {
  afterEach(() => jest.clearAllMocks());

  // ─── Two-step confirm guard ───────────────────────────────────────────────

  describe('startDeleteConfirm / cancelDeleteConfirm', () => {
    it('sets confirmingDelete to true when startDeleteConfirm is called', () => {
      const { component } = setup();
      expect(component.confirmingDelete()).toBe(false);

      component.startDeleteConfirm();

      expect(component.confirmingDelete()).toBe(true);
    });

    it('resets confirmingDelete to false when cancelDeleteConfirm is called', () => {
      const { component } = setup();
      component.startDeleteConfirm();

      component.cancelDeleteConfirm();

      expect(component.confirmingDelete()).toBe(false);
    });
  });

  // ─── deleteAccount() — happy path ─────────────────────────────────────────

  describe('happy path', () => {
    it('sends DELETE /api/users/me', () => {
      const { component, httpMock } = setup();

      component.deleteAccount();

      const req = httpMock.expectOne('/api/users/me');
      expect(req.request.method).toBe('DELETE');
      req.flush(null, { status: 204, statusText: 'No Content' });
      httpMock.verify();
    });

    it('sets deleting to true while the request is in flight', () => {
      const { component, httpMock } = setup();

      component.deleteAccount();
      expect(component.deleting()).toBe(true);

      httpMock.expectOne('/api/users/me').flush(null, { status: 204, statusText: 'No Content' });
      httpMock.verify();
    });

    it('calls auth.clearSession() on success', () => {
      const { component, httpMock, authService } = setup();

      component.deleteAccount();
      httpMock.expectOne('/api/users/me').flush(null, { status: 204, statusText: 'No Content' });

      expect(authService.clearSession).toHaveBeenCalledTimes(1);
    });

    it('navigates to / on success', () => {
      const { component, httpMock, router } = setup();

      component.deleteAccount();
      httpMock.expectOne('/api/users/me').flush(null, { status: 204, statusText: 'No Content' });

      expect(router.navigate).toHaveBeenCalledWith(['/']);
    });

    it('shows a success toast on completion', () => {
      const { component, httpMock, toastService } = setup();

      component.deleteAccount();
      httpMock.expectOne('/api/users/me').flush(null, { status: 204, statusText: 'No Content' });

      expect(toastService.success).toHaveBeenCalledTimes(1);
    });
  });

  // ─── deleteAccount() — error path ─────────────────────────────────────────

  describe('error path', () => {
    it('resets deleting to false when the request fails', () => {
      const { component, httpMock } = setup();

      component.deleteAccount();
      httpMock.expectOne('/api/users/me').flush('Internal Server Error', { status: 500, statusText: 'Server Error' });

      expect(component.deleting()).toBe(false);
    });

    it('shows an error toast when the request fails', () => {
      const { component, httpMock, toastService } = setup();

      component.deleteAccount();
      httpMock.expectOne('/api/users/me').flush('Internal Server Error', { status: 500, statusText: 'Server Error' });

      expect(toastService.error).toHaveBeenCalledTimes(1);
    });

    it('does not call auth.clearSession() when the request fails', () => {
      const { component, httpMock, authService } = setup();

      component.deleteAccount();
      httpMock.expectOne('/api/users/me').flush('Internal Server Error', { status: 500, statusText: 'Server Error' });

      expect(authService.clearSession).not.toHaveBeenCalled();
    });

    it('does not navigate away when the request fails', () => {
      const { component, httpMock, router } = setup();

      component.deleteAccount();
      httpMock.expectOne('/api/users/me').flush('Internal Server Error', { status: 500, statusText: 'Server Error' });

      expect(router.navigate).not.toHaveBeenCalled();
    });
  });
});

describe('ProfileComponent — exportData', () => {
  afterEach(() => jest.clearAllMocks());

  describe('happy path', () => {
    it('sends GET /api/users/me/data-export with a blob response type', () => {
      const { component, httpMock } = setup();

      component.exportData();

      const req = httpMock.expectOne('/api/users/me/data-export');
      expect(req.request.method).toBe('GET');
      expect(req.request.responseType).toBe('blob');
      req.flush(new Blob(['{}'], { type: 'application/json' }));
      httpMock.verify();
    });

    it('sets exporting to true while the request is in flight', () => {
      const { component, httpMock } = setup();

      component.exportData();
      expect(component.exporting()).toBe(true);

      httpMock.expectOne('/api/users/me/data-export').flush(new Blob(['{}'], { type: 'application/json' }));
      httpMock.verify();
    });

    it('resets exporting to false and shows a success toast on completion', () => {
      const { component, httpMock, toastService } = setup();

      component.exportData();
      httpMock.expectOne('/api/users/me/data-export').flush(new Blob(['{}'], { type: 'application/json' }));

      expect(component.exporting()).toBe(false);
      expect(toastService.success).toHaveBeenCalledTimes(1);
    });
  });

  describe('error path', () => {
    it('resets exporting to false and shows an error toast when the request fails', () => {
      const { component, httpMock, toastService } = setup();

      component.exportData();
      httpMock
        .expectOne('/api/users/me/data-export')
        .flush(new Blob(['Internal Server Error']), { status: 500, statusText: 'Server Error' });

      expect(component.exporting()).toBe(false);
      expect(toastService.error).toHaveBeenCalledTimes(1);
    });
  });
});

describe('ProfileComponent — changeEmail', () => {
  afterEach(() => jest.clearAllMocks());

  describe('startEmailChange / cancelEmailChange', () => {
    it('sets changingEmail to true and resets the form when starting', () => {
      const { component } = setup();
      component.emailForm.setValue({ email: 'stale@example.com', currentPassword: 'whatever' });

      component.startEmailChange();

      expect(component.changingEmail()).toBe(true);
      expect(component.emailForm.value).toEqual({ email: '', currentPassword: '' });
    });

    it('resets changingEmail to false when cancelled', () => {
      const { component } = setup();
      component.startEmailChange();

      component.cancelEmailChange();

      expect(component.changingEmail()).toBe(false);
    });
  });

  describe('happy path', () => {
    function fillValidForm(component: ReturnType<typeof setup>['component']) {
      component.startEmailChange();
      component.emailForm.setValue({ email: 'nowy@example.com', currentPassword: 'CurrentPass1' });
    }

    it('sends PATCH /api/users/me/email with the new email and current password', () => {
      const { component, httpMock } = setup();
      fillValidForm(component);

      component.submitEmailChange();

      const req = httpMock.expectOne('/api/users/me/email');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ email: 'nowy@example.com', currentPassword: 'CurrentPass1' });
      req.flush(null, { status: 204, statusText: 'No Content' });
      httpMock.verify();
    });

    it('sets emailLoading to true while the request is in flight', () => {
      const { component, httpMock } = setup();
      fillValidForm(component);

      component.submitEmailChange();
      expect(component.emailLoading()).toBe(true);

      httpMock.expectOne('/api/users/me/email').flush(null, { status: 204, statusText: 'No Content' });
      httpMock.verify();
    });

    it('shows a success toast and closes the form on completion', () => {
      const { component, httpMock, toastService } = setup();
      fillValidForm(component);

      component.submitEmailChange();
      httpMock.expectOne('/api/users/me/email').flush(null, { status: 204, statusText: 'No Content' });

      expect(toastService.success).toHaveBeenCalledTimes(1);
      expect(component.changingEmail()).toBe(false);
    });

    it('does not clear the session on success (access-token-only revoke, session continues)', () => {
      const { component, httpMock, authService } = setup();
      fillValidForm(component);

      component.submitEmailChange();
      httpMock.expectOne('/api/users/me/email').flush(null, { status: 204, statusText: 'No Content' });

      expect(authService.clearSession).not.toHaveBeenCalled();
    });
  });

  describe('error path', () => {
    function fillValidForm(component: ReturnType<typeof setup>['component']) {
      component.startEmailChange();
      component.emailForm.setValue({ email: 'nowy@example.com', currentPassword: 'WrongPass1' });
    }

    it('shows the server error message when the request fails', () => {
      const { component, httpMock, toastService } = setup();
      fillValidForm(component);

      component.submitEmailChange();
      httpMock.expectOne('/api/users/me/email').flush(
        { message: 'Invalid credentials' },
        { status: 401, statusText: 'Unauthorized' },
      );

      expect(toastService.error).toHaveBeenCalledWith('Invalid credentials');
    });

    it('resets emailLoading to false and keeps the form open when the request fails', () => {
      const { component, httpMock } = setup();
      fillValidForm(component);

      component.submitEmailChange();
      httpMock.expectOne('/api/users/me/email').flush(
        { message: 'Invalid credentials' },
        { status: 401, statusText: 'Unauthorized' },
      );

      expect(component.emailLoading()).toBe(false);
      expect(component.changingEmail()).toBe(true);
    });
  });

  describe('validation guard', () => {
    it('does not send a request when the form is invalid', () => {
      const { component, httpMock } = setup();
      component.startEmailChange();
      component.emailForm.setValue({ email: 'not-an-email', currentPassword: '' });

      component.submitEmailChange();

      httpMock.expectNone('/api/users/me/email');
    });
  });
});

describe('ProfileComponent — changePassword', () => {
  afterEach(() => jest.clearAllMocks());

  describe('startPasswordChange / cancelPasswordChange', () => {
    it('sets changingPassword to true when starting', () => {
      const { component } = setup();

      component.startPasswordChange();

      expect(component.changingPassword()).toBe(true);
    });

    it('resets changingPassword to false when cancelled', () => {
      const { component } = setup();
      component.startPasswordChange();

      component.cancelPasswordChange();

      expect(component.changingPassword()).toBe(false);
    });
  });

  describe('passwordForm validation', () => {
    it('marks the form invalid when newPassword and confirmNewPassword differ', () => {
      const { component } = setup();
      component.startPasswordChange();

      component.passwordForm.setValue({
        currentPassword: 'CurrentPass1',
        newPassword: 'NewPassword1',
        confirmNewPassword: 'Different1',
      });

      expect(component.passwordForm.errors).toEqual({ mismatch: true });
      expect(component.passwordForm.invalid).toBe(true);
    });

    it('marks the form invalid when newPassword does not satisfy the complexity pattern', () => {
      const { component } = setup();
      component.startPasswordChange();

      component.passwordForm.setValue({
        currentPassword: 'CurrentPass1',
        newPassword: 'alllowercase1',
        confirmNewPassword: 'alllowercase1',
      });

      expect(component.passwordForm.controls.newPassword.errors?.['pattern']).toBeTruthy();
    });

    it('marks the form valid for matching, complex passwords', () => {
      const { component } = setup();
      component.startPasswordChange();

      component.passwordForm.setValue({
        currentPassword: 'CurrentPass1',
        newPassword: 'NewPassword1',
        confirmNewPassword: 'NewPassword1',
      });

      expect(component.passwordForm.valid).toBe(true);
    });
  });

  describe('happy path', () => {
    function fillValidForm(component: ReturnType<typeof setup>['component']) {
      component.startPasswordChange();
      component.passwordForm.setValue({
        currentPassword: 'CurrentPass1',
        newPassword: 'NewPassword1',
        confirmNewPassword: 'NewPassword1',
      });
    }

    it('sends PATCH /api/users/me/password with current and new password', () => {
      const { component, httpMock } = setup();
      fillValidForm(component);

      component.submitPasswordChange();

      const req = httpMock.expectOne('/api/users/me/password');
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ currentPassword: 'CurrentPass1', newPassword: 'NewPassword1' });
      req.flush(null, { status: 204, statusText: 'No Content' });
      httpMock.verify();
    });

    it('sets passwordLoading to true while the request is in flight', () => {
      const { component, httpMock } = setup();
      fillValidForm(component);

      component.submitPasswordChange();
      expect(component.passwordLoading()).toBe(true);

      httpMock.expectOne('/api/users/me/password').flush(null, { status: 204, statusText: 'No Content' });
      httpMock.verify();
    });

    it('shows a success toast on completion', () => {
      const { component, httpMock, toastService } = setup();
      fillValidForm(component);

      component.submitPasswordChange();
      httpMock.expectOne('/api/users/me/password').flush(null, { status: 204, statusText: 'No Content' });

      expect(toastService.success).toHaveBeenCalledTimes(1);
    });

    it('clears the session on success because the refresh token was also revoked server-side', () => {
      const { component, httpMock, authService } = setup();
      fillValidForm(component);

      component.submitPasswordChange();
      httpMock.expectOne('/api/users/me/password').flush(null, { status: 204, statusText: 'No Content' });

      expect(authService.clearSession).toHaveBeenCalledTimes(1);
    });

    it('navigates to /auth/login on success', () => {
      const { component, httpMock, router } = setup();
      fillValidForm(component);

      component.submitPasswordChange();
      httpMock.expectOne('/api/users/me/password').flush(null, { status: 204, statusText: 'No Content' });

      expect(router.navigate).toHaveBeenCalledWith(['/auth/login']);
    });
  });

  describe('error path', () => {
    function fillValidForm(component: ReturnType<typeof setup>['component']) {
      component.startPasswordChange();
      component.passwordForm.setValue({
        currentPassword: 'WrongPass1',
        newPassword: 'NewPassword1',
        confirmNewPassword: 'NewPassword1',
      });
    }

    it('shows the server error message when the request fails', () => {
      const { component, httpMock, toastService } = setup();
      fillValidForm(component);

      component.submitPasswordChange();
      httpMock.expectOne('/api/users/me/password').flush(
        { message: 'Invalid credentials' },
        { status: 401, statusText: 'Unauthorized' },
      );

      expect(toastService.error).toHaveBeenCalledWith('Invalid credentials');
    });

    it('resets passwordLoading to false when the request fails', () => {
      const { component, httpMock } = setup();
      fillValidForm(component);

      component.submitPasswordChange();
      httpMock.expectOne('/api/users/me/password').flush(
        { message: 'Invalid credentials' },
        { status: 401, statusText: 'Unauthorized' },
      );

      expect(component.passwordLoading()).toBe(false);
    });

    it('does not clear the session when the request fails', () => {
      const { component, httpMock, authService } = setup();
      fillValidForm(component);

      component.submitPasswordChange();
      httpMock.expectOne('/api/users/me/password').flush(
        { message: 'Invalid credentials' },
        { status: 401, statusText: 'Unauthorized' },
      );

      expect(authService.clearSession).not.toHaveBeenCalled();
    });

    it('does not navigate away when the request fails', () => {
      const { component, httpMock, router } = setup();
      fillValidForm(component);

      component.submitPasswordChange();
      httpMock.expectOne('/api/users/me/password').flush(
        { message: 'Invalid credentials' },
        { status: 401, statusText: 'Unauthorized' },
      );

      expect(router.navigate).not.toHaveBeenCalled();
    });
  });

  describe('validation guard', () => {
    it('does not send a request when the form is invalid', () => {
      const { component, httpMock } = setup();
      component.startPasswordChange();
      component.passwordForm.setValue({ currentPassword: '', newPassword: 'short', confirmNewPassword: 'short' });

      component.submitPasswordChange();

      httpMock.expectNone('/api/users/me/password');
    });
  });
});
