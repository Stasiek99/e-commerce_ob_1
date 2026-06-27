export type CarrierTrackingStatus = 'IN_TRANSIT' | 'DELIVERED' | 'FAILED' | 'RETURNED';

export interface CarrierTrackingResult {
  status: CarrierTrackingStatus;
  /** Only meaningful when status === 'DELIVERED' — the carrier's own delivery timestamp. */
  deliveredAt?: Date;
  raw?: unknown;
}

/**
 * Shared mock-mode progression used by every mock carrier client: status is purely a
 * function of time elapsed since the label was generated, so a developer can watch a
 * shipment move LABEL_GENERATED -> IN_TRANSIT -> DELIVERED locally within minutes instead
 * of needing a real sandbox account or waiting real-world transit times (see CLAUDE.md's
 * InPost ShipX Mock Mode section).
 */
export function deriveMockTrackingStatus(
  elapsedMs: number,
  inTransitAfterMs: number,
  deliveredAfterMs: number,
): CarrierTrackingStatus | null {
  if (elapsedMs >= deliveredAfterMs) return 'DELIVERED';
  if (elapsedMs >= inTransitAfterMs) return 'IN_TRANSIT';
  return null;
}
