import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { DeadlineRow } from '../../data/local/deadlineStore';
import type { ComponentMaintenance } from '../../data/local/maintenanceQuery';
import type { MaintenanceStatus } from '../../domain/maintenance/types';
import {
  CONDITION_DESCRIPTIONS,
  maintenanceCondition,
  maintenanceLine,
  nextReminderForVehicle,
  odometerDisplay,
  pageForOffset,
  reminderStat,
  reminderSummaryLine,
  selectedVehicleIndex,
  vehicleStats,
  vehicleTypeIcon,
} from './garageView';

function item(status: MaintenanceStatus): Pick<ComponentMaintenance, 'evaluation'> {
  return { evaluation: { status } as ComponentMaintenance['evaluation'] };
}

function deadline(over: Partial<DeadlineRow> = {}): DeadlineRow {
  return {
    id: 'd1',
    user_vehicle_id: 'v1',
    kind: 'registration',
    label: null,
    due_date: '2026-11-01',
    reminder_offsets: '[0]',
    enabled: 1,
    deleted_at: null,
    created_at: 0,
    updated_at: 0,
    client_updated_at: 0,
    sync_status: 'synced',
    server_updated_at: null,
    ...over,
  };
}

describe('garageView: carousel page', () => {
  it('rounds the offset to the centered page', () => {
    assert.equal(pageForOffset(0, 400, 3), 0);
    assert.equal(pageForOffset(410, 400, 3), 1);
    assert.equal(pageForOffset(790, 400, 3), 2);
  });

  it('clamps a bounce past either end', () => {
    assert.equal(pageForOffset(-80, 400, 3), 0);
    assert.equal(pageForOffset(1400, 400, 3), 2);
  });

  it('returns 0 for an empty list or an unusable page width', () => {
    assert.equal(pageForOffset(0, 400, 0), 0);
    assert.equal(pageForOffset(400, 0, 3), 0);
    assert.equal(pageForOffset(400, Number.NaN, 3), 0);
  });

  it('finds the selected vehicle, falling back to the first page', () => {
    const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    assert.equal(selectedVehicleIndex(list, 'b'), 1);
    assert.equal(selectedVehicleIndex(list, null), 0);
    assert.equal(selectedVehicleIndex(list, 'gone'), 0);
    assert.equal(selectedVehicleIndex([], 'a'), 0);
  });
});

describe('garageView: vehicle type icon', () => {
  it('maps every shipped vehicle type to a glyph', () => {
    assert.equal(vehicleTypeIcon('motorcycle'), 'motorcycle');
    assert.equal(vehicleTypeIcon('car'), 'car');
    assert.equal(vehicleTypeIcon('bicycle'), 'bicycle');
    assert.equal(vehicleTypeIcon('truck'), 'truck');
    assert.equal(vehicleTypeIcon('bus'), 'bus');
    assert.equal(vehicleTypeIcon('van'), 'shuttle-van');
    assert.equal(vehicleTypeIcon('other'), 'car-side');
  });

  it('never invents a type-specific glyph for unknown input', () => {
    assert.equal(vehicleTypeIcon('hovercraft'), 'car-side');
  });
});

describe('garageView: odometer display', () => {
  it('splits the formatted reading from its unit', () => {
    assert.deepEqual(odometerDisplay(1234.5, 'metric'), { value: '1234.5', unit: 'km' });
    assert.deepEqual(odometerDisplay(100, 'imperial'), { value: '62.1', unit: 'mi' });
  });

  it('keeps the unit when no reading exists', () => {
    assert.deepEqual(odometerDisplay(null, 'metric'), { value: ' ', unit: 'km' });
    assert.deepEqual(odometerDisplay(Number.NaN, 'imperial'), { value: ' ', unit: 'mi' });
  });
});

describe('garageView: maintenance line', () => {
  it('reports the worst condition first, like the Dashboard', () => {
    assert.equal(maintenanceLine([item('overdue'), item('due_soon'), item('good')]), '1 overdue');
    assert.equal(maintenanceLine([item('due_soon'), item('good')]), '1 due soon');
    assert.equal(maintenanceLine([item('unknown'), item('good')]), '1 unknown');
    assert.equal(maintenanceLine([item('good'), item('good')]), 'Up to date');
  });

  it('ignores components that do not apply and reports an empty list honestly', () => {
    assert.equal(maintenanceLine([item('not_applicable'), item('good')]), 'Up to date');
    assert.equal(maintenanceLine([item('not_applicable')]), null);
    assert.equal(maintenanceLine([]), null);
  });
});

describe('garageView: per-vehicle reminder', () => {
  const NOW = new Date(2026, 9, 20).getTime(); // 2026-10-20 local

  it('picks only the selected vehicle\'s nearest visible reminder', () => {
    const rows = [
      deadline({ id: 'a', user_vehicle_id: 'v1', due_date: '2026-12-01' }),
      deadline({ id: 'b', user_vehicle_id: 'v2', due_date: '2026-11-01' }),
      deadline({ id: 'c', user_vehicle_id: 'v1', due_date: '2026-11-15' }),
      deadline({ id: 'd', user_vehicle_id: 'v1', due_date: '2026-10-25', enabled: 0 }),
    ];
    const next = nextReminderForVehicle(rows, 'v1');
    assert.equal(next?.id, 'c');
  });

  it('returns null without a vehicle or a match', () => {
    assert.equal(nextReminderForVehicle([deadline()], null), null);
    assert.equal(nextReminderForVehicle([deadline({ user_vehicle_id: 'v2' })], 'v1'), null);
    assert.equal(nextReminderForVehicle([], 'v1'), null);
  });

  it('describes due, overdue and distant dates without inventing one', () => {
    assert.equal(reminderSummaryLine(deadline({ due_date: '2026-10-20' }), NOW), 'Registration due today');
    assert.equal(reminderSummaryLine(deadline({ due_date: '2026-10-25' }), NOW), 'Registration due in 5 days');
    assert.equal(reminderSummaryLine(deadline({ due_date: '2026-10-19' }), NOW), 'Registration expired');
    assert.equal(reminderSummaryLine(deadline({ due_date: '2027-08-01' }), NOW), null);
    assert.equal(reminderSummaryLine(null, NOW), null);
  });
});

describe('garageView: maintenance condition label', () => {
  it('calls an overdue component DUE', () => {
    const condition = maintenanceCondition([item('overdue'), item('good')]);
    assert.equal(condition.label, 'DUE');
    assert.equal(condition.tone, 'bad');
  });

  it('calls a due-soon component SERVICE when nothing is overdue', () => {
    const condition = maintenanceCondition([item('due_soon'), item('good')]);
    assert.equal(condition.label, 'SERVICE');
    assert.equal(condition.tone, 'watch');
  });

  it('never calls an undetermined component GOOD', () => {
    const condition = maintenanceCondition([item('unknown'), item('good')]);
    assert.equal(condition.label, 'UNKNOWN');
    assert.equal(condition.tone, 'unknown');
  });

  it('calls every up-to-date component GOOD', () => {
    const condition = maintenanceCondition([item('good'), item('good')]);
    assert.equal(condition.label, 'GOOD');
    assert.equal(condition.tone, 'ok');
  });

  it('ignores components that do not apply to the vehicle', () => {
    const condition = maintenanceCondition([item('not_applicable'), item('good')]);
    assert.equal(condition.label, 'GOOD');
    assert.equal(condition.tone, 'ok');
  });

  it('is UNKNOWN when there is nothing applicable to judge', () => {
    const empty = maintenanceCondition([]);
    assert.equal(empty.label, 'UNKNOWN');
    assert.equal(empty.tone, 'unknown');
    const notApplicable = maintenanceCondition([item('not_applicable')]);
    assert.equal(notApplicable.label, 'UNKNOWN');
    assert.equal(notApplicable.tone, 'unknown');
  });

  it('takes the worst condition first', () => {
    const condition = maintenanceCondition([item('due_soon'), item('overdue'), item('unknown')]);
    assert.equal(condition.label, 'DUE');
    assert.equal(condition.tone, 'bad');
  });

  it('carries the counts it was derived from', () => {
    const condition = maintenanceCondition([item('overdue'), item('good'), item('not_applicable')]);
    assert.equal(condition.counts.total, 3);
    assert.equal(condition.counts.overdue, 1);
    assert.equal(condition.counts.good, 1);
    assert.equal(condition.counts.not_applicable, 1);
  });

  it('gives every label a plain reading, so colour is never the only signal', () => {
    assert.deepEqual(Object.keys(CONDITION_DESCRIPTIONS).sort(), ['DUE', 'GOOD', 'SERVICE', 'UNKNOWN']);
    for (const description of Object.values(CONDITION_DESCRIPTIONS)) {
      assert.ok(description.length > 0);
    }
  });
});

describe('garageView: reminder stat', () => {
  const NOW = new Date(2026, 9, 20).getTime(); // 2026-10-20 local

  it('has no cell without a reminder', () => {
    assert.equal(reminderStat(null, NOW), null);
  });

  it('has no cell for a date it cannot read', () => {
    assert.equal(reminderStat(deadline({ due_date: 'not-a-date' }), NOW), null);
  });

  it('names the kind as the label and the distance as the value', () => {
    const stat = reminderStat(deadline({ due_date: '2026-11-01' }), NOW);
    assert.equal(stat?.key, 'reminder');
    assert.equal(stat?.label, 'Registration');
    assert.equal(stat?.value, 'In 12 days');
    assert.equal(stat?.tone, 'watch');
  });

  it('uses the reminder\'s own title when it has one', () => {
    const stat = reminderStat(deadline({ kind: 'custom', label: 'Oil change' }), NOW);
    assert.equal(stat?.label, 'Oil change');
  });

  it('marks a past reminder overdue', () => {
    const stat = reminderStat(deadline({ due_date: '2026-10-19' }), NOW);
    assert.equal(stat?.value, 'Overdue');
    assert.equal(stat?.tone, 'bad');
  });

  it('marks today and tomorrow as coming up', () => {
    assert.equal(reminderStat(deadline({ due_date: '2026-10-20' }), NOW)?.value, 'Today');
    assert.equal(reminderStat(deadline({ due_date: '2026-10-21' }), NOW)?.value, 'Tomorrow');
    assert.equal(reminderStat(deadline({ due_date: '2026-10-21' }), NOW)?.tone, 'watch');
  });

  it('settles to a neutral tone beyond the coming-up window', () => {
    const stat = reminderStat(deadline({ due_date: '2027-08-01' }), NOW);
    assert.equal(stat?.value, 'In 285 days');
    assert.equal(stat?.tone, 'default');
  });
});

describe('garageView: vehicle stats', () => {
  const NOW = new Date(2026, 9, 20).getTime(); // 2026-10-20 local

  it('always reports the maintenance state and the model year', () => {
    const stats = vehicleStats({
      items: [item('good')],
      reminder: null,
      nowMs: NOW,
      modelYear: 2021,
    });
    assert.deepEqual(
      stats.map((s) => s.key),
      ['maintenance', 'year'],
    );
    assert.equal(stats[0].value, 'Up to date');
    assert.equal(stats[0].tone, 'ok');
    assert.equal(stats[1].value, '2021');
  });

  it('says so plainly when there is no maintenance record', () => {
    const stats = vehicleStats({ items: [], reminder: null, nowMs: NOW, modelYear: null });
    assert.equal(stats[0].value, 'No records');
    assert.equal(stats[0].tone, 'unknown');
    assert.equal(stats[1].value, 'Not set');
  });

  it('adds the reminder between the maintenance state and the year', () => {
    const stats = vehicleStats({
      items: [item('due_soon')],
      reminder: deadline({ due_date: '2026-11-01' }),
      nowMs: NOW,
      modelYear: 2021,
    });
    assert.deepEqual(
      stats.map((s) => s.key),
      ['maintenance', 'reminder', 'year'],
    );
    assert.equal(stats[0].value, '1 due soon');
    assert.equal(stats[0].tone, 'watch');
    assert.equal(stats[1].value, 'In 12 days');
  });

  it('leaves out the reminder cell when there is no reminder', () => {
    const stats = vehicleStats({
      items: [item('good')],
      reminder: deadline({ due_date: 'not-a-date' }),
      nowMs: NOW,
      modelYear: null,
    });
    assert.deepEqual(
      stats.map((s) => s.key),
      ['maintenance', 'year'],
    );
  });
});
