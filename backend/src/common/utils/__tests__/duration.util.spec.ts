import { parseDurationToSeconds } from '../duration.util';

describe('parseDurationToSeconds', () => {
  it('returns a bare number unchanged', () => {
    expect(parseDurationToSeconds(900)).toBe(900);
  });

  it('parses a bare numeric string as seconds', () => {
    expect(parseDurationToSeconds('900')).toBe(900);
  });

  it('parses minutes ("15m") to seconds', () => {
    expect(parseDurationToSeconds('15m')).toBe(900);
  });

  it('parses hours ("1h") to seconds', () => {
    expect(parseDurationToSeconds('1h')).toBe(3600);
  });

  it('parses days ("7d") to seconds', () => {
    expect(parseDurationToSeconds('7d')).toBe(604800);
  });

  it('parses seconds ("30s") to seconds', () => {
    expect(parseDurationToSeconds('30s')).toBe(30);
  });

  it('is case-insensitive on the unit', () => {
    expect(parseDurationToSeconds('15M')).toBe(900);
  });

  it('tolerates whitespace between amount and unit', () => {
    expect(parseDurationToSeconds('15 m')).toBe(900);
  });

  it('throws on an unrecognized unit', () => {
    expect(() => parseDurationToSeconds('15x')).toThrow('Unknown duration unit');
  });

  it('throws on an unparseable value', () => {
    expect(() => parseDurationToSeconds('not-a-duration')).toThrow('Cannot parse duration');
  });
});
