// Decides whether tracking has really resumed after the app was reopened. A registered background task does NOT
// prove fixes are arriving; the only evidence is a FRESH fix stored after the app was relaunched.

export type RecoveryInput = {
  launchAt: number; // when the app was relaunched (ms)
  lastTsAtLaunch: number | null; // timestamp of the last stored fix at that moment
  currentLastTs: number | null; // timestamp of the last stored fix now
  elapsedMs: number; // time since launch (or since the last restart)
  restartAttempts: number; // restarts already tried
  staleToleranceMs: number;
  verifyTimeoutMs: number;
  maxRestartAttempts: number;
};

export type RecoveryDecision = 'confirmed' | 'wait' | 'restart' | 'failed';

export function decideRecovery(i: RecoveryInput): RecoveryDecision {
  // Fresh = newer than what we had AND produced after the relaunch (a cached pre-launch location does not count).
  const fresh =
    i.currentLastTs !== null &&
    i.currentLastTs >= i.launchAt - i.staleToleranceMs &&
    (i.lastTsAtLaunch === null || i.currentLastTs > i.lastTsAtLaunch);
  if (fresh) return 'confirmed';
  if (i.elapsedMs < i.verifyTimeoutMs) return 'wait';
  return i.restartAttempts < i.maxRestartAttempts ? 'restart' : 'failed';
}
