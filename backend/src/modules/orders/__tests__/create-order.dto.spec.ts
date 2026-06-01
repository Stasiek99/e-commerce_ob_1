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
