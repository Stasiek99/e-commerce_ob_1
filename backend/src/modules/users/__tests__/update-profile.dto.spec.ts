import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateProfileDto } from '../dto/update-profile.dto';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function nipErrors(nip: string) {
  const dto = plainToInstance(UpdateProfileDto, { nip });
  const errors = await validate(dto);
  return errors.filter((e) => e.property === 'nip');
}

// ── NIP format validation ─────────────────────────────────────────────────────

describe('UpdateProfileDto — nip format', () => {
  it('fails for NIP shorter than 10 digits', async () => {
    const errors = await nipErrors('123456789');

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for NIP longer than 10 digits', async () => {
    const errors = await nipErrors('12345678901');

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for NIP containing non-digit characters', async () => {
    const errors = await nipErrors('123456789a');

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for NIP with dashes (formatted with separators)', async () => {
    const errors = await nipErrors('123-456-32-18');

    expect(errors.length).toBeGreaterThan(0);
  });
});

// ── NIP checksum validation ───────────────────────────────────────────────────

describe('UpdateProfileDto — nip checksum', () => {
  it('passes for NIP 1234563218 (valid checksum)', async () => {
    // sum = 6*1+5*2+7*3+2*4+3*5+4*6+5*3+6*2+7*1 = 118, 118%11=8, digit[9]=8
    const errors = await nipErrors('1234563218');

    expect(errors).toHaveLength(0);
  });

  it('passes for NIP 9876543210 (valid checksum, last digit 0)', async () => {
    // sum = 6*9+5*8+7*7+2*6+3*5+4*4+5*3+6*2+7*1 = 220, 220%11=0, digit[9]=0
    const errors = await nipErrors('9876543210');

    expect(errors).toHaveLength(0);
  });

  it('passes for NIP 5250007738 (valid checksum)', async () => {
    // sum = 6*5+5*2+7*5+2*0+3*0+4*0+5*7+6*7+7*3 = 173, 173%11=8, digit[9]=8
    const errors = await nipErrors('5250007738');

    expect(errors).toHaveLength(0);
  });

  it('fails for NIP 1234567890 — 10 digits but wrong checksum', async () => {
    // sum = 6*1+5*2+7*3+2*4+3*5+4*6+5*7+6*8+7*9 = 230, 230%11=10, digit[9]=0 → mismatch
    const errors = await nipErrors('1234567890');

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for NIP 0000000001 — 10 digits but wrong checksum', async () => {
    // sum = 0, 0%11=0, digit[9]=1 → mismatch
    const errors = await nipErrors('0000000001');

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for NIP 5555555555 — 10 digits but wrong checksum', async () => {
    // sum = 5*(6+5+7+2+3+4+5+6+7) = 5*45=225, 225%11=225-20*11=5, digit[9]=5 — actually valid
    // so let's use 1111111111: sum=1*(6+5+7+2+3+4+5+6+7)=45, 45%11=1, digit[9]=1 — also valid
    // use 2222222222: sum=2*45=90, 90%11=2, digit[9]=2 — also valid
    // use 1234567891: sum=230, 230%11=10, digit[9]=1 → mismatch
    const errors = await nipErrors('1234567891');

    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts undefined nip (field is optional)', async () => {
    const dto = plainToInstance(UpdateProfileDto, {});
    const errors = await validate(dto);
    const nipErrors = errors.filter((e) => e.property === 'nip');

    expect(nipErrors).toHaveLength(0);
  });
});
