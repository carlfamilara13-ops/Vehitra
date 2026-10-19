import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { getDb } from '../../data/local/db';
import { getActiveRideId, getRide, listRides, type RideRow } from '../../data/local/ridesStore';
import { getActiveVehicle, type VehicleRow } from '../../data/local/vehicleStore';
import { getBatteryState, type BatteryStateRow } from '../../data/local/batteryStore';
import { DEADLINE_KIND_LABELS, listAllDeadlines, type DeadlineRow } from '../../data/local/deadlineStore';
import { evaluateVehicleMaintenance, type VehicleMaintenance } from '../../data/local/maintenanceQuery';
import { daysUntilDateOnly, deadlinePhase, pickNextReminder } from '../../domain/reminders/dates';
import { BATTERY_IDLE_LEVEL_LABELS, batteryIdleDays, batteryIdleLevel } from '../../domain/battery/idle';
import { formatDistanceM } from '../../domain/units';
import Screen from '../../ui/Screen';
import Placeholder from '../../ui/Placeholder';
import { colors, radii, spacing, typography } from '../../ui/theme';
import type { RootTabParamList } from '../../app/RootNavigator';
import { usePrefs } from '../../app/prefs';

type Props = BottomTabScreenProps<RootTabParamList, 'Dashboard'>;

// Totals are derived from the existing listRides API. Local data only; the cap is a
// guardrail, not a schema change.
// Totals are derived from the existing listRides API. Local data only; the cap is a
// guardrail, not a schema change.
const RIDE_LIST_LIMIT = 1000;

// Dashboard. Reads only local stores: rides, active vehicle battery check-in, enabled
// reminders and the maintenance evaluation for the active vehicle. Everything shown exists —
// nothing is faked, and a piece with no data says so instead of hiding.

export default function DashboardScreen({ navigation }: Props) {
  const prefs = usePrefs();
  const units = prefs.units;
  const easy = prefs.uiMode === 'easy';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<RideRow | null>(null);
  const [rides, setRides] = useState<RideRow[]>([]);
  const [vehicle, setVehicle] = useState<VehicleRow | null>(null);
  const [battery, setBattery] = useState<BatteryStateRow | null>(null);
  const [deadlines, setDeadlines] = useState<DeadlineRow[]>([]);
  const [maintenance, setMaintenance] = useState<VehicleMaintenance | null>(null);
  const [maintFailed, setMaintFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const db = await getDb();
      const activeId = await getActiveRideId(db);
      const activeRide = activeId ? await getRide(db, activeId) : null;
      const all = await listRides(db, RIDE_LIST_LIMIT);
      setActive(activeRide);
      setRides(all);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
      return;
    }
    try {
      const db = await getDb();
      const activeVehicle = await getActiveVehicle(db);
      const [batteryRow, deadlineRows] = await Promise.all([
        activeVehicle ? getBatteryState(db, activeVehicle.id) : Promise.resolve(null),
        listAllDeadlines(db),
      ]);
      // Maintenance evaluation is a derived read; if it fails the rest of the dashboard still
      // loads and the card reports the failure instead of pretending nothing is planned.
      let maint: VehicleMaintenance | null = null;
      let maintError = false;
      if (activeVehicle) {
        try {
          maint = await evaluateVehicleMaintenance(db, activeVehicle.id);
        } catch {
          maintError = true;
        }
      }
      setVehicle(activeVehicle);
      setBattery(batteryRow);
      setDeadlines(deadlineRows);
      setMaintenance(maint);
      setMaintFailed(maintError);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Only finalized rides count. The recording ride is shown separately and, per the storage
  // rules, is not yet a saved record; counting it would double up with the active card.
  const saved = rides.filter((r) => r.status !== 'recording');
  const rideCount = saved.length;
  const totalM = saved.reduce((sum, r) => sum + r.distance_m, 0);

  // Battery check-in for the active vehicle: idle days come from the stored last_active_at.
  const batteryView = battery
    ? (() => {
        const idleDays = batteryIdleDays(battery.last_active_at, Date.now());
        const level = batteryIdleLevel(idleDays);
        return { idleDays, level, label: BATTERY_IDLE_LEVEL_LABELS[level] };
      })()
    : null;

  // Nearest reminder the user should still see. listAllDeadlines includes disabled and
  // soft-deleted rows on purpose (sync needs full state), so visibility is applied here —
  // including deleted rows a cloud-pulled tombstone may have marked without touching `enabled`.
  const nextDeadline = pickNextReminder(deadlines);
  const nextDays = nextDeadline ? daysUntilDateOnly(nextDeadline.due_date, Date.now()) : null;
  const nextPhase = deadlinePhase(nextDays);

  // Maintenance summary for the active vehicle.
  const maintItems = maintenance?.items ?? [];
  const overdueCount = maintItems.filter((i) => i.evaluation.status === 'overdue').length;
  const dueSoonCount = maintItems.filter((i) => i.evaluation.status === 'due_soon').length;
  const unknownCount = maintItems.filter((i) => i.evaluation.status === 'unknown').length;

  return (
    <Screen title="Dashboard" subtitle="Your rides at a glance">
      {loading ? (
        <View style={s.card}>
          <Text style={s.muted}>Loading your rides…</Text>
        </View>
      ) : error ? (
        <View style={[s.card, s.errorCard]}>
          <Text style={s.cardTitle}>Could not read your rides</Text>
          <Text style={s.muted}>{error}</Text>
          <TouchableOpacity style={s.btnGhost} onPress={() => void load()} accessibilityRole="button">
            <Text style={s.btnGhostTxt}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {active ? (
            <View style={s.activeCard}>
              <Text style={s.kicker}>RECORDING</Text>
              <Text style={s.cardTitle}>Ride in progress</Text>
              <Text style={s.activeVehicle}>{active.vehicle_name ?? 'No vehicle'}</Text>
              <View style={s.metrics}>
                <View style={s.metric}>
                  <Text style={[s.metricValue, easy && s.easyMetric]}>
                    {formatDistanceM(active.distance_m, units)}
                  </Text>
                  <Text style={s.metricLabel}>So far</Text>
                </View>
                <View style={s.metric}>
                  <Text style={[s.metricValue, easy && s.easyMetric]}>{active.point_count}</Text>
                  <Text style={s.metricLabel}>Points</Text>
                </View>
              </View>
              <TouchableOpacity
                style={s.btn}
                onPress={() => navigation.navigate('Record')}
                accessibilityRole="button"
              >
                <Text style={[s.btnTxt, easy && s.easyBody]}>Open ride recorder</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={s.btn}
              onPress={() => navigation.navigate('Record')}
              accessibilityRole="button"
            >
              <Text style={[s.btnTxt, easy && s.easyBody]}>
                {easy ? 'Start a ride' : 'START A RIDE'}
              </Text>
            </TouchableOpacity>
          )}

          <View style={s.card}>
            <Text style={[s.cardTitle, easy && s.easyHeading]}>Ride totals</Text>
            <View style={s.metrics}>
              <View style={s.metric}>
                <Text style={[s.metricValue, easy && s.easyMetric]}>{rideCount}</Text>
                <Text style={s.metricLabel}>Rides recorded</Text>
              </View>
              <View style={s.metric}>
                <Text style={[s.metricValue, easy && s.easyMetric]}>
                  {formatDistanceM(totalM, units)}
                </Text>
                <Text style={s.metricLabel}>Total distance</Text>
              </View>
            </View>
          </View>

          {rideCount === 0 && !active && (
            <Placeholder
              title="No rides yet"
              message="Start a ride from the Record tab and it will be saved here, even offline."
            />
          )}

          <View style={s.card}>
            <Text style={[s.cardTitle, easy && s.easyHeading]}>Battery check-in</Text>
            {batteryView ? (
              <>
                <Text style={s.muted}>
                  Last used{' '}
                  {batteryView.idleDays == null
                    ? 'recently'
                    : batteryView.idleDays === 0
                      ? 'today'
                      : `${batteryView.idleDays} day${batteryView.idleDays === 1 ? '' : 's'} ago`}
                  .
                </Text>
                <Text
                  style={[
                    s.statusLine,
                    batteryView.level === 'warn' && s.statusBad,
                    batteryView.level === 'watch' && s.statusWarn,
                  ]}
                >
                  {batteryView.label}
                </Text>
              </>
            ) : (
              <Text style={s.muted}>
                No check-in yet. Record when you use the bike so idle warnings are accurate.
              </Text>
            )}
            <TouchableOpacity
              style={s.btnGhost}
              onPress={() => navigation.navigate('Equipment', vehicle ? { vehicleId: vehicle.id } : undefined)}
              accessibilityRole="button"
            >
              <Text style={s.btnGhostTxt}>Open equipment</Text>
            </TouchableOpacity>
          </View>

          <View style={s.card}>
            <Text style={[s.cardTitle, easy && s.easyHeading]}>Next reminder</Text>
            {nextDeadline ? (
              <>
                <Text style={s.muted}>
                  {DEADLINE_KIND_LABELS[nextDeadline.kind as keyof typeof DEADLINE_KIND_LABELS] ??
                    nextDeadline.kind}
                  {nextDeadline.label ? ` · ${nextDeadline.label}` : ''}
                </Text>
                <Text
                  style={[
                    s.statusLine,
                    nextPhase === 'overdue' && s.statusBad,
                    nextPhase === 'due_soon' && s.statusWarn,
                  ]}
                >
                  {nextPhase === 'overdue' && nextDays != null
                    ? `${Math.abs(nextDays)} day${Math.abs(nextDays) === 1 ? '' : 's'} overdue`
                    : nextDays === 0
                      ? 'Due today'
                      : nextDays != null && nextDays < 30
                        ? `Due in ${nextDays} day${nextDays === 1 ? '' : 's'}`
                        : `Due ${nextDeadline.due_date}`}
                </Text>
              </>
            ) : (
              <Text style={s.muted}>
                No reminders yet. Add registration, licence or insurance dates and Vehitra plans
                notices on this device.
              </Text>
            )}
            <TouchableOpacity
              style={s.btnGhost}
              onPress={() => navigation.navigate('Deadlines')}
              accessibilityRole="button"
            >
              <Text style={s.btnGhostTxt}>Open reminders</Text>
            </TouchableOpacity>
          </View>

          <View style={s.card}>
            <Text style={[s.cardTitle, easy && s.easyHeading]}>Maintenance</Text>
            {!vehicle ? (
              <Text style={s.muted}>Add a vehicle in the garage to see its maintenance plan.</Text>
            ) : maintFailed ? (
              <Text style={s.muted}>
                Maintenance could not be evaluated on this device right now. Open Parts &amp;
                maintenance to retry.
              </Text>
            ) : maintItems.length === 0 ? (
              <Text style={s.muted}>No maintenance plan for this vehicle yet.</Text>
            ) : overdueCount > 0 || dueSoonCount > 0 ? (
              <Text style={[s.statusLine, overdueCount > 0 ? s.statusBad : s.statusWarn]}>
                {overdueCount > 0 ? `${overdueCount} overdue` : null}
                {overdueCount > 0 && dueSoonCount > 0 ? ' · ' : null}
                {dueSoonCount > 0 ? `${dueSoonCount} due soon` : null}
              </Text>
            ) : unknownCount > 0 ? (
              <Text style={[s.statusLine, s.statusWarn]}>
                {unknownCount} check{unknownCount === 1 ? '' : 's'} need more data — not counted
                as good.
              </Text>
            ) : (
              <Text style={s.muted}>All checks good for now.</Text>
            )}
            <TouchableOpacity
              style={s.btnGhost}
              onPress={() => navigation.navigate('Parts')}
              accessibilityRole="button"
            >
              <Text style={s.btnGhostTxt}>Open parts & maintenance</Text>
            </TouchableOpacity>
          </View>

          <View style={s.card}>
            <Text style={[s.cardTitle, easy && s.easyHeading]}>Garage</Text>
            <Text style={s.muted}>
              Save your vehicles, nicknames and plates. Stored on this device, so it works offline.
            </Text>
            <TouchableOpacity
              style={s.btnGhost}
              onPress={() => navigation.navigate('Garage')}
              accessibilityRole="button"
            >
              <Text style={s.btnGhostTxt}>Open garage</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  activeCard: {
    backgroundColor: colors.surface,
    borderColor: colors.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  errorCard: { borderColor: colors.danger },
  kicker: { ...typography.caption, color: colors.primary, letterSpacing: 1.5, fontWeight: '700' },
  cardTitle: { ...typography.heading, fontSize: 16, marginTop: spacing.xs, marginBottom: spacing.md },
  activeVehicle: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.sm },
  muted: { ...typography.body, color: colors.textMuted, lineHeight: 20 },
  metrics: { flexDirection: 'row' },
  metric: { flex: 1 },
  metricValue: { ...typography.title, fontSize: 22 },
  metricLabel: { ...typography.caption, marginTop: spacing.xs },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  btnTxt: { ...typography.body, color: colors.text, fontWeight: '700' },
  btnGhost: {
    alignSelf: 'flex-start',
    borderColor: colors.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  btnGhostTxt: { ...typography.body, color: colors.primary, fontWeight: '600' },
  // Easy mode: larger, plainer — the same layout with bigger key text.
  easyMetric: { fontSize: 26 },
  easyHeading: { fontSize: 19 },
  easyBody: { fontSize: 17 },
  statusLine: { ...typography.label, marginTop: spacing.xs },
  statusBad: { color: colors.danger },
  statusWarn: { color: colors.warningText },
});
