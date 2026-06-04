import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CancelOrderDto } from '../dto/cancel-order.dto';

async function getReasonErrors(plain: object) {
  const dto = plainToInstance(CancelOrderDto, plain);
  const errors = await validate(dto);
  return errors.filter((e) => e.property === 'reason');
}

// ── CancelOrderDto — reason validation ───────────────────────────────────────
// Guards the fix: unbounded reason strings must be rejected before they reach
// the order_events table. @MaxLength(500) is the enforced cap.

describe('CancelOrderDto — reason validation', () => {
  it('passes when reason is absent (optional — most cancellations have no note)', async () => {
    const errors = await getReasonErrors({});

    expect(errors).toHaveLength(0);
  });

  it('passes when reason is a short valid string', async () => {
    const errors = await getReasonErrors({ reason: 'Changed my mind' });

    expect(errors).toHaveLength(0);
  });

  it('passes when reason is exactly 500 characters (boundary)', async () => {
    const errors = await getReasonErrors({ reason: 'a'.repeat(500) });

    expect(errors).toHaveLength(0);
  });

  it('fails when reason exceeds 500 characters', async () => {
    const errors = await getReasonErrors({ reason: 'a'.repeat(501) });

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails when reason is a number (must be a string)', async () => {
    const errors = await getReasonErrors({ reason: 42 });

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails when reason is an object (must be a string)', async () => {
    const errors = await getReasonErrors({ reason: { nested: 'payload' } });

    expect(errors.length).toBeGreaterThan(0);
  });

  it('passes when reason is an empty string (blank note is valid — controller discards it)', async () => {
    const errors = await getReasonErrors({ reason: '' });

    expect(errors).toHaveLength(0);
  });
});
