import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { RegisterComponent } from '../register.component';
import { AuthService } from '../../../../core/services/auth.service';
import { ToastService } from '../../../../core/services/toast.service';

function setup() {
  const mockAuth  = { register: jest.fn() };
  const mockToast = { success: jest.fn(), error: jest.fn(), info: jest.fn() };

  TestBed.configureTestingModule({
    imports: [RegisterComponent],
    providers: [
      provideRouter([]),
      { provide: AuthService,  useValue: mockAuth },
      { provide: ToastService, useValue: mockToast },
    ],
    schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
  });

  TestBed.overrideComponent(RegisterComponent, {
    set: { imports: [], schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA] },
  });

  const fixture = TestBed.createComponent(RegisterComponent);
  const component = fixture.componentInstance;
  fixture.detectChanges();

  return { fixture, component, mockAuth, mockToast };
}

describe('RegisterComponent — errorMsg inline validation', () => {
  afterEach(() => TestBed.resetTestingModule());

  // ── untouched fields show no errors ──────────────────────────────────────

  it('returns null for email when field has not been touched', () => {
    const { component } = setup();

    expect(component.errorMsg('email')).toBeNull();
  });

  it('returns null for password when field has not been touched', () => {
    const { component } = setup();

    expect(component.errorMsg('password')).toBeNull();
  });

  // ── touched + valid fields show no errors ────────────────────────────────

  it('returns null for email when touched and valid', () => {
    const { component } = setup();

    component.form.get('email')!.setValue('jan@example.com');
    component.form.get('email')!.markAsTouched();

    expect(component.errorMsg('email')).toBeNull();
  });

  it('returns null for password when touched and meets minimum length', () => {
    const { component } = setup();

    component.form.get('password')!.setValue('secret12');
    component.form.get('password')!.markAsTouched();

    expect(component.errorMsg('password')).toBeNull();
  });

  // ── touched + invalid email ──────────────────────────────────────────────

  it('returns "To pole jest wymagane" for email when touched and empty', () => {
    const { component } = setup();

    component.form.get('email')!.setValue('');
    component.form.get('email')!.markAsTouched();

    expect(component.errorMsg('email')).toBe('To pole jest wymagane');
  });

  it('returns email format message when touched and value is not a valid email', () => {
    const { component } = setup();

    component.form.get('email')!.setValue('not-an-email');
    component.form.get('email')!.markAsTouched();

    expect(component.errorMsg('email')).toBe('Podaj prawidłowy adres e-mail');
  });

  // ── touched + invalid password ───────────────────────────────────────────

  it('returns "To pole jest wymagane" for password when touched and empty', () => {
    const { component } = setup();

    component.form.get('password')!.setValue('');
    component.form.get('password')!.markAsTouched();

    expect(component.errorMsg('password')).toBe('To pole jest wymagane');
  });

  it('returns minimum-length message when password is touched and shorter than 8 chars', () => {
    const { component } = setup();

    component.form.get('password')!.setValue('short');
    component.form.get('password')!.markAsTouched();

    expect(component.errorMsg('password')).toBe('Minimum 8 znaków');
  });

  // ── submit() marks all fields as touched so errors become visible ────────

  it('marks all fields as touched on submit when form is invalid', () => {
    const { component } = setup();

    component.form.get('email')!.setValue('');
    component.form.get('password')!.setValue('');

    component.submit();

    expect(component.form.get('email')!.touched).toBe(true);
    expect(component.form.get('password')!.touched).toBe(true);
  });

  it('returns error messages for both fields after a failed submit attempt', () => {
    const { component } = setup();

    component.form.get('email')!.setValue('');
    component.form.get('password')!.setValue('');

    component.submit();

    expect(component.errorMsg('email')).toBe('To pole jest wymagane');
    expect(component.errorMsg('password')).toBe('To pole jest wymagane');
  });

  it('does not call auth.register() when form is invalid', () => {
    const { component, mockAuth } = setup();

    component.form.get('email')!.setValue('');
    component.submit();

    expect(mockAuth.register).not.toHaveBeenCalled();
  });

  it('calls auth.register() with correct credentials on valid form submit', () => {
    const { component, mockAuth } = setup();
    mockAuth.register.mockReturnValue(of({}));

    component.form.setValue({ firstName: 'Jan', lastName: 'Kowalski', email: 'jan@example.com', password: 'password123' });
    component.submit();

    expect(mockAuth.register).toHaveBeenCalledWith(
      'jan@example.com',
      'password123',
      'Jan',
      'Kowalski',
    );
  });
});

describe('RegisterComponent — field-error role="alert" (WCAG 3.3.1)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders no field-error paragraphs when form is pristine and untouched', () => {
    const { fixture } = setup();

    const errors = fixture.nativeElement.querySelectorAll('.field-error');

    expect(errors.length).toBe(0);
  });

  it('renders email error paragraph with role="alert" when field is touched and empty', () => {
    const { fixture, component } = setup();

    component.form.get('email')!.markAsTouched();
    fixture.detectChanges();

    const emailErrors: NodeListOf<Element> = fixture.nativeElement.querySelectorAll('p.field-error');
    expect(emailErrors.length).toBeGreaterThan(0);
    expect(emailErrors[0].getAttribute('role')).toBe('alert');
  });

  it('renders password error paragraph with role="alert" when field is touched and empty', () => {
    const { fixture, component } = setup();

    component.form.get('password')!.markAsTouched();
    fixture.detectChanges();

    const pwErrors: NodeListOf<Element> = fixture.nativeElement.querySelectorAll('p.field-error');
    expect(pwErrors.length).toBeGreaterThan(0);
    expect(pwErrors[0].getAttribute('role')).toBe('alert');
  });

  it('all field-error paragraphs carry role="alert" after a failed submit attempt', () => {
    const { fixture, component } = setup();

    component.submit();
    fixture.detectChanges();

    const errors: NodeListOf<Element> = fixture.nativeElement.querySelectorAll('p.field-error');
    expect(errors.length).toBeGreaterThan(0);
    errors.forEach((el) => {
      expect(el.getAttribute('role')).toBe('alert');
    });
  });
});
