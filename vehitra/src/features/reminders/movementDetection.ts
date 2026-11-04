export const MOVEMENT_REMINDER_POLICY = {
  speedThresholdMps: 8 / 3.6,
  sustainedMs: 20_000,
  cooldownMs: 30 * 60_000,
  maxFixGapMs: 20_000,
  maxAccuracyM: 25,
} as const;

export type MovementFix = {
  timestamp: number;
  accuracy: number | null;
  speed: number | null;
};

export type MovementState = {
  movingSince: number | null;
  lastFixAt: number | null;
  lastNoticeAt: number | null;
};

export type MovementDecision = { state: MovementState; shouldNotify: boolean };

export function evaluateMovementFix(
  previous: MovementState,
  fix: MovementFix,
  activeRide: boolean,
): MovementDecision {
  if (activeRide) {
    return { state: { ...previous, movingSince: null, lastFixAt: fix.timestamp }, shouldNotify: false };
  }

  const valid = Number.isFinite(fix.timestamp) &&
    fix.accuracy != null && fix.accuracy >= 0 && fix.accuracy <= MOVEMENT_REMINDER_POLICY.maxAccuracyM &&
    fix.speed != null && Number.isFinite(fix.speed) && fix.speed >= MOVEMENT_REMINDER_POLICY.speedThresholdMps;
  const chronological = previous.lastFixAt == null || fix.timestamp > previous.lastFixAt;
  const continuous = previous.lastFixAt != null && fix.timestamp - previous.lastFixAt <= MOVEMENT_REMINDER_POLICY.maxFixGapMs;
  if (!valid || !chronological) {
    return { state: { ...previous, movingSince: null }, shouldNotify: false };
  }

  const movingSince = previous.movingSince != null && continuous
    ? previous.movingSince
    : fix.timestamp;
  const state = { ...previous, movingSince, lastFixAt: fix.timestamp };
  const cooledDown = previous.lastNoticeAt == null ||
    fix.timestamp - previous.lastNoticeAt >= MOVEMENT_REMINDER_POLICY.cooldownMs;
  const shouldNotify = cooledDown && fix.timestamp - movingSince >= MOVEMENT_REMINDER_POLICY.sustainedMs;
  return {
    state: shouldNotify ? { ...state, movingSince: null, lastNoticeAt: fix.timestamp } : state,
    shouldNotify,
  };
}
