import { CUSTOM_ELEMENTS_SCHEMA, NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Location } from '@angular/common';
import { provideRouter } from '@angular/router';
import { AddressesComponent } from '../addresses.component';
import { ToastService } from '../../../../core/services/toast.service';

const API = '/api';

function setup() {
  const mockToast    = { success: jest.fn(), error: jest.fn(), info: jest.fn() };
  const mockLocation = { back: jest.fn() };

  TestBed.configureTestingModule({
    imports: [AddressesComponent],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ToastService, useValue: mockToast },
      { provide: Location,     useValue: mockLocation },
    ],
    schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA],
  });

  TestBed.overrideComponent(AddressesComponent, {
    set: { imports: [], providers: [], schemas: [NO_ERRORS_SCHEMA, CUSTOM_ELEMENTS_SCHEMA] },
  });

  const fixture = TestBed.createComponent(AddressesComponent);
  const component = fixture.componentInstance;
  const httpMock = TestBed.inject(HttpTestingController);

  fixture.detectChanges();

  // Flush the initial load() GET that ngOnInit fires
  const initReqs = httpMock.match(`${API}/users/me/addresses`);
  initReqs.forEach((r) => r.flush([]));

  return { fixture, component, httpMock, mockToast };
}

describe('AddressesComponent — inline delete confirmation (no window.confirm)', () => {
  afterEach(() => {
    // Flush any remaining open requests before verify so they don't leak between tests
    TestBed.inject(HttpTestingController).match(() => true).forEach((r) => r.flush(null));
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });

  // ── startDeleteConfirm ────────────────────────────────────────────────────

  it('sets confirmingDeleteId to the address id without making an HTTP call', () => {
    const { component, httpMock } = setup();

    component.startDeleteConfirm('addr-1');

    expect(component.confirmingDeleteId()).toBe('addr-1');
    httpMock.expectNone(`${API}/users/me/addresses/addr-1`);
  });

  it('does not call window.confirm when the delete flow is triggered', () => {
    const { component } = setup();
    const confirmSpy = jest.spyOn(window, 'confirm');

    component.startDeleteConfirm('addr-1');

    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  // ── cancelDeleteConfirm ───────────────────────────────────────────────────

  it('clears confirmingDeleteId when cancel is called', () => {
    const { component } = setup();

    component.startDeleteConfirm('addr-1');
    component.cancelDeleteConfirm();

    expect(component.confirmingDeleteId()).toBeNull();
  });

  it('does not make an HTTP call when cancel is called', () => {
    const { component, httpMock } = setup();

    component.startDeleteConfirm('addr-1');
    component.cancelDeleteConfirm();

    httpMock.expectNone(`${API}/users/me/addresses/addr-1`);
  });

  // ── confirmDelete — happy path ────────────────────────────────────────────

  it('sends a DELETE request to the correct URL when confirmed', () => {
    const { component, httpMock } = setup();
    component.addresses.set([{ id: 'addr-1', firstName: 'Jan', lastName: 'K', street: 'x', postalCode: '00-000', city: 'W', phone: '+48111111111', isDefault: false }]);

    component.confirmDelete('addr-1');

    const req = httpMock.expectOne(`${API}/users/me/addresses/addr-1`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('removes the address from the list after a successful delete', () => {
    const { component, httpMock } = setup();
    component.addresses.set([{ id: 'addr-1', firstName: 'Jan', lastName: 'K', street: 'x', postalCode: '00-000', city: 'W', phone: '+48111111111', isDefault: false }]);

    component.confirmDelete('addr-1');
    httpMock.expectOne(`${API}/users/me/addresses/addr-1`).flush(null);

    expect(component.addresses()).toEqual([]);
  });

  it('clears confirmingDeleteId after a successful delete', () => {
    const { component, httpMock } = setup();
    component.addresses.set([{ id: 'addr-1', firstName: 'Jan', lastName: 'K', street: 'x', postalCode: '00-000', city: 'W', phone: '+48111111111', isDefault: false }]);
    component.confirmingDeleteId.set('addr-1');

    component.confirmDelete('addr-1');
    httpMock.expectOne(`${API}/users/me/addresses/addr-1`).flush(null);

    expect(component.confirmingDeleteId()).toBeNull();
  });

  it('shows success toast after a successful delete', () => {
    const { component, httpMock, mockToast } = setup();
    component.addresses.set([{ id: 'addr-1', firstName: 'Jan', lastName: 'K', street: 'x', postalCode: '00-000', city: 'W', phone: '+48111111111', isDefault: false }]);

    component.confirmDelete('addr-1');
    httpMock.expectOne(`${API}/users/me/addresses/addr-1`).flush(null);

    expect(mockToast.success).toHaveBeenCalledWith('Adres usunięty');
  });

  // ── confirmDelete — error path ────────────────────────────────────────────

  it('shows error toast and resets working signal when DELETE fails', () => {
    const { component, httpMock, mockToast } = setup();

    component.confirmDelete('addr-1');
    httpMock.expectOne(`${API}/users/me/addresses/addr-1`).flush('error', { status: 500, statusText: 'Server Error' });

    expect(mockToast.error).toHaveBeenCalledWith('Błąd usuwania adresu');
    expect(component.working()).toBeNull();
  });

  it('does NOT remove the address from the list when DELETE fails', () => {
    const { component, httpMock } = setup();
    const addr = { id: 'addr-1', firstName: 'Jan', lastName: 'K', street: 'x', postalCode: '00-000', city: 'W', phone: '+48111111111', isDefault: false };
    component.addresses.set([addr]);

    component.confirmDelete('addr-1');
    httpMock.expectOne(`${API}/users/me/addresses/addr-1`).flush('error', { status: 500, statusText: 'Server Error' });

    expect(component.addresses()).toHaveLength(1);
  });
});
