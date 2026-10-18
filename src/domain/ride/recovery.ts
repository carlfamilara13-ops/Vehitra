// Decides whether tracking has really resumed after the app was reopened. A registered background task does NOT
// prove fixes are arriving; the only evidence is a FRESH fix stored after the app was relaunched.

export type RecoveryInput = {
  launchAt: number; // when the app was relaunched (ms)
  lastTsAtLaunch: number | null; // timestamp of the last stored fix at that moment
  currentLastTs: number | null; // timestamp of the last stored fix now
  freshFixCount: number; // distinct fresh fixes observed so far (the caller counts each timestamp once)
  minFreshFixes: number; // how many distinct fresh fixes are needed before recovery is confirmed
  elapsedMs: number; // time since launch (or since the last restart)
  restartAttempts: number; // restarts already tried
  staleToleranceMs: number;
  verifyTimeoutMs: number;
  maxRestartAttempts: number;
};

export type RecoveryDecision = 'confirmed' | 'wait' | 'restart' | 'failed';

// What to do with the background task at launch.
export type ArmAction = 'none' | 'start' | 'restart';

// Registration alone proves nothing: when the ride was interrupted (> 10 s with no fix) the task is re-armed even
// though it still reports as registered, because a registered task is not proof that fixes are arriving.
export function decideArming(i: { registered: boolean; interrupted: boolean }): ArmAction {
  if (!i.registered) return 'start';
  if (i.interrupted) return 'restart';
  return 'none';
}

// Fresh = newer than what we had AND produced after the relaunch (a cached pre-launch location does not count).
// Exported so the supervisor counts only genuinely fresh fixes, using the exact same boundary as the decision.
export function isFreshFix(
  currentLastTs: number | null,
  lastTsAtLaunch: number | null,
  launchAt: number,
  staleToleranceMs: number,
): boolean {
  return (
    currentLastTs !== null &&
    currentLastTs >= launchAt - staleToleranceMs &&
    (lastTsAtLaunch === null || currentLastTs > lastTsAtLaunch)
  );
}

export function decideRecovery(i: RecoveryInput): RecoveryDecision {
  // One fresh fix proves the pipe is open; only several distinct fresh fixes prove delivery is sustained, so an
  // interrupted ride is not called confirmed on a single fix that may be followed by another silence.
  const fresh = isFreshFix(i.currentLastTs, i.lastTsAtLaunch, i.launchAt, i.staleToleranceMs);
  if (fresh && i.freshFixCount >= i.minFreshFixes) return 'confirmed';
  // Still within the window: keep waiting whether or not a fresh fix has shown up yet.
  if (i.elapsedMs < i.verifyTimeoutMs) return 'wait';
  // At the timeout, a stream that delivered fewer than `minFreshFixes` reuses the existing restart/attempt
  // semantics (never reported as confirmed), so no new failure path is introduced.
  return i.restartAttempts < i.maxRestartAttempts ? 'restart' : 'failed';
}
