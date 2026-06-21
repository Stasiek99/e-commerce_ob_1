import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateVariantDto, UpdateVariantDto } from '../dto/product.dto';

// FIX: AdminJS edits ProductVariant directly with no cross-field check, so a
// compareAtPriceInCents that doesn't actually exceed priceInCents (swapped values,
// or stale after a later price hike) must be rejected at the DTO layer for the
// documented create/update endpoints.

async function compareAtPriceErrors(dto: object) {
  const errors = await validate(dto as object);
  return errors.filter((e) => e.property === 'compareAtPriceInCents');
}

describe('CreateVariantDto — compareAtPriceInCents vs priceInCents', () => {
  const base = { sku: 'SKU-1', label: '100ml', priceInCents: 15000 };

  it('fails when compareAtPriceInCents is below priceInCents', async () => {
    const dto = plainToInstance(CreateVariantDto, { ...base, compareAtPriceInCents: 12000 });

    const errors = await compareAtPriceErrors(dto);

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails when compareAtPriceInCents equals priceInCents', async () => {
    const dto = plainToInstance(CreateVariantDto, { ...base, compareAtPriceInCents: 15000 });

    const errors = await compareAtPriceErrors(dto);

    expect(errors.length).toBeGreaterThan(0);
  });

  it('passes when compareAtPriceInCents exceeds priceInCents', async () => {
    const dto = plainToInstance(CreateVariantDto, { ...base, compareAtPriceInCents: 18000 });

    const errors = await compareAtPriceErrors(dto);

    expect(errors).toHaveLength(0);
  });

  it('passes when compareAtPriceInCents is omitted', async () => {
    const dto = plainToInstance(CreateVariantDto, { ...base });

    const errors = await compareAtPriceErrors(dto);

    expect(errors).toHaveLength(0);
  });
});

describe('UpdateVariantDto — compareAtPriceInCents vs priceInCents', () => {
  it('fails when both fields are present and compareAtPriceInCents does not exceed priceInCents', async () => {
    const dto = plainToInstance(UpdateVariantDto, { priceInCents: 15000, compareAtPriceInCents: 15000 });

    const errors = await compareAtPriceErrors(dto);

    expect(errors.length).toBeGreaterThan(0);
  });

  it('passes when both fields are present and compareAtPriceInCents exceeds priceInCents', async () => {
    const dto = plainToInstance(UpdateVariantDto, { priceInCents: 15000, compareAtPriceInCents: 18000 });

    const errors = await compareAtPriceErrors(dto);

    expect(errors).toHaveLength(0);
  });

  it('passes when only compareAtPriceInCents is sent (partial update, no priceInCents in payload to compare against)', async () => {
    const dto = plainToInstance(UpdateVariantDto, { compareAtPriceInCents: 12000 });

    const errors = await compareAtPriceErrors(dto);

    expect(errors).toHaveLength(0);
  });

  it('passes when only priceInCents is sent', async () => {
    const dto = plainToInstance(UpdateVariantDto, { priceInCents: 9900 });

    const errors = await compareAtPriceErrors(dto);

    expect(errors).toHaveLength(0);
  });
});
