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
