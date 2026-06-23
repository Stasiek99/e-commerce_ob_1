import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ResetPasswordComponent } from '../reset-password.component';
import { AuthService } from '../../../../core/services/auth.service';
import { ToastService } from '../../../../core/services/toast.service';

function setup(token: string | undefined = 'valid-token') {
  const mockAuth  = { resetPassword: jest.fn() };
  const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };

  TestBed.configureTestingModule({
    imports: [ResetPasswordComponent],
    providers: [
      provideRouter([]),
      { provide: AuthService,  useValue: mockAuth },
      { provide: ToastService, useValue: mockToast },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParams: token !== undefined ? { token } : {} } } },
    ],
    schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
  });

  TestBed.overrideComponent(ResetPasswordComponent, {
    set: { imports: [], schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA] },
  });

  const fixture = TestBed.createComponent(ResetPasswordComponent);
  const component = fixture.componentInstance;
  fixture.detectChanges();

  return { fixture, component, mockAuth, mockToast };
}

describe('ResetPasswordComponent — token initialization', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('reads the token from the route query params', () => {
    const { component } = setup('valid-token');

    expect(component.token).toBe('valid-token');
  });

  it('defaults to an empty token when the query param is absent', () => {
    const { component } = setup('');

    expect(component.token).toBe('');
  });
});

describe('ResetPasswordComponent — password complexity validation', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('returns null when password has not been touched', () => {
    const { component } = setup();

    expect(component.passwordError()).toBeNull();
  });

  it('returns null when password meets minimum length and complexity', () => {
    const { component } = setup();

    component.form.get('password')!.setValue('Secret123');
    component.form.get('password')!.markAsTouched();

    expect(component.passwordError()).toBeNull();
  });

  it('returns minimum-length message when password is shorter than 8 chars', () => {
    const { component } = setup();

    component.form.get('password')!.setValue('short');
    component.form.get('password')!.markAsTouched();

    expect(component.passwordError()).toBe('Minimum 8 znaków');
  });

  it('returns complexity message when password is 8+ chars but all lowercase with no digit', () => {
    const { component } = setup();

    component.form.get('password')!.setValue('passwordpass');
    component.form.get('password')!.markAsTouched();

    expect(component.passwordError()).toBe('Hasło musi zawierać wielką literę, małą literę i cyfrę');
  });

  it('does not call auth.resetPassword() when password fails the complexity pattern', () => {
    const { component, mockAuth } = setup();

    component.form.setValue({ password: 'passwordpass', confirm: 'passwordpass' });
    component.submit();

    expect(mockAuth.resetPassword).not.toHaveBeenCalled();
  });
});

describe('ResetPasswordComponent — submit error handling scoped to actual token errors', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('calls auth.resetPassword() and sets done=true on success', () => {
    const { component, mockAuth } = setup();
    mockAuth.resetPassword.mockReturnValue(of(undefined));

    component.form.setValue({ password: 'Secret123', confirm: 'Secret123' });
    component.submit();

    expect(mockAuth.resetPassword).toHaveBeenCalledWith('valid-token', 'Secret123');
    expect(component.done).toBe(true);
    expect(component.loading).toBe(false);
  });

  it('clears the token when the backend reports an invalid/expired reset token', () => {
    const { component, mockAuth } = setup();
    mockAuth.resetPassword.mockReturnValue(
      throwError(() => ({ error: { message: 'Invalid or expired reset token' } })),
    );

    component.form.setValue({ password: 'Secret123', confirm: 'Secret123' });
    component.submit();

    expect(component.token).toBe('');
  });

  it('keeps the token when the backend rejects for a non-token reason (e.g. password complexity)', () => {
    const { component, mockAuth, mockToast } = setup();
    mockAuth.resetPassword.mockReturnValue(
      throwError(() => ({
        error: { message: 'Hasło musi zawierać co najmniej jedną wielką literę, małą literę i cyfrę' },
      })),
    );

    component.form.setValue({ password: 'Secret123', confirm: 'Secret123' });
    component.submit();

    expect(component.token).toBe('valid-token');
    expect(mockToast.error).toHaveBeenCalled();
  });
});
