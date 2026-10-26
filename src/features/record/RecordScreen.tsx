import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getDb } from '../../data/local/db';
import { getActiveRideId, getRide, type RideRow } from '../../data/local/ridesStore';
import {
  getActiveVehicle,
  getActiveVehicleId,
  listVehicles,
  setActiveVehicle,
  vehicleDisplayName,
  type VehicleRow,
} from '../../data/local/vehicleStore';
import { listAllDeadlines, type DeadlineRow } from '../../data/local/deadlineStore';
import { evaluateVehicleMaintenance, type ComponentMaintenance } from '../../data/local/maintenanceQuery';
import Screen from '../../ui/Screen';
import Placeholder from '../../ui/Placeholder';
import { colors, radii, spacing, typography } from '../../ui/theme';
import { tabBarBottomClearance } from '../../ui/tabBarLayout';
import type { RootTabParamList } from '../../app/RootNavigator';
import { ensurePermissions } from '../rides/tracking/permissions';
import { runStartFlow } from '../rides/tracking/startFlow';
import { resumeIfInterrupted, startRide, stopRide } from '../rides/tracking/tracker';
import GarageHeader from './GarageHeader';
import OdometerSheet from './OdometerSheet';
import SelectedVehicleCard from './SelectedVehicleCard';
import VehicleShowroom from './VehicleShowroom';
import { maintenanceCondition, nextReminderForVehicle, vehicleStats } from './garageView';

const RECORD_BG = require('../../../assets/appBG.jpg');

type Props = BottomTabScreenProps<RootTabParamList, 'Record'>;

type Blocked = { message: string; canAskAgain: boolean };

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// The Record tab: the garage as the home of the recorder. The vehicle the user is looking at is
// the vehicle the ride is recorded against — selecting a page in the showroom persists it as the
// app's active vehicle, so the dashboard, Parts and every ride snapshot agree on one machine.
//
// The tracking engine itself is untouched: starting and stopping a ride goes through exactly the
// same flow the old recorder screen used (permission gate, vehicle snapshot, background task),
// and the internals stay inspectable from Settings > Diagnostics.
export default function RecordScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeRide, setActiveRide] = useState<RideRow | null>(null);
  const [maintenance, setMaintenance] = useState<ComponentMaintenance[]>([]);
  const [deadlines, setDeadlines] = useState<DeadlineRow[]>([]);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [odometerOpen, setOdometerOpen] = useState(false);

  // The vehicle the card below describes: the active one, or the first in the list when nothing is
  // active yet. The showroom opens on the same page either way.
  const selected = useMemo(
    () => vehicles.find((v) => v.id === selectedId) ?? vehicles[0] ?? null,
    [vehicles, selectedId],
  );

  const load = useCallback(async () => {
    try {
      const db = await getDb();
      const [list, activeId] = await Promise.all([listVehicles(db), getActiveVehicleId(db)]);
      const rideId = await getActiveRideId(db);
      const ride = rideId ? await getRide(db, rideId) : null;
      setVehicles(list);
      setSelectedId(activeId);
      setActiveRide(ride);
      setError(null);
    } catch (e) {
      setError(errText(e));
      setLoading(false);
      return;
    }
    setLoading(false);
  }, []);

  // Maintenance and reminders follow the selected vehicle. They are derived reads, so a failure
  // here leaves the card without those lines rather than blocking the whole screen.
  const loadDetails = useCallback(async () => {
    const vehicle = selected;
    if (!vehicle) {
      setMaintenance([]);
      setDeadlines([]);
      return;
    }
    try {
      const db = await getDb();
      const [model, rows] = await Promise.all([
        evaluateVehicleMaintenance(db, vehicle.id),
        listAllDeadlines(db),
      ]);
      setMaintenance(model?.items ?? []);
      setDeadlines(rows);
    } catch {
      setMaintenance([]);
      setDeadlines([]);
    }
  }, [selected]);

  useFocusEffect(
    useCallback(() => {
      void load();
      // A ride interrupted by a crash or a reboot is recovered on entry, exactly as the old
      // recorder screen did, so the distance on screen is never stale.
      void resumeIfInterrupted()
        .then(load)
        .catch(() => undefined);
    }, [load]),
  );

  useEffect(() => {
    void loadDetails();
  }, [loadDetails]);

  // While a ride is recording the card shows a live distance, so the ride is polled.
  const rideId = activeRide?.id ?? null;
  useEffect(() => {
    if (!rideId) return;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const db = await getDb();
          const id = await getActiveRideId(db);
          setActiveRide(id ? await getRide(db, id) : null);
        } catch {
          // A failed poll leaves the last known distance on screen.
        }
      })();
    }, 1000);
    return () => clearInterval(timer);
  }, [rideId]);

  // A swipe in the showroom settles on a new vehicle: it becomes the app's active vehicle, so the
  // ride that starts next is recorded against it.
  const selectVehicle = useCallback(async (vehicle: VehicleRow) => {
    setSelectedId(vehicle.id);
    try {
      const db = await getDb();
      await setActiveVehicle(db, vehicle.id);
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, []);

  const onStart = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const out = await runStartFlow({
        ensurePermissions,
        // Resolve the active vehicle once, immediately before recording starts (after any
        // permission prompt), so a selection changed while the prompt was open is respected.
        // No selection -> null.
        startRide: async () => {
          const db = await getDb();
          const vehicle = await getActiveVehicle(db);
          return startRide(vehicle?.id ?? null, vehicle ? vehicleDisplayName(vehicle) : null);
        },
      });
      if (out.status === 'started') {
        setBlocked(null);
        setWarnings(out.warnings);
        setMsg('');
      } else if (out.status === 'blocked') {
        setBlocked({ message: out.message, canAskAgain: out.canAskAgain });
        setMsg('');
      } else {
        setMsg(out.message);
      }
    } finally {
      setBusy(false);
      await load().catch(() => undefined);
    }
  };

  const onStop = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await stopRide('finished');
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
      await load().catch(() => undefined);
    }
  };

  const onMaintenance = useCallback(() => {
    // Parts reads the active vehicle, which this screen keeps in sync with the showroom.
    navigation.navigate('Parts');
  }, [navigation]);

  // The nearest reminder attached to this vehicle, and the condition + statistics the card
  // shows. Both are derived from the records already loaded — nothing is estimated here.
  const nextReminder = useMemo(
    () => nextReminderForVehicle(deadlines, selected?.id ?? null),
    [deadlines, selected],
  );

  const condition = useMemo(() => maintenanceCondition(maintenance), [maintenance]);

  const stats = useMemo(
    () =>
      vehicleStats({
        items: maintenance,
        reminder: nextReminder,
        nowMs: Date.now(),
        modelYear: selected?.model_year ?? null,
      }),
    [maintenance, nextReminder, selected],
  );

  return (
    <Screen
      title="Record"
      subtitle="Your garage"
      right={<GarageHeader onAddVehicle={() => navigation.navigate('VehicleLibrary')} />}
      contentStyle={{ paddingBottom: tabBarBottomClearance(insets.bottom) + spacing.lg }}
      backgroundImage={RECORD_BG}
      backgroundImageStyle={s.bgImage}
    >
      {blocked && (
        <View style={s.warn}>
          <Text style={s.warnText}>{blocked.message}</Text>
          {!blocked.canAskAgain && (
            <Text style={s.warnHint}>
              Android will not show the permission prompt again. Allow location "all the time" in app
              settings, then return.
            </Text>
          )}
          <View style={s.row}>
            <TouchableOpacity
              style={s.btnGhost}
              onPress={onStart}
              disabled={busy}
              accessibilityRole="button"
            >
              <Text style={s.btnGhostTxt}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.btnGhost}
              onPress={() => Linking.openSettings()}
              disabled={busy}
              accessibilityRole="button"
            >
              <Text style={s.btnGhostTxt}>Open settings</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {warnings.map((w) => (
        <Text key={w} style={s.hint}>
          {w}
        </Text>
      ))}

      {!!error && (
        <View style={s.errorCard}>
          <Text style={s.warnText}>{error}</Text>
          <TouchableOpacity
            style={s.btnGhost}
            onPress={() => void load()}
            accessibilityRole="button"
          >
            <Text style={s.btnGhostTxt}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={colors.primary} style={s.loading} />
      ) : vehicles.length === 0 ? (
        <>
          <Placeholder
            title="No vehicles yet"
            message="Add a vehicle to record your rides against it. Everything is stored on this device, so it works offline."
          />
          {/* A ride can still be recorded without a vehicle, exactly as it could before the
              garage moved into this tab — the vehicle is simply not attached to the ride. */}
          {activeRide ? (
            <TouchableOpacity
              style={s.startBtn}
              onPress={onStop}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Stop ride"
            >
              <Text style={s.startBtnTxt}>STOP RIDE</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={s.startBtn}
              onPress={onStart}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Start a ride"
            >
              <Text style={s.startBtnTxt}>START A RIDE</Text>
            </TouchableOpacity>
          )}
        </>
      ) : (
        <>
          <VehicleShowroom
            vehicles={vehicles}
            selectedId={selected?.id ?? null}
            onSelect={(v) => void selectVehicle(v)}
          />

          {selected && (
            <SelectedVehicleCard
              vehicle={selected}
              activeRide={activeRide}
              condition={condition}
              stats={stats}
              busy={busy}
              onStartTracking={onStart}
              onStopTracking={onStop}
              onManualInput={() => setOdometerOpen(true)}
              onMaintenance={onMaintenance}
            />
          )}
        </>
      )}

      {!!msg && <Text style={s.hint}>{msg}</Text>}

      <OdometerSheet
        visible={odometerOpen}
        vehicle={selected}
        onSaved={() => void load()}
        onClose={() => setOdometerOpen(false)}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  // Tweak these to fit your device/look:
  // - zoom: increase scale for "closer" crop, decrease for "further away" (e.g. 1.0, 1.1, 1.15)
  // - horizontal offset: translateX (negative moves left, positive moves right)
  // - vertical offset: translateY (negative moves up, positive moves down)
  bgImage: {
    transform: [{ scale: 0.4 }, { translateX: -1440 }, { translateY: -2550 }],
    opacity: 0.9,
  },
  loading: { marginTop: spacing.xl },
  warn: {
    backgroundColor: colors.warningSurface,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  errorCard: {
    backgroundColor: colors.surface,
    borderColor: colors.danger,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  warnText: { ...typography.body },
  warnHint: { ...typography.caption, marginTop: spacing.sm, lineHeight: 18 },
  hint: { ...typography.caption, marginVertical: spacing.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  btnGhost: {
    borderColor: colors.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginRight: spacing.sm,
    marginTop: spacing.sm,
  },
  btnGhostTxt: { ...typography.label, color: colors.primaryBright, fontWeight: '600' },
  startBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  startBtnTxt: { ...typography.body, color: colors.primaryInk, fontWeight: '700', letterSpacing: 0.5 },
});
