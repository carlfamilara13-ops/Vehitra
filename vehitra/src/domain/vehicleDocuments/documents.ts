// The two physical registration photos kept per vehicle. This is separate from the
// `registration` wallet reminder in domain/dashboard/wallet.ts: that row stores an expiry date,
// while these records point at the actual OR/CR images.

export const VEHICLE_DOCUMENT_KINDS = ['or', 'cr'] as const;

export type VehicleDocumentKind = (typeof VEHICLE_DOCUMENT_KINDS)[number];

export type VehicleDocumentDefinition = {
  title: string;
  shortLabel: string;
  emptyAction: string;
};

export const VEHICLE_DOCUMENT_DEFINITIONS: Record<VehicleDocumentKind, VehicleDocumentDefinition> = {
  or: {
    title: 'Official Registration',
    shortLabel: 'OR',
    emptyAction: 'Add OR photo',
  },
  cr: {
    title: 'Certificate of Registration',
    shortLabel: 'CR',
    emptyAction: 'Add CR photo',
  },
};

export function isVehicleDocumentKind(value: string): value is VehicleDocumentKind {
  return (VEHICLE_DOCUMENT_KINDS as readonly string[]).includes(value);
}
