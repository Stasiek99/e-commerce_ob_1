import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RegisterDto } from '../dto/register.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { ChangePasswordDto } from '../../users/dto/change-password.dto';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function passwordErrors(dto: object, field: string) {
  const errors = await validate(dto);
  return errors.filter((e) => e.property === field);
}

async function registerErrors(password: string) {
  const dto = plainToInstance(RegisterDto, {
    email: 'user@example.com',
    password,
  });
  return passwordErrors(dto, 'password');
}

async function resetErrors(password: string) {
  const dto = plainToInstance(ResetPasswordDto, {
    token: 'valid-token',
    password,
  });
  return passwordErrors(dto, 'password');
}

async function changeErrors(newPassword: string) {
  const dto = plainToInstance(ChangePasswordDto, {
    currentPassword: 'OldPass1',
    newPassword,
  });
  return passwordErrors(dto, 'newPassword');
}

// ── RegisterDto — password complexity ─────────────────────────────────────────

describe('RegisterDto — password complexity', () => {
  it('passes for a password with uppercase, lowercase, and digit', async () => {
    const errors = await registerErrors('Secure1Pass');

    expect(errors).toHaveLength(0);
  });

  it('passes for minimum 8-char mixed password', async () => {
    const errors = await registerErrors('Abc12345');

    expect(errors).toHaveLength(0);
  });

  it('fails for lowercase-only password (no uppercase, no digit)', async () => {
    const errors = await registerErrors('alllower');

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for uppercase-only password (no lowercase, no digit)', async () => {
    const errors = await registerErrors('ALLUPPER');

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for digits-only password', async () => {
    const errors = await registerErrors('12345678');

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for password with lowercase and uppercase but no digit', async () => {
    const errors = await registerErrors('NoDigitPass');

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for password with lowercase and digit but no uppercase', async () => {
    const errors = await registerErrors('nouppercase1');

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for password with uppercase and digit but no lowercase', async () => {
    const errors = await registerErrors('NOLOWER1');

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for the string "password" (common weak password)', async () => {
    const errors = await registerErrors('password');

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for "aaaaaaaa" (all lowercase, no digit)', async () => {
    const errors = await registerErrors('aaaaaaaa');

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for "QWERTY12" — uppercase + digit, no lowercase', async () => {
    const errors = await registerErrors('QWERTY12');

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for password shorter than 8 characters', async () => {
    const errors = await registerErrors('Ab1');

    expect(errors.length).toBeGreaterThan(0);
  });
});

// ── ResetPasswordDto — password complexity ────────────────────────────────────

describe('ResetPasswordDto — password complexity', () => {
  it('passes for a mixed password with uppercase, lowercase, and digit', async () => {
    const errors = await resetErrors('NewSecure1');

    expect(errors).toHaveLength(0);
  });

  it('fails for all-lowercase password (common weak reset)', async () => {
    const errors = await resetErrors('newpassword');

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for digits-only password', async () => {
    const errors = await resetErrors('12345678');

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for password with no lowercase letter', async () => {
    const errors = await resetErrors('NOLOWER1');

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for password with no digit', async () => {
    const errors = await resetErrors('NoDigitPass');

    expect(errors.length).toBeGreaterThan(0);
  });
});

// ── ChangePasswordDto — newPassword complexity ────────────────────────────────

describe('ChangePasswordDto — newPassword complexity', () => {
  it('passes for a mixed password with uppercase, lowercase, and digit', async () => {
    const errors = await changeErrors('Changed1Pass');

    expect(errors).toHaveLength(0);
  });

  it('fails for all-lowercase new password', async () => {
    const errors = await changeErrors('weaknewpass');

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for digits-only new password', async () => {
    const errors = await changeErrors('87654321');

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for new password with no digit', async () => {
    const errors = await changeErrors('NoDigitPass');

    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for new password with no uppercase', async () => {
    const errors = await changeErrors('nouppercase1');

    expect(errors.length).toBeGreaterThan(0);
  });
});
