import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { migrate } from './migrate';
import { MIGRATIONS } from './migrations';
import { createNodeSqliteDb, hasNodeSqlite } from './nodeSqliteDb.testutil';
import { getAppSettings, updateAppSettings } from './settingsStore';
import { MaintenanceValidationError } from './maintenanceErrors';
import type { Db } from './types';

const T0 = Date.UTC(2026, 9, 10, 1, 0, 0);

describe('app settings store', { skip: hasNodeSqlite() ? false : 'node:sqlite unavailable' }, () => {
  let db: Db;

  beforeEach(async () => {
    db = createNodeSqliteDb();
    await migrate(db, MIGRATIONS);
  });

  it('starts from the shipped defaults', async () => {
    await assert.rejects(
      () => updateAppSettings(db, { appearance: 'neon' as never }),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );
    const s = await getAppSettings(db);
    assert.equal(s.units, 'metric');
    assert.equal(s.ui_mode, 'standard');
    assert.equal(s.appearance, 'dark');
    assert.equal(s.appearance, 'dark');
    assert.equal(s.notifications_enabled, 1);
    assert.equal(s.maintenance_upcoming_enabled, 1);
    assert.equal(s.maintenance_overdue_enabled, 1);
    assert.equal(s.document_reminders_enabled, 1);
    assert.equal(s.battery_reminders_enabled, 1);
    assert.equal(s.id, 1);
  });

  it('never creates a second settings row', async () => {
    await getAppSettings(db);
    await getAppSettings(db);
    const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM app_settings');
    assert.equal(row?.n, 1);
  });

  it('applies partial patches and leaves the other fields alone', async () => {
    const a = await updateAppSettings(db, { units: 'imperial' }, T0);
    assert.equal(a.units, 'imperial');
    assert.equal(a.ui_mode, 'standard');
    const b = await updateAppSettings(db, { ui_mode: 'easy' }, T0 + 1);
    assert.equal(b.units, 'imperial'); // preserved
    assert.equal(b.ui_mode, 'easy');
    assert.equal(b.sync_status, 'pending');
    const c = await updateAppSettings(db, { notifications_enabled: false, appearance: 'light' }, T0 + 2);
    assert.equal(c.notifications_enabled, 0);
    assert.equal(c.units, 'imperial');
    assert.equal(c.ui_mode, 'easy');
    assert.equal(c.appearance, 'light');
    assert.equal((await getAppSettings(db)).appearance, 'light'); // survives a fresh read
    const d = await updateAppSettings(db, { maintenance_upcoming_enabled: false, document_reminders_enabled: false }, T0 + 3);
    assert.equal(d.maintenance_upcoming_enabled, 0);
    assert.equal(d.maintenance_overdue_enabled, 1);
    assert.equal(d.document_reminders_enabled, 0);
    assert.equal(d.battery_reminders_enabled, 1);
    assert.equal((await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM app_settings'))?.n, 1);
  });

  it('rejects unknown preference values without writing', async () => {
    await assert.rejects(
      () => updateAppSettings(db, { units: 'furlongs' as never }),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );
    await assert.rejects(
      () => updateAppSettings(db, { ui_mode: 'childish' as never }),
      (e: unknown) => e instanceof MaintenanceValidationError,
    );
    const s = await getAppSettings(db);
    assert.equal(s.units, 'metric');
    assert.equal(s.ui_mode, 'standard');
  });

  it('keeps units display-only at the type level (stored rows are never converted)', async () => {
    const s = await updateAppSettings(db, { units: 'imperial' }, T0);
    // The row itself carries no distances to convert — only the label choice.
    const cols = (await db.getAllAsync<{ name: string }>('PRAGMA table_info(app_settings)')).map((c) => c.name);
    for (const col of cols) {
      assert.ok(!/km|mile|distance|odometer/.test(col), `app_settings must not store distances (found ${col})`);
    }
    assert.equal(s.units, 'imperial');
  });
});
