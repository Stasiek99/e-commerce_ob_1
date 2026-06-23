import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { TrackOrderComponent } from './track-order.component';
import { environment } from '../../../../environments/environment';

describe('TrackOrderComponent', () => {
  let fixture: ComponentFixture<TrackOrderComponent>;
  let component: TrackOrderComponent;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TrackOrderComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideNoopAnimations()],
    }).compileComponents();

    fixture = TestBed.createComponent(TrackOrderComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  function submitTrackForm(): void {
    component.form.setValue({ email: 'guest@example.com', orderNumber: 'ORD-2026-000001' });
    fixture.detectChanges();
    component.track();
  }

  it('renders the results panel without throwing against the minimal backend response shape', () => {
    submitTrackForm();

    const req = httpMock.expectOne(
      (r) => r.url === `${environment.apiUrl}/orders/track`,
    );
    expect(req.request.method).toBe('GET');

    expect(() =>
      req.flush({ status: 'PAID', trackingNumber: null, carrier: null }),
    ).not.toThrow();

    expect(() => fixture.detectChanges()).not.toThrow();

    const statusEl = fixture.debugElement.query(By.css('.status'));
    expect(statusEl.nativeElement.textContent).toContain('Opłacone');
  });

  it('renders a tracking link when trackingNumber and a known carrier are present', () => {
    submitTrackForm();

    const req = httpMock.expectOne(
      (r) =>
        r.url === `${environment.apiUrl}/orders/track` &&
        r.params.get('email') === 'guest@example.com' &&
        r.params.get('orderNumber') === 'ORD-2026-000001',
    );
    req.flush({ status: 'SHIPPED', trackingNumber: '123456789', carrier: 'INPOST' });
    fixture.detectChanges();

    const link = fixture.debugElement.query(By.css('a.tracking-number'));
    expect(link.nativeElement.getAttribute('href')).toBe(
      'https://inpost.pl/sledzenie-przesylek?number=123456789',
    );
  });

  it('does not render a result panel and shows the not-found message on a 404', () => {
    submitTrackForm();

    const req = httpMock.expectOne(
      (r) => r.url === `${environment.apiUrl}/orders/track`,
    );
    req.flush({ message: 'Order not found' }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();

    expect(component.result()).toBeNull();
    expect(component.notFound()).toBe(true);
    expect(fixture.debugElement.query(By.css('.result'))).toBeNull();
  });

  it.each([
    ['PARTIALLY_REFUNDED', 'Częściowo zwrócone'],
    ['DISPUTE_HOLD', 'Spór płatniczy'],
    ['DISPUTE_LOST_REVIEW', 'Weryfikacja zwrotu'],
  ])('renders the Polish label instead of the raw enum string for %s', (status, label) => {
    submitTrackForm();

    const req = httpMock.expectOne(
      (r) => r.url === `${environment.apiUrl}/orders/track`,
    );
    req.flush({ status, trackingNumber: null, carrier: null });
    fixture.detectChanges();

    const statusEl = fixture.debugElement.query(By.css('.status'));
    expect(statusEl.nativeElement.textContent.trim()).toBe(label);
    expect(statusEl.nativeElement.classList).toContain(`status--${status.toLowerCase()}`);
  });
});
