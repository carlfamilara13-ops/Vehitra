import React, { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getDb } from '../../data/local/db';
import { getActiveRideId, getRide, listRides, type RideRow } from '../../data/local/ridesStore';
import { getActiveVehicle, type VehicleRow } from '../../data/local/vehicleStore';
import { getBatteryState, type BatteryStateRow } from '../../data/local/batteryStore';
import { listAllDeadlines, type DeadlineRow } from '../../data/local/deadlineStore';
import { getDriverProfile, type DriverProfileRow } from '../../data/local/driverProfileStore';
import { evaluateVehicleMaintenance, type VehicleMaintenance } from '../../data/local/maintenanceQuery';
import { daysUntilDateOnly, deadlinePhase, pickNextReminder } from '../../domain/reminders/dates';
import { batteryIdleDays, batteryIdleLevel, type BatteryIdleLevel } from '../../domain/battery/idle';
import type { ActivityRide } from '../../domain/dashboard/activity';
import { buildWalletDocs } from '../../domain/dashboard/wallet';
import { maintenanceLine } from '../record/garageView';
import Screen from '../../ui/Screen';
import { tabBarBottomClearance } from '../../ui/tabBarLayout';
import type { RootTabParamList } from '../../app/RootNavigator';
import { usePrefs } from '../../app/prefs';
import DashboardHeader from './DashboardHeader';
import ActiveRideCard from './ActiveRideCard';
import WeeklyActivityCard from './WeeklyActivityCard';
import DocumentWalletCard from './DocumentWalletCard';
import DriverProfileEditModal from './DriverProfileEditModal';
import LongestRidesCard from './LongestRidesCard';
import VehicleStatusStrip, { batteryTone, maintenanceTone, type StatusStripItem } from './VehicleStatusStrip';

type Props = BottomTabScreenProps<RootTabParamList, 'Dashboard'>;

// Totals are derived from the existing listRides API. Local data only; the cap is a
// guardrail, not a schema change.
const RIDE_LIST_LIMIT = 1000;

// Dashboard. Reads only local stores: rides, active vehicle battery check-in, enabled
// reminders and the maintenance evaluation for the active vehicle. Everything shown exists —
// nothing is faked, and a piece with no data says so instead of hiding.
//
// The screen is composed from the section components that ship with it (header, live ride,
// weekly activity, document wallet, longest rides, vehicle status); each one owns its own
// empty state, so a section with no data reports that rather than disappearing.

// ---------------------------------------------------------------- helpers

function vehicleName(vehicle: VehicleRow | null): string | null {
  if (!vehicle) return null;
  return vehicle.nickname ?? vehicle.model ?? vehicle.brand ?? null;
}

// The battery cell states the idle level in words: the app cannot measure battery condition,
// only how long the user has gone without confirming the bike was in use.
function batteryDetail(level: BatteryIdleLevel, idleDays: number | null): string {
  if (level === 'warn') return 'Idle over a week';
  if (level === 'watch') return idleDays == null ? 'Idle — worth a check' : `Idle ${idleDays} days`;
  return idleDays == null ? 'In use recently' : `Used ${idleDays === 0 ? 'today' : `${idleDays} days ago`}`;
}

// The maintenance cell reports the worst outstanding condition, and never folds "unknown" into
// "good": the rules refuse to call an unmeasurable check healthy, so the strip keeps that
// distinction visible.
function maintenanceDetail(maintenance: VehicleMaintenance | null, failed: boolean): string {
  if (failed) return 'Could not check';
  if (!maintenance) return 'No vehicle';
  return maintenanceLine(maintenance.items) ?? 'No plan yet';
}

function maintenanceToneFor(maintenance: VehicleMaintenance | null, failed: boolean): StatusStripItem['tone'] {
  if (failed || !maintenance) return 'unknown';
  const items = maintenance.items;
  if (items.length === 0) return 'unknown';
  const tones = items.map((i) => maintenanceTone(i.evaluation.status));
  if (tones.includes('bad')) return 'bad';
  if (tones.includes('watch')) return 'watch';
  if (tones.includes('unknown')) return 'unknown';
  return 'ok';
}

// ---------------------------------------------------------------- screen

export default function DashboardScreen({ navigation }: Props) {
  const prefs = usePrefs();
  const units = prefs.units;
  const insets = useSafeAreaInsets();
  const [active, setActive] = useState<RideRow | null>(null);
  const [rides, setRides] = useState<RideRow[]>([]);
  const [vehicle, setVehicle] = useState<VehicleRow | null>(null);
  const [battery, setBattery] = useState<BatteryStateRow | null>(null);
  const [deadlines, setDeadlines] = useState<DeadlineRow[]>([]);
  const [profile, setProfile] = useState<DriverProfileRow | null>(null);
  const [profileFailed, setProfileFailed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
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
    } catch {
      // The dashboard stays usable without the ride list: the sections that need it report
      // their own empty state instead of the whole screen failing.
      setActive(null);
      setRides([]);
    }
    try {
      const db = await getDb();
      const activeVehicle = await getActiveVehicle(db);
      // The profile is independent of the vehicle/reminders read: a failure here leaves the
      // card in its empty state without hiding the rest of the wallet.
      let driverProfile: DriverProfileRow | null = null;
      let profileError = false;
      try {
        driverProfile = await getDriverProfile(db);
      } catch {
        profileError = true;
      }
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
      setProfile(driverProfile);
      setProfileFailed(profileError);
      setMaintenance(maint);
      setMaintFailed(maintError);
    } catch {
      setVehicle(null);
      setBattery(null);
      setDeadlines([]);
      setProfile(null);
      setProfileFailed(true);
      setMaintenance(null);
      setMaintFailed(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // The weekly hero counts saved rides only; a ride still recording is not a record yet.
  const activityRides = useMemo<ActivityRide[]>(
    () =>
      rides.map((r) => ({
        startedAt: r.started_at,
        status: r.status,
        distanceM: r.distance_m,
        durationS: r.duration_s,
      })),
    [rides],
  );

  // Only finalized rides count towards the ranked longest rides.
  const savedRides = useMemo(() => rides.filter((r) => r.status !== 'recording'), [rides]);

  const docs = useMemo(
    () =>
      buildWalletDocs(
        deadlines,
        vehicle ? { name: vehicleName(vehicle), plate: vehicle.plate } : null,
        Date.now(),
      ),
    [deadlines, vehicle],
  );

  // Nearest reminder the user should still see. listAllDeadlines includes disabled and
  // soft-deleted rows on purpose (sync needs full state), so visibility is applied here.
  const nextDeadline = useMemo(() => pickNextReminder(deadlines), [deadlines]);
  const nextDays = nextDeadline ? daysUntilDateOnly(nextDeadline.due_date, Date.now()) : null;
  const nextPhase = deadlinePhase(nextDays);

  const statusItems = useMemo<StatusStripItem[]>(() => {
    const items: StatusStripItem[] = [];

    const idleDays = battery ? batteryIdleDays(battery.last_active_at, Date.now()) : null;
    const level = batteryIdleLevel(idleDays);
    items.push({
      key: 'battery',
      label: 'Battery',
      detail: batteryDetail(level, idleDays),
      tone: batteryTone(level),
      icon: 'battery-charging-outline',
    });

    items.push({
      key: 'maintenance',
      label: 'Maintenance',
      detail: maintenanceDetail(maintenance, maintFailed),
      tone: maintFailed ? 'unknown' : maintenanceToneFor(maintenance, maintFailed),
      icon: 'construct-outline',
    });

    items.push({
      key: 'reminder',
      label: 'Reminder',
      detail: nextDeadline
        ? nextPhase === 'overdue' && nextDays != null
          ? `${Math.abs(nextDays)}d overdue`
          : nextDays === 0
            ? 'Due today'
            : nextDays != null && nextDays < 30
              ? `In ${nextDays}d`
              : nextDeadline.due_date
        : 'None set',
      tone:
        nextPhase === 'overdue' ? 'bad' : nextPhase === 'due_soon' ? 'watch' : nextPhase === 'upcoming' ? 'ok' : 'unknown',
      icon: 'notifications-outline',
    });

    return items;
  }, [battery, maintenance, maintFailed, nextDeadline, nextDays, nextPhase]);

  return (
    <Screen contentStyle={{ paddingBottom: tabBarBottomClearance(insets.bottom) }}>
      <DashboardHeader onPressProfile={() => navigation.navigate('Account')} />
      {active ? (
        <ActiveRideCard
          ride={active}
          units={units}
          onOpenRecorder={() => navigation.navigate('Record')}
        />
      ) : null}
      <WeeklyActivityCard rides={activityRides} units={units} nowMs={Date.now()} />
      <DocumentWalletCard
        docs={docs}
        profile={profile}
        profileUnavailable={profileFailed}
        onEditProfile={() => setProfileOpen(true)}
        onManage={() => navigation.navigate('Deadlines')}
      />
      <LongestRidesCard
        rides={savedRides}
        units={units}
        onOpenRide={(id) => navigation.navigate('RideDetail', { id })}
      />
      <VehicleStatusStrip
        vehicleName={vehicleName(vehicle)}
        items={statusItems}
        onOpenVehicle={() => navigation.navigate('Garage')}
      />
      <DriverProfileEditModal
        visible={profileOpen}
        profile={profile}
        onCancel={() => setProfileOpen(false)}
        onSaved={(saved) => {
          setProfile(saved);
          setProfileFailed(false);
          setProfileOpen(false);
        }}
      />
    </Screen>
  );
}
