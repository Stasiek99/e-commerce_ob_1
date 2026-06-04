import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TrackOrderComponent } from '../track-order.component';

function setup() {
  TestBed.configureTestingModule({
    imports: [TrackOrderComponent],
    schemas: [CUSTOM_ELEMENTS_SCHEMA],
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });

  const fixture   = TestBed.createComponent(TrackOrderComponent);
  const component = fixture.componentInstance;
  return { fixture, component };
}

describe('TrackOrderComponent — trackingUrl()', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('returns null when carrier is null', () => {
    const { component } = setup();
    expect(component.trackingUrl(null, '123456789')).toBeNull();
  });

  it('returns null when tracking number is null', () => {
    const { component } = setup();
    expect(component.trackingUrl('INPOST', null)).toBeNull();
  });

  it('returns null when both carrier and tracking number are null', () => {
    const { component } = setup();
    expect(component.trackingUrl(null, null)).toBeNull();
  });

  it('returns null for an unknown carrier code', () => {
    const { component } = setup();
    expect(component.trackingUrl('FEDEX', '999999999')).toBeNull();
  });

  it('builds the InPost tracking URL', () => {
    const { component } = setup();
    const url = component.trackingUrl('INPOST', '123456789012');
    expect(url).toBe('https://inpost.pl/sledzenie-przesylek?number=123456789012');
  });

  it('builds the DHL tracking URL', () => {
    const { component } = setup();
    const url = component.trackingUrl('DHL', '1234567890');
    expect(url).toBe('https://www.dhl.com/pl-pl/home/tracking.html?tracking-id=1234567890');
  });

  it('builds the GLS tracking URL', () => {
    const { component } = setup();
    const url = component.trackingUrl('GLS', '987654321');
    expect(url).toBe('https://gls-group.com/track/?match=987654321');
  });

  it('builds the DPD tracking URL', () => {
    const { component } = setup();
    const url = component.trackingUrl('DPD', '00123456789012345678');
    expect(url).toBe('https://tracktrace.dpd.com.pl/parcelDetails?typ=1&p1=00123456789012345678');
  });

  it('builds the DPD_COURIER tracking URL using the same DPD endpoint', () => {
    const { component } = setup();
    const url = component.trackingUrl('DPD_COURIER', '00123456789012345678');
    expect(url).toBe('https://tracktrace.dpd.com.pl/parcelDetails?typ=1&p1=00123456789012345678');
  });

  it('URL-encodes special characters in tracking numbers', () => {
    const { component } = setup();
    const url = component.trackingUrl('INPOST', '123 / 456');
    expect(url).toBe('https://inpost.pl/sledzenie-przesylek?number=123%20%2F%20456');
  });
});
