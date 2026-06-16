// Polish NIP modulo-11 checksum (Art. 106e ust. 1 pkt 4 Ustawy o VAT).
// Weights apply to digits 1-9; the weighted sum mod 11 must equal digit 10.
const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7];

export function isValidNipChecksum(nip: string): boolean {
  if (!/^\d{10}$/.test(nip)) return false;
  const digits = nip.split('').map(Number);
  const sum = NIP_WEIGHTS.reduce((acc, w, i) => acc + w * digits[i], 0);
  return sum % 11 === digits[9];
}
