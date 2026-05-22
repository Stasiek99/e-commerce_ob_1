import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { WithdrawalComponent } from '../withdrawal.component';

function setup() {
  TestBed.configureTestingModule({
    imports: [WithdrawalComponent],
    providers: [provideRouter([])],
  });

  const fixture = TestBed.createComponent(WithdrawalComponent);
  fixture.detectChanges();
  return { fixture };
}

describe('WithdrawalComponent', () => {
  it('renders the online withdrawal CTA button', () => {
    const { fixture } = setup();
    const cta = fixture.debugElement.query(By.css('.cta-box__btn'));
    expect(cta).toBeTruthy();
    expect(cta.nativeElement.textContent.trim()).toBeTruthy();
  });

  it('CTA links to /returns with type=withdrawal query param', () => {
    const { fixture } = setup();
    const cta = fixture.debugElement.query(By.css('.cta-box__btn'));
    expect(cta).toBeTruthy();
    // RouterLink computes the href from the bound [routerLink] + [queryParams].
    const href: string = cta.nativeElement.getAttribute('href') ?? '';
    expect(href).toContain('/returns');
    expect(href).toContain('type=withdrawal');
  });

  it('shows the legal basis reference (Art. 27)', () => {
    const { fixture } = setup();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('14 dni');
  });

  it('displays the withdrawal form template section', () => {
    const { fixture } = setup();
    const template = fixture.debugElement.query(By.css('.form-template'));
    expect(template).toBeTruthy();
  });

  it('displays the hygiene exception note', () => {
    const { fixture } = setup();
    const note = fixture.debugElement.query(By.css('.note'));
    expect(note).toBeTruthy();
    expect(note.nativeElement.textContent).toContain('opakowanie');
  });
});
