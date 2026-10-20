// Derivation for the dashboard document wallet.
//
// The wallet is a faithful view over reminders that already exist: the driver's licence (a
// user-level kind) and the active vehicle's registration. Nothing is added to the database,
// no document is uploaded, and no certificate number is invented — an absent value is shown as
// not recorded. Phase expected from the shared `deadlinePhase` helper so the wallet, the
// dashboard reminder card and the reminders screen always agree on what "due soon" means.

import { daysUntilDateOnly, deadlinePhase, parseDateOnly, type DeadlinePhase } from '../reminders/dates';

/** True when the kind is one the wallet knows how to present. */
export type WalletDocKind = 'license' | 'registration';

export type WalletDoc = {
  kind: WalletDocKind;
  /** Wallet title, fixed per kind. */
  title: string;
  /** Vehicle name for the card, or null for the user-level licence. */
  subject: string | null;
  /** Plate to show on the registration card when one is recorded, else null. */
  plate: string | null;
  /** Stored `YYYY-MM-DD`, or null when nothing is recorded yet. */
  dueDate: string | null;
  /** Days from now to the recorded date; null when there is no valid date. */
  daysUntil: number | null;
  phase: DeadlinePhase;
  /** Ready-to-render expiry line; never claims a date that was not recorded. */
  expiryText: string;
};

export type WalletDocInput = {
  kind: string;
  due_date: string | null;
  enabled: number;
  deleted_at: number | null;
};

export type WalletVehicle = {
  name: string | null;
  plate: string | null;
};

/** Most recent qualifying row per kind wins; disabled and deleted rows are ignored. */
function latestByKind(rows: readonly WalletDocInput[]): Map<string, WalletDocInput> {
  const out = new Map<string, WalletDocInput>();
  for (const row of rows) {
    if (row.enabled !== 1 || row.deleted_at != null) continue;
    const previous = out.get(row.kind);
    if (!previous) {
      out.set(row.kind, row);
      continue;
    }
    // Undated rows never displace a dated one; between dated rows the later date wins.
    const prevMs = previous.due_date ? parseDateOnly(previous.due_date) : null;
    const rowMs = row.due_date ? parseDateOnly(row.due_date) : null;
    if (rowMs == null) continue;
    if (prevMs == null || rowMs > prevMs) out.set(row.kind, row);
  }
  return out;
}

// The label is prefixed with the phase so meaning never rests on colour alone.
function describeExpiry(dueDate: string | null, daysUntil: number | null, phase: DeadlinePhase): string {
  if (dueDate == null || daysUntil == null) return 'Not recorded yet';
  if (phase === 'overdue') {
    const n = Math.abs(daysUntil);
    return `Expired ${n} day${n === 1 ? '' : 's'} ago`;
  }
  if (daysUntil === 0) return 'Due today';
  if (daysUntil < 30) return `Due in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`;
  return `Valid until ${dueDate}`;
}

function buildDoc(
  kind: WalletDocKind,
  title: string,
  row: WalletDocInput | undefined,
  subject: string | null,
  plate: string | null,
  nowMs: number,
): WalletDoc {
  // A row can exist with an unparseable date; treated as not recorded rather than trusted.
  const dueDate = row?.due_date && parseDateOnly(row.due_date) != null ? row.due_date : null;
  const daysUntil = dueDate ? daysUntilDateOnly(dueDate, nowMs) : null;
  const phase = deadlinePhase(daysUntil);
  return {
    kind,
    title,
    subject,
    plate: kind === 'registration' ? plate : null,
    dueDate,
    daysUntil,
    phase,
    expiryText: describeExpiry(dueDate, daysUntil, phase),
  };
}

/**
 * Builds the wallet slots in the required order: Driver's licence, then vehicle registration.
 *
 * `nowMs` is injected so the caller controls the clock and so the result is deterministic.
 */
export function buildWalletDocs(
  rows: readonly WalletDocInput[],
  vehicle: WalletVehicle | null,
  nowMs: number,
): WalletDoc[] {
  const byKind = latestByKind(rows);
  return [
    buildDoc('license', "Driver's licence", byKind.get('license'), null, null, nowMs),
    buildDoc(
      'registration',
      'Vehicle registration',
      byKind.get('registration'),
      vehicle?.name ?? null,
      vehicle?.plate ?? null,
      nowMs,
    ),
  ];
}
