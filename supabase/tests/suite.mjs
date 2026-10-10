// RLS + schema test suite. Every scenario runs inside ONE transaction that is always rolled back,
// so it leaves no data behind (safe against a throwaway local DB and against a DEV Supabase project).
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect } from './db.mjs';

const PERM = /permission denied/i;
const RLS = /row-level security/i;
const FK = /foreign key/i;
const CHECK = /check constraint/i;
const IMMUTABLE = /immutable|not allowed|cannot (be|change)/i;
const UNIQUE = /unique|duplicate key/i;

const ALL_TABLES = [
  'vehicle_types', 'brands', 'assets', 'component_definitions', 'vehicle_models', 'model_versions',
  'model_components', 'user_settings', 'user_vehicles', 'rides', 'mileage_entries', 'service_events',
  'part_installs', 'component_overrides', 'deadlines', 'model_requests',
];
const USER_TABLES = [
  'user_settings', 'user_vehicles', 'rides', 'mileage_entries', 'service_events',
  'part_installs', 'component_overrides', 'deadlines', 'model_requests',
];
const UPDATABLE = ['user_settings', 'user_vehicles', 'rides', 'part_installs', 'component_overrides', 'deadlines'];

export function runSuite(target) {
  describe(`Vehitra schema and RLS (${target})`, () => {
    let db;
    before(async () => { db = await connect(target); });
    after(async () => { if (db) await db.close(); });

    const scenario = (name, fn) => it(name, async () => {
      await db.exec('begin');
      let n = 0;
      const ctx = {
        async run(role, uid, sql, params = []) {
          await db.exec('reset role');
          if (role !== 'postgres') {
            await db.exec(`set local role ${role}`);
            await db.query(
              `select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`,
              [uid ? JSON.stringify({ sub: uid, role }) : '', uid ?? ''],
            );
          }
          return db.query(sql, params);
        },
        async fails(role, uid, sql, params, pattern) {
          const sp = `sp_${++n}`;
          await db.exec(`savepoint ${sp}`);
          let err = null;
          try { await ctx.run(role, uid, sql, params); } catch (e) { err = e; }
          await db.exec(`rollback to savepoint ${sp}`);
          await db.exec('reset role');
          assert.ok(err, `expected this to fail but it succeeded: ${sql}`);
          if (pattern) assert.match(String(err.message), pattern, `wrong error for: ${sql}`);
        },
        sup: (sql, p) => ctx.run('postgres', null, sql, p),
        as: (uid, sql, p) => ctx.run('authenticated', uid, sql, p),
        anon: (sql, p) => ctx.run('anon', null, sql, p),
        asFails: (uid, sql, p, pat) => ctx.fails('authenticated', uid, sql, p, pat),
        async n(uid, sql, p) { return (await ctx.as(uid, sql, p)).rows[0].n; },
      };
      try { await fn(ctx); } finally {
        await db.exec('rollback');
        await db.exec('reset role');
      }
    });

    async function fixture(ctx) {
      const A = randomUUID(), B = randomUUID();
      await ctx.sup('insert into auth.users (id, email) values ($1,$2),($3,$4)',
        [A, `rls-a-${A}@example.test`, B, `rls-b-${B}@example.test`]);
      const model = (await ctx.as(A,
        `select id, current_version from public.vehicle_models where slug = 'yamaha-sniper-155'`)).rows[0];
      assert.ok(model, 'seed missing: yamaha-sniper-155');
      const comp = async (code) =>
        (await ctx.as(A, 'select id from public.component_definitions where code = $1', [code])).rows[0].id;
      const vehA = randomUUID(), vehB = randomUUID();
      await ctx.as(A, `insert into public.user_vehicles (id, model_id, catalog_version, nickname) values ($1,$2,$3,'A bike')`,
        [vehA, model.id, model.current_version]);
      await ctx.as(B, `insert into public.user_vehicles (id, model_id, catalog_version, nickname) values ($1,$2,$3,'B bike')`,
        [vehB, model.id, model.current_version]);
      return { A, B, model, vehA, vehB, comp };
    }

    const insRide = (veh, id = randomUUID()) => [
      `insert into public.rides (id, user_vehicle_id, started_at, ended_at, status, gps_distance_m, polyline)
       values ($1,$2,'2026-10-10T01:00Z','2026-10-10T01:30Z','finished',5230.5,'_p~iF~ps|U')`, [id, veh]];
    const insEntry = (veh, kind, source, applied, odo, extra = '', id = randomUUID()) => [
      `insert into public.mileage_entries (id, user_vehicle_id, kind, source, applied_km, odo_reading_after ${extra ? ', ' + extra.cols : ''})
       values ($1,$2,'${kind}','${source}',${applied},${odo} ${extra ? ', ' + extra.vals : ''})`, [id, veh]];

    // ------------------------------------------------------------------ structure
    scenario('RLS is enabled on every public table, and no role has surprise privileges', async (c) => {
      const off = (await c.sup(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)).rows;
      assert.deepEqual(off, [], 'tables without RLS');
      const anonGrants = (await c.sup(`select count(*)::int as n from information_schema.role_table_grants
        where grantee = 'anon' and table_schema = 'public'`)).rows[0].n;
      assert.equal(anonGrants, 0);
      const deletes = (await c.sup(`select table_name from information_schema.role_table_grants
        where grantee = 'authenticated' and table_schema = 'public' and privilege_type = 'DELETE'
        order by table_name`)).rows.map((r) => r.table_name);
      assert.deepEqual(deletes, ['component_overrides']);
      const points = (await c.sup(`select to_regclass('public.points') as t`)).rows[0].t;
      assert.equal(points, null, 'raw GPS points must not exist in the cloud schema');
    });

    scenario('anonymous users cannot read tables or call functions', async (c) => {
      for (const t of ALL_TABLES) await c.fails('anon', null, `select * from public.${t} limit 1`, [], PERM);
      await c.fails('anon', null, `select public.catalog_begin_version($1)`, [randomUUID()], PERM);
      await c.fails('anon', null,
        `select public.replace_part_install(null,$1,$2,$3,'a','b',now(),1)`, [randomUUID(), randomUUID(), randomUUID()], PERM);
    });

    // ------------------------------------------------------------------ catalog
    scenario('catalog is readable by signed-in users and never writable by them', async (c) => {
      const { A, model } = await fixture(c);
      assert.ok((await c.n(A, 'select count(*)::int as n from public.vehicle_types')) === 7);
      assert.ok((await c.n(A, 'select count(*)::int as n from public.vehicle_models')) >= 21);
      assert.equal((await c.as(A, `select sort_order from public.vehicle_models where slug = 'yamaha-sniper-155'`)).rows[0].sort_order, 1);
      assert.equal(await c.n(A, `select count(*)::int as n from public.vehicle_models where is_generic`), 7);
      await c.asFails(A, `insert into public.brands (slug, name) values ('evil','Evil')`, [], PERM);
      await c.asFails(A, `update public.model_components set interval_km = 1 where model_id = $1`, [model.id], PERM);
      await c.asFails(A, `delete from public.vehicle_models where id = $1`, [model.id], PERM);
      await c.asFails(A, `select public.catalog_begin_version($1)`, [model.id], PERM);
      await c.asFails(A, `select public.catalog_publish_version($1, 1)`, [model.id], PERM);
    });

    scenario('seeded rules are draft; "reviewed" needs a named reviewer', async (c) => {
      await fixture(c);
      if (target === 'local') {
        const n = (await c.sup(`select count(*)::int as n from public.model_components where review_status <> 'draft'`)).rows[0].n;
        assert.equal(n, 0, 'every seeded rule must start as draft');
        const withInterval = (await c.sup(`select distinct d.code from public.model_components mc
          join public.component_definitions d on d.id = mc.component_id where mc.interval_km is not null`)).rows;
        assert.deepEqual(withInterval.map((r) => r.code), ['engine_oil'], 'only spec-provided values may be filled');
      }
      await c.fails('postgres', null,
        `update public.model_components set review_status = 'reviewed' where ctid = (select ctid from public.model_components limit 1)`,
        [], CHECK);
      // marking reviewed is allowed on a published version (no numbers change)
      await c.sup(`update public.model_components set review_status = 'reviewed', reviewed_by = 'Test Mechanic', reviewed_at = now()
        where ctid = (select ctid from public.model_components limit 1)`);
    });

    scenario('published catalog versions are frozen; new versions stay hidden until published; users keep their snapshot', async (c) => {
      const { A, model, vehA } = await fixture(c);
      const oil = `(select id from public.component_definitions where code = 'engine_oil')`;
      await c.asFails(A, `select public.catalog_begin_version($1)`, [model.id], PERM);
      const v = (await c.run('service_role', null, `select public.catalog_begin_version($1) as v`, [model.id])).rows[0].v;
      assert.equal(v, 2);
      // hidden from users while unpublished
      assert.equal(await c.n(A, 'select count(*)::int as n from public.model_versions where model_id = $1', [model.id]), 1);
      assert.equal(await c.n(A, 'select count(*)::int as n from public.model_components where model_id = $1 and version = 2', [model.id]), 0);
      await c.asFails(A, `insert into public.user_vehicles (model_id, catalog_version) values ($1, 2)`, [model.id], /not published/i);
      // unpublished version can be edited
      await c.sup(`update public.model_components set interval_km = 2000 where model_id = $1 and version = 2 and component_id = ${oil}`, [model.id]);
      await c.run('service_role', null, `select public.catalog_publish_version($1, 2)`, [model.id]);
      assert.equal((await c.sup('select current_version from public.vehicle_models where id = $1', [model.id])).rows[0].current_version, 2);
      // existing vehicle still reads the OLD rules
      assert.equal((await c.as(A, 'select catalog_version from public.user_vehicles where id = $1', [vehA])).rows[0].catalog_version, 1);
      const oldRule = (await c.as(A, `select interval_km from public.model_components where model_id = $1 and version = 1 and component_id = ${oil}`, [model.id])).rows[0].interval_km;
      const newRule = (await c.as(A, `select interval_km from public.model_components where model_id = $1 and version = 2 and component_id = ${oil}`, [model.id])).rows[0].interval_km;
      assert.equal(oldRule, 1500);
      assert.equal(newRule, 2000);
      // published versions are frozen
      await c.fails('postgres', null, `update public.model_components set interval_km = 999 where model_id = $1 and version = 1`, [model.id], IMMUTABLE);
      await c.fails('postgres', null, `delete from public.model_components where model_id = $1 and version = 1`, [model.id], IMMUTABLE);
      await c.fails('postgres', null, `delete from public.model_versions where model_id = $1 and version = 1`, [model.id], IMMUTABLE);
      await c.fails('postgres', null, `update public.model_versions set note = 'x' where model_id = $1 and version = 1`, [model.id], IMMUTABLE);
      await c.fails('postgres', null, `delete from public.vehicle_models where id = $1`, [model.id]);
      // user accepts the update explicitly; model cannot be switched
      await c.as(A, 'update public.user_vehicles set catalog_version = 2 where id = $1', [vehA]);
      await c.asFails(A, `update public.user_vehicles set model_id = (select id from public.vehicle_models where slug = 'honda-click-125') where id = $1`, [vehA], /cannot change model/i);
    });

    // ------------------------------------------------------------------ ownership
    scenario('users see and change only their own rows, in every user table', async (c) => {
      const { A, B, vehA, comp, model } = await fixture(c);
      const oil = await comp('engine_oil'), chain = await comp('drive_chain');
      await c.as(A, 'insert into public.user_settings default values');
      await c.as(A, ...insRide(vehA));
      await c.as(A, ...insEntry(vehA, 'initial', 'initial', 0, 81541));
      await c.as(A, `insert into public.service_events (user_vehicle_id, component_id, action, performed_at, odo_at, estimated)
        values ($1,$2,'baseline','2026-10-10T00:00Z',81541,true)`, [vehA, oil]);
      await c.as(A, `insert into public.part_installs (user_vehicle_id, component_id, brand, model, installed_at, install_odo)
        values ($1,$2,'DID','428VX','2026-09-12T00:00Z',81200)`, [vehA, chain]);
      await c.as(A, 'insert into public.component_overrides (user_vehicle_id, component_id, interval_km) values ($1,$2,1200)', [vehA, oil]);
      await c.as(A, `insert into public.deadlines (user_vehicle_id, kind, due_date) values ($1,'registration','2027-01-01')`, [vehA]);
      await c.as(A, `insert into public.model_requests (vehicle_type_code, model_text) values ('motorcycle','Test 150')`);
      for (const t of USER_TABLES) {
        assert.ok(await c.n(A, `select count(*)::int as n from public.${t}`) >= 1, `A should see own rows in ${t}`);
        assert.equal(await c.n(B, `select count(*)::int as n from public.${t} where user_id = $1`, [A]), 0, `B must not see A's rows in ${t}`);
      }
      for (const t of UPDATABLE) {
        const r = await c.as(B, `update public.${t} set client_updated_at = now() where user_id = $1`, [A]);
        assert.equal(r.count, 0, `B must not update A's rows in ${t}`);
      }
      assert.equal((await c.as(B, 'delete from public.component_overrides where user_id = $1', [A])).count, 0);
      // B cannot insert rows owned by A
      await c.asFails(B, 'insert into public.user_vehicles (user_id, model_id, catalog_version) values ($1,$2,$3)', [A, model.id, model.current_version], RLS);
      await c.asFails(B, `insert into public.model_requests (user_id, vehicle_type_code, model_text) values ($1,'car','x')`, [A], RLS);
      await c.asFails(B, `insert into public.user_settings (user_id) values ($1)`, [A], RLS);
    });

    scenario('child rows cannot attach to another user\'s vehicle or ride', async (c) => {
      const { A, B, vehA, comp } = await fixture(c);
      const oil = await comp('engine_oil');
      const rideA = randomUUID();
      await c.as(A, ...insRide(vehA, rideA));
      // B uses his own user_id but A's vehicle -> composite foreign key rejects it
      await c.asFails(B, ...insRide(vehA), FK);
      await c.asFails(B, ...insEntry(vehA, 'initial', 'initial', 0, 100), FK);
      await c.asFails(B, `insert into public.service_events (user_vehicle_id, component_id, action, performed_at, estimated)
        values ($1,$2,'baseline',now(),true)`, [vehA, oil], FK);
      await c.asFails(B, `insert into public.part_installs (user_vehicle_id, component_id, installed_at) values ($1,$2,now())`, [vehA, oil], FK);
      await c.asFails(B, 'insert into public.component_overrides (user_vehicle_id, component_id) values ($1,$2)', [vehA, oil], FK);
      await c.asFails(B, `insert into public.deadlines (user_vehicle_id, kind, due_date) values ($1,'insurance','2027-01-01')`, [vehA], FK);
      // B's ledger entry cannot reference A's ride
      const vehB = (await c.as(B, 'select id from public.user_vehicles')).rows[0].id;
      await c.asFails(B, `insert into public.mileage_entries (user_vehicle_id, kind, source, ride_id, applied_km, odo_reading_after)
        values ($1,'ride','gps',$2,5,100)`, [vehB, rideA], FK);
      // and with A's user_id the row-level policy blocks it
      await c.asFails(B, `insert into public.rides (user_id, user_vehicle_id, started_at, ended_at, status, gps_distance_m)
        values ($1,$2,now(),now(),'finished',1)`, [A, vehA], RLS);
    });

    // ------------------------------------------------------------------ ledger
    scenario('mileage ledger is insert-only and enforces the odometer rules', async (c) => {
      const { A, vehA } = await fixture(c);
      const ride = randomUUID();
      await c.as(A, ...insRide(vehA, ride));
      const e1 = randomUUID();
      await c.as(A, ...insEntry(vehA, 'initial', 'initial', 0, 81541, '', e1));
      await c.as(A, `insert into public.mileage_entries (user_vehicle_id, kind, source, ride_id, gps_distance_m, suggested_km, applied_km, odo_reading_after)
        values ($1,'ride','gps',$2,24600,24.6,25,81566)`, [vehA, ride]);
      // higher dashboard reading adds distance
      await c.as(A, ...insEntry(vehA, 'dashboard_reading', 'dashboard_reading', 14, 81580));
      // a LOWER reading (applied 0) must carry a flag so it is reviewed
      await c.asFails(A, ...insEntry(vehA, 'dashboard_reading', 'dashboard_reading', 0, 81500), CHECK);
      await c.as(A, ...insEntry(vehA, 'dashboard_reading', 'dashboard_reading', 0, 81500,
        { cols: 'flags', vals: `array['reading_lowered','calibration']` }));
      // replacement: no maintenance distance, carries the offset
      await c.as(A, ...insEntry(vehA, 'odometer_replacement', 'manual_adjustment', 0, 12,
        { cols: 'odo_offset_delta, flags', vals: `81488, array['reading_lowered']` }));
      await c.asFails(A, ...insEntry(vehA, 'odometer_replacement', 'manual_adjustment', 5, 12), CHECK);
      await c.asFails(A, ...insEntry(vehA, 'dashboard_reading', 'dashboard_reading', 5, 90, { cols: 'odo_offset_delta', vals: '10' }), CHECK);
      await c.asFails(A, ...insEntry(vehA, 'dashboard_reading', 'dashboard_reading', -1, 90), CHECK);
      await c.asFails(A, ...insEntry(vehA, 'dashboard_reading', 'dashboard_reading', 3, 90, { cols: 'flags', vals: `array['typo']` }), CHECK);
      await c.asFails(A, ...insEntry(vehA, 'ride', 'gps', 3, 90), CHECK);              // ride kind needs ride_id
      await c.asFails(A, ...insEntry(vehA, 'dashboard_reading', 'gps', 3, 90), CHECK);  // kind/source mismatch
      // void: references an entry of the same vehicle, has no running odometer, adds no distance
      await c.as(A, `insert into public.mileage_entries (user_vehicle_id, kind, source, applied_km, voids_entry_id, note)
        values ($1,'void','manual_adjustment',0,$2,'wrong entry')`, [vehA, e1]);
      await c.asFails(A, `insert into public.mileage_entries (user_vehicle_id, kind, source, applied_km, odo_reading_after)
        values ($1,'void','manual_adjustment',0,5)`, [vehA], CHECK);
      // immutable for the app user AND for admins
      await c.asFails(A, `update public.mileage_entries set applied_km = 1 where id = $1`, [e1], PERM);
      await c.asFails(A, `delete from public.mileage_entries where id = $1`, [e1], PERM);
      await c.fails('postgres', null, `update public.mileage_entries set applied_km = 1 where id = $1`, [e1], IMMUTABLE);
      await c.fails('postgres', null, `delete from public.mileage_entries where id = $1`, [e1], IMMUTABLE);
      // idempotent retry works; an upsert that would modify does not
      await c.as(A, ...insEntry(vehA, 'initial', 'initial', 0, 5, '', e1).map((x, i) => i === 0 ? x + ' on conflict (id) do nothing' : x));
      assert.equal(await c.n(A, 'select odo_reading_after::int as n from public.mileage_entries where id = $1', [e1]), 81541);
      await c.asFails(A, ...insEntry(vehA, 'initial', 'initial', 0, 5, '', e1).map((x, i) => i === 0 ? x + ' on conflict (id) do update set odo_reading_after = 5' : x), PERM);
    });

    scenario('a void cannot point at another vehicle\'s entry; service events likewise', async (c) => {
      const { A, vehA, model, comp } = await fixture(c);
      const veh2 = randomUUID();
      await c.as(A, `insert into public.user_vehicles (id, model_id, catalog_version) values ($1,$2,$3)`, [veh2, model.id, model.current_version]);
      const e1 = randomUUID();
      await c.as(A, ...insEntry(vehA, 'initial', 'initial', 0, 100, '', e1));
      await c.asFails(A, `insert into public.mileage_entries (user_vehicle_id, kind, source, applied_km, voids_entry_id)
        values ($1,'void','manual_adjustment',0,$2)`, [veh2, e1], FK);
      const oil = await comp('engine_oil'), chain = await comp('drive_chain');
      const s1 = randomUUID();
      await c.as(A, `insert into public.service_events (id, user_vehicle_id, component_id, action, performed_at, odo_at)
        values ($1,$2,$3,'replace','2026-10-01T00:00Z',90)`, [s1, vehA, oil]);
      await c.asFails(A, `insert into public.service_events (user_vehicle_id, component_id, action, performed_at, voids_event_id)
        values ($1,$2,'void',now(),$3)`, [vehA, chain, s1], FK);          // different component
      await c.as(A, `insert into public.service_events (user_vehicle_id, component_id, action, performed_at, voids_event_id)
        values ($1,$2,'void',now(),$3)`, [vehA, oil, s1]);                  // same component: ok
    });

    scenario('service events are insert-only; baselines are labelled estimated; history works without component rows', async (c) => {
      const { A, vehA, comp } = await fixture(c);
      const chain = await comp('drive_chain'), oil = await comp('engine_oil');
      await c.asFails(A, `insert into public.service_events (user_vehicle_id, component_id, action, performed_at, estimated)
        values ($1,$2,'baseline',now(),false)`, [vehA, oil], CHECK);
      const id = randomUUID();
      await c.as(A, `insert into public.service_events (id, user_vehicle_id, component_id, action, performed_at, odo_at, estimated)
        values ($1,$2,$3,'baseline',now(),81541,true)`, [id, vehA, oil]);
      await c.as(A, `insert into public.service_events (user_vehicle_id, component_id, action, performed_at)
        values ($1,$2,'lubricate',now())`, [vehA, chain]);
      await c.asFails(A, `update public.service_events set notes = 'x' where id = $1`, [id], PERM);
      await c.asFails(A, `delete from public.service_events where id = $1`, [id], PERM);
      await c.fails('postgres', null, `update public.service_events set notes = 'x' where id = $1`, [id], IMMUTABLE);
      await c.fails('postgres', null, `delete from public.service_events where id = $1`, [id], IMMUTABLE);
    });

    scenario('component overrides work without default component rows', async (c) => {
      const { A, B, vehA, comp } = await fixture(c);
      const oil = await comp('engine_oil');
      await c.as(A, 'insert into public.component_overrides (user_vehicle_id, component_id, interval_km, enabled) values ($1,$2,1200,true)', [vehA, oil]);
      await c.asFails(A, 'insert into public.component_overrides (user_vehicle_id, component_id) values ($1,$2)', [vehA, oil], UNIQUE);
      await c.asFails(A, 'insert into public.component_overrides (user_vehicle_id, component_id, interval_km) values ($1,$2,0)', [vehA, await comp('air_filter')], CHECK);
      assert.equal((await c.as(B, 'delete from public.component_overrides where user_vehicle_id = $1', [vehA])).count, 0);
      assert.equal((await c.as(A, 'delete from public.component_overrides where user_vehicle_id = $1', [vehA])).count, 1);
    });

    // ------------------------------------------------------------------ parts
    scenario('part replacement is atomic and idempotent; closed installs are history', async (c) => {
      const { A, B, vehA, comp } = await fixture(c);
      const chain = await comp('drive_chain');
      const old = randomUUID(), neu = randomUUID();
      await c.as(A, `insert into public.part_installs (id, user_vehicle_id, component_id, brand, model, installed_at, install_odo)
        values ($1,$2,$3,'Generic','428','2026-01-12T00:00Z',76368)`, [old, vehA, chain]);
      // only one open install per component
      await c.asFails(A, `insert into public.part_installs (user_vehicle_id, component_id, installed_at) values ($1,$2,now())`, [vehA, chain], UNIQUE);
      // open install can be corrected
      await c.as(A, `update public.part_installs set brand = 'Generic Co' where id = $1`, [old]);
      const rpc = `select public.replace_part_install($1,$2,$3,$4,'DID','428VX','2026-09-12T00:00Z'::timestamptz,81200::numeric) as id`;
      // wrong old id -> everything rolls back, no new row
      await c.asFails(A, rpc, [randomUUID(), neu, vehA, chain], /not found|already closed/i);
      assert.equal(await c.n(A, 'select count(*)::int as n from public.part_installs where id = $1', [neu]), 0);
      // another user cannot replace A's part
      await c.asFails(B, rpc, [old, neu, vehA, chain]);
      // real replacement
      assert.equal((await c.as(A, rpc, [old, neu, vehA, chain])).rows[0].id, neu);
      assert.equal(await c.n(A, 'select count(*)::int as n from public.part_installs where component_id = $1', [chain]), 2);
      assert.equal(await c.n(A, 'select count(*)::int as n from public.part_installs where component_id = $1 and removed_at is null', [chain]), 1);
      assert.equal((await c.as(A, 'select removal_odo::int as r from public.part_installs where id = $1', [old])).rows[0].r, 81200);
      // retry with the same new id changes nothing
      assert.equal((await c.as(A, rpc, [old, neu, vehA, chain])).rows[0].id, neu);
      assert.equal(await c.n(A, 'select count(*)::int as n from public.part_installs where component_id = $1', [chain]), 2);
      // history is protected
      await c.asFails(A, `update public.part_installs set brand = 'Hacked' where id = $1`, [old], /history|cannot be modified/i);
      await c.asFails(A, `delete from public.part_installs where id = $1`, [old], PERM);
      await c.fails('postgres', null, `delete from public.part_installs where id = $1`, [old], /not allowed/i);
      await c.asFails(A, `update public.part_installs set component_id = $2 where id = $1`, [neu, await comp('engine_oil')], /identity/i);
    });

    // ------------------------------------------------------------------ rides / settings / misc
    scenario('rides keep summary + polyline in the cloud, never raw points', async (c) => {
      const { A, vehA } = await fixture(c);
      const id = randomUUID();
      await c.as(A, ...insRide(vehA, id));
      await c.as(A, `update public.rides set needs_review = true, polyline = 'abc' where id = $1`, [id]);
      await c.asFails(A, `insert into public.rides (user_vehicle_id, started_at, ended_at, status, gps_distance_m)
        values ($1,'2026-10-10T02:00Z','2026-10-10T01:00Z','finished',1)`, [vehA], CHECK);
      await c.asFails(A, `insert into public.rides (user_vehicle_id, started_at, ended_at, status, gps_distance_m)
        values ($1,now(),now(),'finished',-5)`, [vehA], CHECK);
      await c.asFails(A, `insert into public.rides (user_vehicle_id, started_at, ended_at, status, gps_distance_m)
        values ($1,now(),now(),'recording',5)`, [vehA], CHECK);
    });

    scenario('settings, deadlines and model requests behave', async (c) => {
      const { A, B, vehA } = await fixture(c);
      await c.as(A, 'insert into public.user_settings default values');
      assert.equal(await c.n(A, 'select raw_retention_days as n from public.user_settings'), 30);
      await c.as(A, 'update public.user_settings set raw_retention_days = -1');
      await c.asFails(A, 'update public.user_settings set raw_retention_days = 0', [], CHECK);
      await c.asFails(A, `update public.user_settings set ui_mode = 'neon'`, [], CHECK);
      await c.as(A, `insert into public.deadlines (kind, due_date, label) values ('license','2027-03-01','Driver license')`);
      await c.asFails(A, `insert into public.deadlines (kind, due_date) values ('registration','2027-03-01')`, [], CHECK);
      await c.asFails(A, `insert into public.deadlines (user_vehicle_id, kind, due_date, reminder_offsets_days) values ($1,'insurance','2027-03-01','{30,-1}')`, [vehA], CHECK);
      const id = randomUUID();
      await c.as(A, `insert into public.model_requests (id, vehicle_type_code, model_text) values ($1,'motorcycle','Test 150')`, [id]);
      await c.asFails(A, `update public.model_requests set status = 'added' where id = $1`, [id], PERM);
      assert.equal(await c.n(B, 'select count(*)::int as n from public.model_requests'), 0);
    });

    scenario('deleting an account cascades through the immutable tables', async (c) => {
      const { A, B, vehA, comp } = await fixture(c);
      const oil = await comp('engine_oil');
      await c.as(A, ...insEntry(vehA, 'initial', 'initial', 0, 100));
      await c.as(A, `insert into public.service_events (user_vehicle_id, component_id, action, performed_at, estimated)
        values ($1,$2,'baseline',now(),true)`, [vehA, oil]);
      await c.as(A, `insert into public.part_installs (user_vehicle_id, component_id, installed_at) values ($1,$2,now())`, [vehA, oil]);
      await c.sup('delete from auth.users where id = $1', [A]);
      for (const t of ['user_vehicles', 'mileage_entries', 'service_events', 'part_installs']) {
        assert.equal((await c.sup(`select count(*)::int as n from public.${t} where user_id = $1`, [A])).rows[0].n, 0, t);
      }
      assert.equal((await c.sup('select count(*)::int as n from public.user_vehicles where user_id = $1', [B])).rows[0].n, 1, "B's data untouched");
    });
  });
}
