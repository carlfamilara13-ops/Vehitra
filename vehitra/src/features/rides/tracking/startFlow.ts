// The "Start ride" decision, separated from the screen so it can be tested. Dependencies are injected.
import { evaluatePermissions, type PermissionState } from './permissionPolicy';

export type StartDeps = {
  ensurePermissions: () => Promise<PermissionState>;
  startRide: () => Promise<string>;
};

export type StartOutcome =
  | { status: 'started'; rideId: string; warnings: string[] }
  | { status: 'blocked'; reason: 'foreground' | 'background'; message: string; canAskAgain: boolean }
  | { status: 'error'; message: string };

export async function runStartFlow(deps: StartDeps): Promise<StartOutcome> {
  let verdict;
  try {
    verdict = evaluatePermissions(await deps.ensurePermissions());
  } catch (e) {
    return { status: 'error', message: String(e) };
  }
  if (!verdict.canStart) {
    return { status: 'blocked', reason: verdict.reason, message: verdict.message, canAskAgain: verdict.canAskAgain };
  }
  try {
    const rideId = await deps.startRide();
    return { status: 'started', rideId, warnings: verdict.warnings };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
