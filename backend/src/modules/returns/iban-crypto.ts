import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

// Encrypted format: <24-char iv hex>.<32-char authTag hex>.<ciphertext hex>
// An IBAN never contains dots, so this pattern is unambiguous.

export function encryptIban(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join('.');
}

export function decryptIban(stored: string, keyHex: string): string {
  const parts = stored.split('.');
  // Not encrypted (legacy plaintext row or null guard) — return as-is
  if (parts.length !== 3) return stored;
  const [ivHex, authTagHex, encHex] = parts;
  const key = Buffer.from(keyHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString(
    'utf8',
  );
}
