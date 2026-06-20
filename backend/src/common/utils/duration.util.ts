// Subset of the `ms` package's grammar actually used by this repo's *_EXPIRES_IN
// env vars (e.g. "15m", "7d", "900"). jsonwebtoken/`ms` aren't direct dependencies
// here, so this avoids relying on a transitive package pnpm doesn't guarantee to hoist.
const UNIT_SECONDS: Record<string, number> = {
  ms: 0.001,
  s: 1,
  sec: 1,
  secs: 1,
  second: 1,
  seconds: 1,
  m: 60,
  min: 60,
  mins: 60,
  minute: 60,
  minutes: 60,
  h: 3600,
  hr: 3600,
  hrs: 3600,
  hour: 3600,
  hours: 3600,
  d: 86400,
  day: 86400,
  days: 86400,
  w: 604800,
  week: 604800,
  weeks: 604800,
};

export function parseDurationToSeconds(value: string | number): number {
  if (typeof value === 'number') return value;

  const match = /^(\d+(?:\.\d+)?)\s*([a-zA-Z]+)?$/.exec(value.trim());
  if (!match) {
    throw new Error(`Cannot parse duration "${value}"`);
  }

  const amount = parseFloat(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();
  const multiplier = UNIT_SECONDS[unit];
  if (multiplier === undefined) {
    throw new Error(`Unknown duration unit "${unit}" in "${value}"`);
  }

  return Math.round(amount * multiplier);
}
