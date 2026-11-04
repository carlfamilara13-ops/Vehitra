import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from '../local/migrate';
import { MIGRATIONS } from '../local/migrations';
import { createNodeSqliteDb, hasNodeSqlite } from '../local/nodeSqliteDb.testutil';
import { createVehicle, getVehicle, softDeleteVehicle } from '../local/vehicleStore';
import { upsertDeadline, listAllDeadlines } from '../local/deadlineStore';
import { runSync } from './syncEngine';
import type {
  CatalogModelInfo,
  CloudDeadlineInsert,
  CloudDeadlineRow,
  CloudVehicleInsert,
  CloudVehicleRow,
  SyncRemote,
} from './types';

const T0 = Date.UTC(2026, 9, 18, 4, 0, 0);
const CLOUD_T = '2026-10-18T00:00:00.000Z';

const MODELS: CatalogModelInfo[] = [
  { id: 'm-1', slug: 'honda-tmx-125', vehicleType: 'motorcycle', brandName: 'Honda', modelName: 'TMX 125' },
];

type FakeState = {
  userId: string | null;
  vehicles: CloudVehicleRow[];
  deadlines: CloudDeadlineRow[];
  pushedVehicles: CloudVehicleInsert[];
  pushedDeadlines: CloudDeadlineInsert[];
  vehicleUpsertError: string | null;
};

function fakeRemote(state: FakeState): SyncRemote {
  return {
    getUserId: async () => state.userId,
    listCatalogModels: async () => MODELS,
    listUserVehicles: async () => state.vehicles,
    upsertUserVehicles: async (rows) => {
      if (state.vehicleUpsertError) return state.vehicleUpsertError;
      state.pushedVehicles.push(...rows);
      return null;
    },
    listUserDeadlines: async () => state.deadlines,
    upsertUserDeadlines: async (rows) => {
      state.pushedDeadlines.push(...rows);
      return null;
    },
  };
}

function freshState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    userId: 'user-1',
    vehicles: [],
    deadlines: [],
    pushedVehicles: [],
    pushedDeadlines: [],
    vehicleUpsertError: null,
    ...overrides,
  };
}

const statusOf = async (db: Awaited<ReturnType<typeof createNodeSqliteDb>>, id: string) => {
  const row = await db.getFirstAsync<{ sync_status: string }>(
    'SELECT sync_status FROM vehicles WHERE id = ?',
    id,
  );
  return row?.sync_status;
};

describe('sync engine', { skip: hasNodeSqlite() ? false : 'node:sqlite unavailable' }, () => {
  let db: Awaited<ReturnType<typeof createNodeSqliteDb>>;

  beforeEach(async () => {
    db = createNodeSqliteDb();
    await migrate(db, MIGRATIONS);
    await createVehicle(
      db,
      {
        id: 'v1',
        vehicle_type: 'motorcycle',
        brand: 'Honda',
        model: 'TMX 125',
        nickname: 'Local name',
        model_year: 2024,
        plate: 'ABC-1',
        catalog_model_slug: 'honda-tmx-125',
        catalog_version: 1,
      },
      T0,
    );
  });

  it('refuses to sync without a session and touches nothing', async () => {
    const state = freshState({ userId: null });
    const report = await runSync(db, fakeRemote(state), { now: T0 });

    assert.equal(report.ok, false);
    assert.equal(report.reason, 'signed_out');
    assert.equal(state.pushedVehicles.length, 0);
    assert.equal(await statusOf(db, 'v1'), 'pending');
  });

  it('pushes a pending linked vehicle and its deadline, then marks them synced', async () => {
    await upsertDeadline(
      db,
      { id: 'd1', kind: 'registration', user_vehicle_id: 'v1', due_date: '2026-12-31' },
      T0,
    );
    const state = freshState();

    const report = await runSync(db, fakeRemote(state), { now: T0 });

    assert.equal(report.ok, true);
    assert.equal(report.vehicles.pushed, 1);
    assert.equal(report.deadlines.pushed, 1);
    assert.equal(state.pushedVehicles.length, 1);
    // Local-only columns never leave the device; the model slug resolves to the cloud uuid.
    const v = state.pushedVehicles[0];
    assert.equal(v.model_id, 'm-1');
    assert.equal(v.nickname, 'Local name');
    assert.equal(v.plate, 'ABC-1');
    assert.ok(!('odometer_km' in v));
    assert.equal(state.pushedDeadlines.length, 1);
    assert.deepEqual(state.pushedDeadlines[0].reminder_offsets_days, [30, 7, 3, 0]);

    assert.equal(await statusOf(db, 'v1'), 'synced');
    const d = (await listAllDeadlines(db))[0];
    assert.equal(d.sync_status, 'synced');
  });

  it('pull-creates a vehicle this device has never seen, from its catalog model', async () => {
    const state = freshState({
      vehicles: [
        {
          id: 'v-cloud',
          model_id: 'm-1',
          catalog_version: 1,
          nickname: 'From cloud',
          plate: 'CL-9',
          model_year: 2022,
          client_updated_at: CLOUD_T,
          updated_at: CLOUD_T,
          deleted_at: null,
        },
      ],
    });

    const report = await runSync(db, fakeRemote(state), { now: T0 });

    assert.equal(report.vehicles.pulled, 1);
    // Only the pre-existing v1 pushes   the pulled row ends the run already synced.
    assert.deepEqual(
      state.pushedVehicles.map((r) => r.id),
      ['v1'],
    );
    const created = await getVehicle(db, 'v-cloud');
    assert.ok(created);
    assert.equal(created.vehicle_type, 'motorcycle');
    assert.equal(created.brand, 'Honda');
    assert.equal(created.model, 'TMX 125');
    assert.equal(created.nickname, 'From cloud');
    assert.equal(created.catalog_model_slug, 'honda-tmx-125');
    assert.equal(created.sync_status, 'synced');
    assert.equal(created.server_updated_at, CLOUD_T);
    // Odometry has no cloud counterpart: pull never invents one.
    assert.equal(created.odometer_km, null);
  });

  it('refuses to mutate local or cloud records when a shared ID differs and no choice was reviewed', async () => {
    const state = freshState({
      vehicles: [{
        id: 'v1', model_id: 'm-1', catalog_version: 1, nickname: 'Remote edit',
        plate: 'REMOTE-1', model_year: 2025, client_updated_at: CLOUD_T,
        updated_at: CLOUD_T, deleted_at: null,
      }],
    });

    const report = await runSync(db, fakeRemote(state), { now: T0 });

    assert.equal(report.ok, false);
    assert.equal(report.reason, 'review_required');
    assert.deepEqual(report.conflicts, [{
      table: 'vehicles', id: 'v1', fields: ['nickname', 'plate', 'model year'],
    }]);
    assert.equal((await getVehicle(db, 'v1'))?.nickname, 'Local name');
    assert.equal(state.pushedVehicles.length, 0);
    assert.equal(await statusOf(db, 'v1'), 'pending');
  });

  it('keeps a locally-newer row, pushes it, and does not let an older cloud row win', async () => {
    // v1 client_updated_at = T0 (newer than this 1999 cloud row).
    const state = freshState({
      vehicles: [
        {
          id: 'v1',
          model_id: 'm-1',
          catalog_version: 1,
          nickname: 'Stale remote name',
          plate: 'OLD-1',
          model_year: 2001,
          client_updated_at: '1999-01-01T00:00:00.000Z',
          updated_at: '1999-01-01T00:00:00.000Z',
          deleted_at: null,
        },
      ],
    });

    const report = await runSync(db, fakeRemote(state), {
      now: T0,
      resolutions: { vehicles: { v1: 'local' } },
    });

    const local = await getVehicle(db, 'v1');
    assert.equal(local?.nickname, 'Local name');
    assert.equal(report.vehicles.pulled, 0);
    assert.equal(report.vehicles.pushed, 1);
    assert.equal(state.pushedVehicles[0].nickname, 'Local name');
  });

  it('adopts a server-newer row exactly once and does not push it back', async () => {
    const state = freshState({
      vehicles: [
        {
          id: 'v1',
          model_id: 'm-1',
          catalog_version: 1,
          nickname: 'Renamed elsewhere',
          plate: 'NEW-1',
          model_year: 2025,
          client_updated_at: '2030-01-01T00:00:00.000Z',
          updated_at: '2030-01-01T00:00:00.000Z',
          deleted_at: null,
        },
      ],
    });

    const report = await runSync(db, fakeRemote(state), {
      now: T0,
      resolutions: { vehicles: { v1: 'account' } },
    });

    const local = await getVehicle(db, 'v1');
    assert.equal(local?.nickname, 'Renamed elsewhere');
    assert.equal(local?.plate, 'NEW-1');
    assert.equal(local?.model_year, 2025);
    assert.equal(local?.sync_status, 'synced');
    assert.equal(report.vehicles.pulled, 1);
    assert.equal(report.vehicles.pushed, 0);

    // A second run changes nothing: server time is now the row's edit time.
    const again = await runSync(db, fakeRemote(state), { now: T0 + 60_000 });
    assert.equal(again.vehicles.pulled, 0);
    assert.equal(again.vehicles.pushed, 0);
  });

  it('reports rows it cannot honestly sync instead of dropping or guessing them', async () => {
    // A hand-entered vehicle has no catalog link, so the cloud FK could never be satisfied.
    await createVehicle(db, { id: 'v-plain', vehicle_type: 'motorcycle' }, T0);
    // A reminder bound to a vehicle only this device knows about.
    await upsertDeadline(
      db,
      { id: 'd-bound', kind: 'registration', user_vehicle_id: 'v-plain', due_date: '2026-12-01' },
      T0,
    );
    // A cloud reminder bound to a vehicle that exists nowhere locally.
    const state = freshState({
      deadlines: [
        {
          id: 'd-cloud',
          user_vehicle_id: 'v-elsewhere',
          kind: 'insurance',
          label: null,
          due_date: '2027-01-15',
          reminder_offsets_days: [7, 0],
          client_updated_at: CLOUD_T,
          updated_at: CLOUD_T,
          deleted_at: null,
        },
      ],
    });

    const report = await runSync(db, fakeRemote(state), { now: T0 });

    const skip = (table: string, reason: string) =>
      report.skipped.some((s) => s.table === table && s.reason === reason);
    assert.ok(skip('vehicles', 'no catalog link'), 'unlinked vehicle reported');
    assert.ok(skip('deadlines', 'vehicle not in cloud'), 'unpushable deadline reported');
    assert.ok(skip('deadlines', 'vehicle missing locally'), 'unpullable deadline reported');
    // The linked v1 still pushes; the unlinked v-plain is the only vehicle skipped.
    assert.deepEqual(
      state.pushedVehicles.map((r) => r.id),
      ['v1'],
    );
    assert.equal(report.deadlines.pushed, 0);
    // Rows stay pending for a future, successful sync   nothing is discarded.
    assert.equal(await statusOf(db, 'v-plain'), 'pending');
  });

  it('pushes a soft delete as a tombstone', async () => {
    await softDeleteVehicle(db, 'v1', T0);
    const state = freshState();

    const report = await runSync(db, fakeRemote(state), { now: T0 });

    assert.equal(report.vehicles.pushed, 1);
    assert.equal(state.pushedVehicles[0].deleted_at, new Date(T0).toISOString());
    assert.equal(await statusOf(db, 'v1'), 'synced');
  });

  it('pull-applies a server tombstone as a local soft delete', async () => {
    const state = freshState({
      vehicles: [
        {
          id: 'v1',
          model_id: 'm-1',
          catalog_version: 1,
          nickname: null,
          plate: null,
          model_year: null,
          client_updated_at: '2030-01-01T00:00:00.000Z',
          updated_at: '2030-01-01T00:00:00.000Z',
          deleted_at: '2030-01-01T00:00:00.000Z',
        },
      ],
    });

    const report = await runSync(db, fakeRemote(state), {
      now: T0,
      resolutions: { vehicles: { v1: 'account' } },
    });

    assert.equal(report.vehicles.pulled, 1);
    const local = await getVehicle(db, 'v1');
    assert.equal(local, null); // getVehicle hides deleted rows...
    const raw = await db.getFirstAsync<{ deleted_at: number | null; sync_status: string }>(
      'SELECT deleted_at, sync_status FROM vehicles WHERE id = ?',
      'v1',
    );
    assert.ok(raw);
    assert.ok(raw.deleted_at != null);
    assert.equal(raw.sync_status, 'synced');
    assert.equal(state.pushedVehicles.length, 0);
  });

  it('keeps pending rows pending when the remote call fails, then retries cleanly', async () => {
    const state = freshState({ vehicleUpsertError: 'boom' });

    const failed = await runSync(db, fakeRemote(state), { now: T0 });
    assert.equal(failed.ok, false);
    assert.equal(failed.reason, 'remote_error');
    assert.equal(await statusOf(db, 'v1'), 'pending');

    state.vehicleUpsertError = null;
    const retried = await runSync(db, fakeRemote(state), { now: T0 + 60_000 });
    assert.equal(retried.ok, true);
    assert.equal(retried.vehicles.pushed, 1);
    assert.equal(await statusOf(db, 'v1'), 'synced');
  });
});
