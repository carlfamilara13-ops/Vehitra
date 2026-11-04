import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from './migrate';
import { MIGRATIONS } from './migrations';
import { createNodeSqliteDb, hasNodeSqlite } from './nodeSqliteDb.testutil';
import { createVehicle } from './vehicleStore';
import {
  DEADLINE_KIND_LABELS,
  getDeadline,
  getVehicleRegistration,
  listAllDeadlines,
  listDeadlines,
  parseDeadlineOffsets,
  setDeadlineEnabled,
  softDeleteDeadline,
  upsertDeadline,
  validateDeadlineInput,
} from './deadlineStore';
import { MaintenanceNotFoundError, MaintenanceValidationError } from './maintenanceErrors';
import type { Db } from './types';

const T0 = Date.UTC(2026, 9, 10, 1, 0, 0);

describe('deadline store', { skip: hasNodeSqlite() ? false : 'node:sqlite unavailable' }, () => {
  let db: Db;

  beforeEach(async () => {
    db = createNodeSqliteDb();
    await migrate(db, MIGRATIONS);
    await createVehicle(db, { id: 'v1', vehicle_type: 'motorcycle' }, T0);
  });

  it('creates a vehicle-bound registration with default offsets', async () => {
    const row = await upsertDeadline(
      db,
      { id: 'd1', kind: 'registration', user_vehicle_id: 'v1', due_date: '2027-03-01' },
      T0,
    );
    assert.equal(row.user_vehicle_id, 'v1');
    assert.equal(row.due_date, '2027-03-01');
    assert.deepEqual(parseDeadlineOffsets(row.reminder_offsets), [30, 7, 3, 0]);
    assert.equal(row.enabled, 1);
    assert.equal(row.sync_status, 'pending');
    assert.deepEqual((await getDeadline(db, 'd1'))?.due_date, '2027-03-01');
  });

  it('allows licence and custom deadlines without a vehicle', async () => {
    const lic = await upsertDeadline(
      db,
      { id: 'l1', kind: 'license', due_date: '2027-01-15', reminder_offsets: [7, 0] },
      T0,
    );
    assert.equal(lic.user_vehicle_id, null);
    assert.deepEqual(parseDeadlineOffsets(lic.reminder_offsets), [7, 0]);
    const custom = await upsertDeadline(db, { id: 'c1', kind: 'custom', due_date: '2026-12-25' }, T0);
    assert.equal(custom.user_vehicle_id, null);
  });

  it('rejects a registration/insurance/inspection without a vehicle', async () => {
    for (const kind of ['registration', 'insurance', 'inspection'] as const) {
      assert.ok(
        validateDeadlineInput({ id: 'x', kind, due_date: '2027-01-01' }).length >= 1,
        `${kind} must require a vehicle`,
      );
      await assert.rejects(
        () => upsertDeadline(db, { id: `x-${kind}`, kind, due_date: '2027-01-01' }),
        (e: unknown) => e instanceof MaintenanceValidationError,
      );
    }
    // even the raw database refuses it (trigger), so no code path can bypass the rule
    await assert.rejects(() =>
      db.runAsync(
        `INSERT INTO deadlines (id, kind, due_date, created_at, updated_at, client_updated_at)
         VALUES ('raw', 'registration', '2027-01-01', 1, 1, 1)`,
      ),
    );
  });

  it('validates kind, date, label length and the offset whitelist', () => {
    assert.ok(validateDeadlineInput({ id: 'x', kind: 'bogus' as never, due_date: '2027-01-01' }).length >= 1);
    assert.ok(validateDeadlineInput({ id: 'x', kind: 'custom', due_date: '01/15/2027' }).length === 1);
    assert.ok(
      validateDeadlineInput({ id: 'x', kind: 'custom', due_date: '2027-01-01', label: 'y'.repeat(81) }).length === 1,
    );
    assert.ok(
      validateDeadlineInput({ id: 'x', kind: 'custom', due_date: '2027-01-01', reminder_offsets: [] }).length === 1,
    );
    assert.ok(
      validateDeadlineInput({ id: 'x', kind: 'custom', due_date: '2027-01-01', reminder_offsets: [30, 12] })
        .length === 1,
    );
    assert.deepEqual(
      validateDeadlineInput({ id: 'x', kind: 'custom', due_date: '2027-01-01', reminder_offsets: [30, 0] }),
      [],
    );
    assert.ok(validateDeadlineInput({ id: 'x', kind: 'custom', due_date: '2027-02-30' }).length === 1);
  });

  it('updates an existing reminder without losing its identity', async () => {
    const first = await upsertDeadline(
      db,
      { id: 'd1', kind: 'registration', user_vehicle_id: 'v1', due_date: '2027-03-01' },
      T0,
    );
    const second = await upsertDeadline(
      db,
      { id: 'd1', kind: 'registration', user_vehicle_id: 'v1', due_date: '2027-09-01', label: 'Reinspected' },
      T0 + 1000,
    );
    assert.equal(second.created_at, first.created_at);
    assert.equal(second.due_date, '2027-09-01');
    assert.equal(second.label, 'Reinspected');
    assert.equal((await listDeadlines(db)).length, 1); // still one record
    assert.equal((await getDeadline(db, 'd1'))?.sync_status, 'pending');
  });

  it('pauses with setDeadlineEnabled and soft-deletes to history', async () => {
    await upsertDeadline(db, { id: 'd1', kind: 'license', due_date: '2027-01-15' }, T0);
    assert.equal(await setDeadlineEnabled(db, 'd1', false, T0 + 1), true);
    const disabled = await getDeadline(db, 'd1');
    assert.equal(disabled?.enabled, 0);
    assert.equal(disabled?.due_date, '2027-01-15'); // date untouched
    assert.equal(await setDeadlineEnabled(db, 'd1', false, T0 + 2), true); // idempotent
    assert.equal(await setDeadlineEnabled(db, 'ghost', false), false);

    assert.equal(await softDeleteDeadline(db, 'd1', T0 + 3), true);
    assert.equal(await softDeleteDeadline(db, 'd1', T0 + 4), false);
    assert.equal((await listDeadlines(db)).length, 0); // hidden
    assert.equal((await listAllDeadlines(db)).length, 1); // auditable
    // editing a removed reminder is refused   callers must create a fresh record
    await assert.rejects(
      () =>
        upsertDeadline(
          db,
          { id: 'd1', kind: 'license', due_date: '2028-01-15' },
          T0 + 5,
        ),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );
  });

  it('lists live deadlines soonest first and per vehicle', async () => {
    await upsertDeadline(db, { id: 'd2', kind: 'license', due_date: '2027-06-01' }, T0);
    await upsertDeadline(db, { id: 'd1', kind: 'license', due_date: '2026-12-01' }, T0);
    await upsertDeadline(db, { id: 'd3', kind: 'registration', user_vehicle_id: 'v1', due_date: '2027-03-01' }, T0);
    const live = await listDeadlines(db);
    assert.deepEqual(live.map((d) => d.id), ['d1', 'd3', 'd2']);
    const forVehicle = await listDeadlines(db, { vehicleId: 'v1' });
    assert.deepEqual(forVehicle.map((d) => d.id), ['d3']);
  });

  it('returns the soonest registration for a vehicle', async () => {
    await upsertDeadline(db, { id: 'd2', kind: 'registration', user_vehicle_id: 'v1', due_date: '2027-09-01' }, T0);
    await upsertDeadline(db, { id: 'd1', kind: 'registration', user_vehicle_id: 'v1', due_date: '2027-03-01' }, T0);
    await upsertDeadline(db, { id: 'd3', kind: 'license', due_date: '2026-12-01' }, T0);
    assert.equal((await getVehicleRegistration(db, 'v1'))?.id, 'd1');
    assert.equal(await getVehicleRegistration(db, 'v2'), null);
  });

  it('refuses a deadline pointing at a missing vehicle', async () => {
    await assert.rejects(
      () => upsertDeadline(db, { id: 'd1', kind: 'registration', user_vehicle_id: 'ghost', due_date: '2027-03-01' }),
      (e: unknown) => e instanceof MaintenanceNotFoundError,
    );
  });

  it('parses offset JSON defensively', () => {
    assert.deepEqual(parseDeadlineOffsets('[30,7]'), [30, 7]);
    assert.deepEqual(parseDeadlineOffsets('[30,"x",null]'), [30]);
    assert.deepEqual(parseDeadlineOffsets('not json'), []);
    assert.deepEqual(parseDeadlineOffsets('{"a":1}'), []);
    assert.equal(DEADLINE_KIND_LABELS.registration, 'Registration');
  });
});
