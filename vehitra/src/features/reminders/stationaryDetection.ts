export const STATIONARY_REMINDER_POLICY = {
  stationaryMs: 5 * 60_000,
  snoozeMs: 15 * 60_000,
  maxFixGapMs: 30_000,
  minimumSamples: 3,
  maxAccuracyM: 25,
  maxSpeedMps: 0.75,
  maxDisplacementM: 8,
} as const;

export type StationaryFix = {
  timestamp: number;
  accuracy: number | null;
  speed: number | null;
  lat: number;
  lon: number;
};

export type PreviousStationaryFix = Pick<StationaryFix, 'lat' | 'lon'> | null;

function distanceM(a: Pick<StationaryFix, 'lat' | 'lon'>, b: Pick<StationaryFix, 'lat' | 'lon'>): number {
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const dLat = lat2 - lat1;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function isReliableStationaryFix(fix: StationaryFix): boolean {
  return Number.isFinite(fix.timestamp) && fix.accuracy != null && fix.accuracy >= 0 &&
    fix.accuracy <= STATIONARY_REMINDER_POLICY.maxAccuracyM &&
    (fix.speed == null || Number.isFinite(fix.speed));
}

export function indicatesMovement(fix: StationaryFix, previous: PreviousStationaryFix): boolean {
  if (fix.speed != null && fix.speed > STATIONARY_REMINDER_POLICY.maxSpeedMps) return true;
  return previous != null && distanceM(previous, fix) > STATIONARY_REMINDER_POLICY.maxDisplacementM;
}

export function shouldSendStationaryReminder(input: {
  now: number;
  stationarySince: number | null;
  sampleCount: number;
  snoozeUntil: number | null;
  alreadyReminded: boolean;
}): boolean {
  return !input.alreadyReminded && input.sampleCount >= STATIONARY_REMINDER_POLICY.minimumSamples &&
    input.stationarySince != null && input.now - input.stationarySince >= STATIONARY_REMINDER_POLICY.stationaryMs &&
    (input.snoozeUntil == null || input.now >= input.snoozeUntil);
}
