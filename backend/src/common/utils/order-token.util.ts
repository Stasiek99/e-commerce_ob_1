import { createHmac, timingSafeEqual } from 'crypto';

export function generateOrderToken(orderId: string, email: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${orderId}:${email.toLowerCase()}`)
    .digest('hex');
}

export function verifyOrderToken(token: string, orderId: string, email: string, secret: string): boolean {
  try {
    const expected = generateOrderToken(orderId, email, secret);
    const tokenBuf = Buffer.from(token, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (tokenBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(tokenBuf, expectedBuf);
  } catch {
    return false;
  }
}
