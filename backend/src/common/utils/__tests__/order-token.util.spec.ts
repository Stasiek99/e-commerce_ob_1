import { generateOrderToken, verifyOrderToken } from '../order-token.util';

const ORDER_ID = 'a1b2c3d4-0000-0000-0000-000000000001';
const EMAIL = 'guest@example.com';
const SECRET = 'test-secret-at-least-32-chars-long!!';

describe('generateOrderToken', () => {
  it('returns a 64-char hex string', () => {
    const token = generateOrderToken(ORDER_ID, EMAIL, SECRET);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — same inputs always produce the same token', () => {
    const t1 = generateOrderToken(ORDER_ID, EMAIL, SECRET);
    const t2 = generateOrderToken(ORDER_ID, EMAIL, SECRET);
    expect(t1).toBe(t2);
  });

  it('normalises email to lowercase before hashing', () => {
    const lower = generateOrderToken(ORDER_ID, 'Guest@Example.COM', SECRET);
    const upper = generateOrderToken(ORDER_ID, 'GUEST@EXAMPLE.COM', SECRET);
    const mixed = generateOrderToken(ORDER_ID, 'guest@example.com', SECRET);
    expect(lower).toBe(mixed);
    expect(upper).toBe(mixed);
  });

  it('produces a different token when orderId changes', () => {
    const t1 = generateOrderToken(ORDER_ID, EMAIL, SECRET);
    const t2 = generateOrderToken('different-order-id', EMAIL, SECRET);
    expect(t1).not.toBe(t2);
  });

  it('produces a different token when email changes', () => {
    const t1 = generateOrderToken(ORDER_ID, EMAIL, SECRET);
    const t2 = generateOrderToken(ORDER_ID, 'other@example.com', SECRET);
    expect(t1).not.toBe(t2);
  });

  it('produces a different token when secret changes', () => {
    const t1 = generateOrderToken(ORDER_ID, EMAIL, SECRET);
    const t2 = generateOrderToken(ORDER_ID, EMAIL, 'different-secret');
    expect(t1).not.toBe(t2);
  });
});

describe('verifyOrderToken', () => {
  let validToken: string;

  beforeEach(() => {
    validToken = generateOrderToken(ORDER_ID, EMAIL, SECRET);
  });

  it('returns true for a token generated with the same inputs', () => {
    expect(verifyOrderToken(validToken, ORDER_ID, EMAIL, SECRET)).toBe(true);
  });

  it('returns true when email casing differs (case-insensitive match)', () => {
    expect(verifyOrderToken(validToken, ORDER_ID, 'GUEST@EXAMPLE.COM', SECRET)).toBe(true);
  });

  it('returns false when the token is tampered (single char changed)', () => {
    const tampered = validToken.slice(0, -1) + (validToken.endsWith('a') ? 'b' : 'a');
    expect(verifyOrderToken(tampered, ORDER_ID, EMAIL, SECRET)).toBe(false);
  });

  it('returns false when the orderId does not match the token', () => {
    expect(verifyOrderToken(validToken, 'wrong-order-id', EMAIL, SECRET)).toBe(false);
  });

  it('returns false when the email does not match the token', () => {
    expect(verifyOrderToken(validToken, ORDER_ID, 'wrong@example.com', SECRET)).toBe(false);
  });

  it('returns false when the secret does not match the token', () => {
    expect(verifyOrderToken(validToken, ORDER_ID, EMAIL, 'wrong-secret')).toBe(false);
  });

  it('returns false for an empty token string (no throw)', () => {
    expect(verifyOrderToken('', ORDER_ID, EMAIL, SECRET)).toBe(false);
  });

  it('returns false for a token of wrong length (no throw)', () => {
    expect(verifyOrderToken('deadbeef', ORDER_ID, EMAIL, SECRET)).toBe(false);
  });

  it('returns false for a non-hex token string (no throw)', () => {
    expect(verifyOrderToken('not-valid-hex!@#$%^&*()'.repeat(4), ORDER_ID, EMAIL, SECRET)).toBe(false);
  });

  it('returns false for a token that is all-zeros (structurally valid hex but wrong value)', () => {
    const allZeros = '0'.repeat(64);
    expect(verifyOrderToken(allZeros, ORDER_ID, EMAIL, SECRET)).toBe(false);
  });
});
