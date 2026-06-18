import { ThrottlerOptions } from '@nestjs/throttler';

// Must include a throttler literally named 'default' — every @Throttle({ default: { ttl, limit } })
// decorator in the app (auth, orders, payments, returns, reviews, users) overrides THIS throttler
// by name. ThrottlerGuard only resolves route-level overrides for names present in this array, so
// without an entry named 'default' those decorators silently no-op and only burst/sustained apply.
//
// Kept in its own file (no other imports) so it can be imported by tests without pulling in
// app.module.ts, which eagerly runs ConfigModule.forRoot()'s env validation at import time.
export const THROTTLER_CONFIGS: ThrottlerOptions[] = [
  { name: 'default',     ttl: 60_000, limit: 100 },  // generic baseline per IP; routes tighten via @Throttle({ default: {...} })
  { name: 'burst',       ttl: 1_000,  limit: 5  },  // 5 req/s per IP
  { name: 'sustained',   ttl: 60_000, limit: 60 },  // 60 req/min per IP
  { name: 'coupon-anon', ttl: 60_000, limit: 3  },  // 3 req/min for unauthenticated coupon validation
  { name: 'coupon-auth', ttl: 60_000, limit: 10 },  // 10 req/min for authenticated coupon validation
];
