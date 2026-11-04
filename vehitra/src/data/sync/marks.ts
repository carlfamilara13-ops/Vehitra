import { serialize } from '../local/serialize';
import type { Db } from '../local/types';

// Sync bookkeeping writes. These live in the sync module (not the stores) because they only
// flip sync columns   data changes themselves always go through the stores' validated paths.

export type SyncTable = 'vehicles' | 'deadlines';

// Push confirmed for a batch: flip to synced without touching data. We do not read back the
// server's updated_at in v1, so server_updated_at stays whatever the last pull recorded.
export function markPushedSynced(
  db: Db,
  table: SyncTable,
  ids: readonly string[],
  now = Date.now(),
): Promise<void> {
  if (ids.length === 0) return Promise.resolve();
  return serialize(async () => {
    for (const id of ids) {
      await db.runAsync(
        `UPDATE ${table} SET sync_status = 'synced', updated_at = ?, client_updated_at = ? WHERE id = ?`,
        now,
        now,
        id,
      );
    }
  });
}

// Pull applied to a row that exists locally: record the server timestamp and adopt it as this
// row's edit time, so the next last-write-wins comparison treats server state as already
// applied (no re-apply loop) while any later local edit is newer and pushes again.
export function markPulledSynced(
  db: Db,
  table: SyncTable,
  id: string,
  serverIso: string,
  clientMs: number,
  now = Date.now(),
): Promise<void> {
  return serialize(async () => {
    await db.runAsync(
      `UPDATE ${table}
          SET sync_status = 'synced', server_updated_at = ?, client_updated_at = ?, updated_at = ?
        WHERE id = ?`,
      serverIso,
      clientMs,
      now,
      id,
    );
  });
}

// Pull brought a deletion-state change (tombstone from the server, or a restore). Applied as
// server truth: no validation (the server already enforced its constraints) and no pending
// round-trip   the row ends synced with the server's timestamp.
export function applyPulledDeletion(
  db: Db,
  table: SyncTable,
  id: string,
  deletedAtMs: number | null,
  serverIso: string,
  clientMs: number,
  now = Date.now(),
): Promise<void> {
  return serialize(async () => {
    await db.runAsync(
      `UPDATE ${table}
          SET deleted_at = ?, sync_status = 'synced', server_updated_at = ?,
              client_updated_at = ?, updated_at = ?
        WHERE id = ?`,
      deletedAtMs,
      serverIso,
      clientMs,
      now,
      id,
    );
  });
}
