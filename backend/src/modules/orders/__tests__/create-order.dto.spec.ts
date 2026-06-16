import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CarrierCode } from '@prisma/client';
import { CreateOrderDto } from '../dto/create-order.dto';

const BASE_PLAIN = { carrierCode: CarrierCode.INPOST };

async function getGuestEmailErrors(plain: object) {
  const dto = plainToInstance(CreateOrderDto, plain);
  const errors = await validate(dto);
  return errors.filter((e) => e.property === 'guestEmail');
}

// ── CreateOrderDto — guestEmail validation ───────────────────────────────────
// Guards the fix: guestEmail must be a valid, non-empty email ≤254 chars.
// @IsOptional() ensures authenticated requests (no guestEmail) still pass.

describe('CreateOrderDto — guestEmail validation', () => {
  it('passes when guestEmail is absent (optional — authenticated users omit it)', async () => {
    const errors = await getGuestEmailErrors(BASE_PLAIN);

    expect(errors).toHaveLength(0);
  });

  it('passes when guestEmail is a valid RFC-5321 email address', async () => {
    const errors = await getGuestEmailErrors({ ...BASE_PLAIN, guestEmail: 'guest@example.com' });

    expect(errors).toHaveLength(0);
  });

  it('fails when guestEmail is an empty string (@IsNotEmpty blocks it before @IsEmail)', async () => {
    const errors = await getGuestEmailErrors({ ...BASE_PLAIN, guestEmail: '' });

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails when guestEmail is missing the @ symbol', async () => {
    const errors = await getGuestEmailErrors({ ...BASE_PLAIN, guestEmail: 'not-an-email' });

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails when guestEmail has no domain part after the @', async () => {
    const errors = await getGuestEmailErrors({ ...BASE_PLAIN, guestEmail: 'user@' });

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails when guestEmail exceeds 254 characters (@MaxLength DB safety net)', async () => {
    // Use a short local part so @IsEmail does not reject on local-part length.
    // 1-char local + @ + 249 'b's + .com = 1+1+249+4 = 255 chars — over the 254 limit.
    const longEmail = 'a@' + 'b'.repeat(249) + '.com';
    expect(longEmail.length).toBeGreaterThan(254);
    const errors = await getGuestEmailErrors({ ...BASE_PLAIN, guestEmail: longEmail });

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails when guestEmail is whitespace only (not a valid email)', async () => {
    const errors = await getGuestEmailErrors({ ...BASE_PLAIN, guestEmail: '   ' });

    expect(errors.length).toBeGreaterThan(0);
  });
});

// ── CreateOrderDto — newAddress.country validation (UN 1266 DG gate) ─────────
// Fragrances are classified as UN 1266 flammable liquid. Shipping is blocked
// to destinations outside Poland. @IsIn(['PL']) enforces this at DTO level.

async function getCountryErrors(country: unknown) {
  const dto = plainToInstance(CreateOrderDto, {
    carrierCode: CarrierCode.INPOST,
    newAddress: {
      firstName: 'Jan', lastName: 'Kowalski',
      street: 'ul. Testowa 1', city: 'Warszawa',
      postalCode: '00-001', phone: '+48500000000',
      country,
    },
  });
  const errors = await validate(dto, { skipMissingProperties: false });
  const nestedErrors = errors.find((e) => e.property === 'newAddress');
  return nestedErrors?.children?.filter((e) => e.property === 'country') ?? [];
}

describe('CreateOrderDto — newAddress.country validation', () => {
  it('passes when country is absent (defaults to PL in the service)', async () => {
    const errors = await getCountryErrors(undefined);
    expect(errors).toHaveLength(0);
  });

  it('passes when country is PL', async () => {
    const errors = await getCountryErrors('PL');
    expect(errors).toHaveLength(0);
  });

  it('rejects non-PL country code — DE', async () => {
    const errors = await getCountryErrors('DE');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects non-PL country code — GB', async () => {
    const errors = await getCountryErrors('GB');
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ── CreateOrderDto — nip checksum validation ─────────────────────────────────
// Guards against a syntactically valid (10-digit) but algorithmically wrong
// NIP being snapshotted onto the order and printed on the VAT invoice, which
// would produce a legally defective invoice under Art. 106e ust. 1 pkt 5.

async function getNipErrors(nip: unknown) {
  const dto = plainToInstance(CreateOrderDto, { ...BASE_PLAIN, nip });
  const errors = await validate(dto);
  return errors.filter((e) => e.property === 'nip');
}

describe('CreateOrderDto — nip checksum validation', () => {
  it('passes when nip is absent (field is optional)', async () => {
    const errors = await getNipErrors(undefined);

    expect(errors).toHaveLength(0);
  });

  it('passes for NIP 1234563218 (valid checksum)', async () => {
    const errors = await getNipErrors('1234563218');

    expect(errors).toHaveLength(0);
  });

  it('passes for NIP 5250007738 (valid checksum)', async () => {
    const errors = await getNipErrors('5250007738');

    expect(errors).toHaveLength(0);
  });

  it('fails for NIP 1234567890 — 10 digits but wrong checksum', async () => {
    const errors = await getNipErrors('1234567890');

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for NIP 0000000001 — 10 digits but wrong checksum', async () => {
    const errors = await getNipErrors('0000000001');

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for NIP with non-digit characters before checksum can be evaluated', async () => {
    const errors = await getNipErrors('123456789a');

    expect(errors.length).toBeGreaterThan(0);
  });
});
