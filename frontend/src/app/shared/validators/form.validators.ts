import { AbstractControl } from '@angular/forms';
import { isValidPhoneNumber } from 'libphonenumber-js';

// Unicode letters + combining marks + space / hyphen / apostrophe.
// The `u` flag enables \p{} property escapes — supported in all modern browsers.
const NAME_RE = /^[\p{L}\p{M}'\- ]+$/u;

// Street: Unicode letters + digits + space and common address punctuation.
// Must contain at least one letter (street name) and at least one digit (house number).
const STREET_CHARS_RE = /^[\p{L}\p{M}0-9 .,\-\/]+$/u;

export function nameValidator(control: AbstractControl): { nameTooShort: true } | { nameInvalid: true } | null {
  const val = (control.value as string)?.trim();
  if (!val) return null;
  if (val.length < 2) return { nameTooShort: true };
  if (!NAME_RE.test(val)) return { nameInvalid: true };
  return null;
}

export function phoneValidator(control: AbstractControl): { invalidPhone: true } | null {
  const val = control.value as string;
  if (!val) return null;
  return isValidPhoneNumber(val) ? null : { invalidPhone: true };
}

export function streetValidator(control: AbstractControl): { streetInvalid: true } | null {
  const val = (control.value as string)?.trim();
  if (!val) return null;
  // Must contain at least one letter (street name) and one digit (house number)
  if (!/\p{L}/u.test(val) || !/\d/.test(val)) return { streetInvalid: true };
  if (!STREET_CHARS_RE.test(val)) return { streetInvalid: true };
  return null;
}
