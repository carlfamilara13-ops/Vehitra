import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  StyleSheet,
} from 'react-native';
import { TouchableOpacity, View } from '../../ui/neu/NeuAuto';
import { Text } from '../../ui/neu/NeuText';
import { useFocusEffect } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getDb } from '../../data/local/db';
import {
  getActiveRideId,
  getRide,
  getLatestUsableSpeed,
  type RideRow,
} from '../../data/local/ridesStore';

import {
  getActiveVehicle,
  getActiveVehicleId,
  listVehicles,
  setActiveVehicle,
  vehicleDisplayName,
  type VehicleRow,
} from '../../data/local/vehicleStore';

import {
  listAllDeadlines,
  type DeadlineRow,
} from '../../data/local/deadlineStore';

import {
  evaluateVehicleMaintenance,
  type ComponentMaintenance,
} from '../../data/local/maintenanceQuery';

import Screen from '../../ui/Screen';
import Placeholder from '../../ui/Placeholder';
import { colors, radii, spacing, typography } from '../../ui/theme';
import { tabBarBottomClearance } from '../../ui/tabBarLayout';
import type { RootTabParamList } from '../../app/RootNavigator';

import { ensurePermissions } from '../rides/tracking/permissions';
import { runStartFlow } from '../rides/tracking/startFlow';
import {
  resumeIfInterrupted,
  startRide,
  stopRide,
} from '../rides/tracking/tracker';

import GarageHeader from './GarageHeader';
import OdometerSheet from './OdometerSheet';
import SelectedVehicleCard from './SelectedVehicleCard';
import VehicleShowroom from './VehicleShowroom';

import {
  maintenanceCondition,
  nextReminderForVehicle,
  vehicleStats,
} from './garageView';

type Props = BottomTabScreenProps<RootTabParamList, 'Record'>;

type Blocked = {
  message: string;
  canAskAgain: boolean;
};

const errText = (e: unknown) =>
  e instanceof Error ? e.message : String(e);

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

  // Live tracking display
  const [liveSpeedKmh, setLiveSpeedKmh] = useState(0);
  const [rideClock, setRideClock] = useState(Date.now());
  const [trackingModalMinimized, setTrackingModalMinimized] =
    useState(false);

  // The vehicle the card below describes.
  const selected = useMemo(
    () => vehicles.find((v) => v.id === selectedId) ?? vehicles[0] ?? null,
    [vehicles, selectedId],
  );

  const load = useCallback(async () => {
    try {
      const db = await getDb();

      const [list, activeId] = await Promise.all([
        listVehicles(db),
        getActiveVehicleId(db),
      ]);

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

  // Maintenance and reminders follow the selected vehicle.
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

      void resumeIfInterrupted()
        .then(load)
        .catch(() => undefined);
    }, [load]),
  );

  useEffect(() => {
    void loadDetails();
  }, [loadDetails]);

  // Active ride information
  const rideId = activeRide?.id ?? null;
  const rideDistanceKm = (activeRide?.distance_m ?? 0) / 1000;

  const rideElapsedSeconds = activeRide
    ? Math.max(
        0,
        Math.floor((rideClock - activeRide.started_at) / 1000),
      )
    : 0;

  const formatRideTime = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return [hours, minutes, seconds]
      .map((value) => String(value).padStart(2, '0'))
      .join(':');
  };

  // Reset the minimized state after a ride ends.
  useEffect(() => {
    if (!rideId) {
      setTrackingModalMinimized(false);
    }
  }, [rideId]);

  // Poll the active ride for updated distance.
  useEffect(() => {
    if (!rideId) return;

    const timer = setInterval(() => {
      void (async () => {
        try {
          const db = await getDb();
          const id = await getActiveRideId(db);

          setActiveRide(id ? await getRide(db, id) : null);
        } catch {
          // Keep the last known ride information.
        }
      })();
    }, 1000);

    return () => clearInterval(timer);
  }, [rideId]);

  // Refresh elapsed time every second.
  useEffect(() => {
    if (!rideId) return;

    const timer = setInterval(() => {
      setRideClock(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, [rideId]);

  // Read the latest usable GPS speed.
  // GPS speed is stored in m/s, so convert it to km/h.
  useEffect(() => {
    if (!rideId) {
      setLiveSpeedKmh(0);
      return;
    }

    let cancelled = false;

    const updateSpeed = async () => {
      try {
        const db = await getDb();
        const reading = await getLatestUsableSpeed(db, rideId);

        if (cancelled) return;

        const isFresh =
          reading !== null &&
          Date.now() - reading.timestamp <= 2000 &&
          Date.now() >= reading.timestamp;

        if (!isFresh || reading.speed_ms === null) {
          setLiveSpeedKmh(0);
          return;
        }

        setLiveSpeedKmh(
          Math.max(0, reading.speed_ms * 3.6),
        );
      } catch {
        if (!cancelled) {
          setLiveSpeedKmh(0);
        }
      }
    };

    void updateSpeed();

    const timer = setInterval(() => {
      void updateSpeed();
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [rideId]);

  // Select a vehicle from the showroom.
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

  // Start tracking.
  const onStart = async () => {
    if (busy) return;

    setBusy(true);

    try {
      const out = await runStartFlow({
        ensurePermissions,

        startRide: async () => {
          const db = await getDb();
          const vehicle = await getActiveVehicle(db);

          return startRide(
            vehicle?.id ?? null,
            vehicle ? vehicleDisplayName(vehicle) : null,
          );
        },
      });

      if (out.status === 'started') {
        setRideClock(Date.now());
        setTrackingModalMinimized(false);
        setBlocked(null);
        setWarnings(out.warnings);
        setMsg('');
      } else if (out.status === 'blocked') {
        setBlocked({
          message: out.message,
          canAskAgain: out.canAskAgain,
        });

        setMsg('');
      } else {
        setMsg(out.message);
      }
    } finally {
      setBusy(false);
      await load().catch(() => undefined);
    }
  };

  // Stop tracking.
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
    navigation.navigate('Parts');
  }, [navigation]);

  // Open the Garage when the center vehicle is pressed.
  const onPressVehicle = useCallback(() => {
    navigation.navigate('Garage');
  }, [navigation]);

  // Maintenance information.
  const nextReminder = useMemo(
    () => nextReminderForVehicle(deadlines, selected?.id ?? null),
    [deadlines, selected],
  );

  const condition = useMemo(
    () => maintenanceCondition(maintenance),
    [maintenance],
  );

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
    <>
      <Screen
        title="Record"
        subtitle="Your garage"
        right={
          <GarageHeader
            onAddVehicle={() => navigation.navigate('VehicleLibrary')}
          />
        }
        contentStyle={{
          paddingBottom:
            tabBarBottomClearance(insets.bottom) + spacing.lg,
        }}
      >
        {/* Permission warning */}
        {blocked && (
          <View style={s.warn}>
            <Text style={s.warnText}>{blocked.message}</Text>

            {!blocked.canAskAgain && (
              <Text style={s.warnHint}>
                Android will not show the permission prompt again.
                Allow location "all the time" in app settings, then return.
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

        {/* Warnings */}
        {warnings.map((w) => (
          <Text key={w} style={s.hint}>
            {w}
          </Text>
        ))}

        {/* Error */}
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

        {/* Minimized tracking banner */}
        {activeRide && trackingModalMinimized && (
          <TouchableOpacity
            style={s.activeRideBanner}
            onPress={() => setTrackingModalMinimized(false)}
            accessibilityRole="button"
            accessibilityLabel="Reopen live ride tracking"
          >
            <View style={s.activeRideDot} />

            <View style={s.activeRideBannerContent}>
              <Text style={s.activeRideBannerTitle}>
                LIVE RIDE
              </Text>

              <Text style={s.activeRideBannerSubtitle}>
                {rideDistanceKm.toFixed(2)} km ·{' '}
                {formatRideTime(rideElapsedSeconds)}
              </Text>
            </View>

            <Text style={s.activeRideBannerAction}>
              OPEN
            </Text>
          </TouchableOpacity>
        )}

        {/* Main Record screen */}
        {loading ? (
          <ActivityIndicator
            color={colors.primary}
            style={s.loading}
          />
        ) : vehicles.length === 0 ? (
          <>
            <Placeholder
              title="No vehicles yet"
              message="Add a vehicle to record your rides against it. Everything is stored on this device, so it works offline."
            />

            {activeRide ? (
              <TouchableOpacity
                style={s.startBtn}
                onPress={onStop}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Stop ride"
              >
                <Text style={s.startBtnTxt}>
                  STOP RIDE
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={s.startBtn}
                onPress={onStart}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Start a ride"
              >
                <Text style={s.startBtnTxt}>
                  START A RIDE
                </Text>
              </TouchableOpacity>
            )}
          </>
        ) : (
          <>
            <VehicleShowroom
              vehicles={vehicles}
              selectedId={selected?.id ?? null}
              onSelect={(v) => void selectVehicle(v)}
              onPressVehicle={onPressVehicle}
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

        {!!msg && (
          <Text style={s.hint}>{msg}</Text>
        )}

        <OdometerSheet
          visible={odometerOpen}
          vehicle={selected}
          onSaved={() => void load()}
          onClose={() => setOdometerOpen(false)}
        />
      </Screen>

      {/* Full-screen live tracking modal */}
      <Modal
        visible={!!activeRide && !trackingModalMinimized}
        animationType="slide"
        presentationStyle="fullScreen"
        statusBarTranslucent
        onRequestClose={() => setTrackingModalMinimized(true)}
      >
        <View
          style={[
            s.trackingModal,
            {
              paddingTop: insets.top + spacing.lg,
              paddingBottom: insets.bottom + spacing.lg,
            },
          ]}
        >
          {/* Header */}
          <View style={s.trackingHeader}>
            <View>
              <Text style={s.trackingEyebrow}>
                VEHITRA
              </Text>

              <Text style={s.trackingTitle}>
                LIVE TRACKING
              </Text>
            </View>

            <TouchableOpacity
              style={s.minimizeButton}
              onPress={() => setTrackingModalMinimized(true)}
              accessibilityRole="button"
              accessibilityLabel="Minimize tracking"
            >
              <Text style={s.minimizeButtonText}>
                −
              </Text>
            </TouchableOpacity>
          </View>

          {/* Recording status */}
          <View style={s.recordingStatus}>
            <View style={s.recordingDot} />

            <Text style={s.recordingStatusText}>
              {activeRide?.status === 'recovered'
                ? 'RIDE RECOVERED'
                : 'RECORDING'}
            </Text>
          </View>

          {/* Digital speed display */}
          <View style={s.speedSection}>
            <View style={s.speedPanel}>
              <Text style={s.speedLabel}>
                CURRENT SPEED
              </Text>

              <View style={s.speedValueRow}>
                <Text style={s.speedValue}>
                  {Math.round(liveSpeedKmh)}
                </Text>

                <Text style={s.speedUnit}>
                  km/h
                </Text>
              </View>

              <View style={s.speedIndicator}>
                <View
                  style={[
                    s.speedIndicatorFill,
                    {
                      width: `${Math.min(
                        liveSpeedKmh / 2,
                        100,
                      )}%`,
                    },
                  ]}
                />
              </View>
            </View>
          </View>

          {/* Ride statistics */}
          <View style={s.rideStats}>
            <View style={s.rideStatCard}>
              <Text style={s.rideStatLabel}>
                DISTANCE
              </Text>

              <Text style={s.rideStatValue}>
                {rideDistanceKm.toFixed(2)}
              </Text>

              <Text style={s.rideStatUnit}>
                KILOMETERS
              </Text>
            </View>

            <View style={s.rideStatCard}>
              <Text style={s.rideStatLabel}>
                ELAPSED TIME
              </Text>

              <Text style={s.rideTimeValue}>
                {formatRideTime(rideElapsedSeconds)}
              </Text>

              <Text style={s.rideStatUnit}>
                HH : MM : SS
              </Text>
            </View>
          </View>

          {/* Stop tracking */}
          <View style={s.trackingFooter}>
            <TouchableOpacity
              style={s.stopTrackingButton}
              onPress={onStop}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Stop tracking"
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={s.stopTrackingText}>
                  STOP TRACKING
                </Text>
              )}
            </TouchableOpacity>

            <Text style={s.trackingFooterHint}>
              Your ride is being recorded on this device.
            </Text>
          </View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  loading: {
    marginTop: spacing.xl,
  },

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

  warnText: {
    ...typography.body,
  },

  warnHint: {
    ...typography.caption,
    marginTop: spacing.sm,
    lineHeight: 18,
  },

  hint: {
    ...typography.caption,
    marginVertical: spacing.xs,
  },

  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },

  btnGhost: {
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginRight: spacing.sm,
    marginTop: spacing.sm,
  },

  btnGhostTxt: {
    ...typography.label,
    color: colors.primaryBright,
    fontWeight: '600',
  },

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

  startBtnTxt: {
    ...typography.body,
    color: colors.primaryInk,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Minimized live ride banner
  activeRideBanner: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
  },

  activeRideDot: {
    width: 9,
    height: 9,
    borderRadius: 99,
    backgroundColor: colors.success,
    marginRight: spacing.md,
  },

  activeRideBannerContent: {
    flex: 1,
  },

  activeRideBannerTitle: {
    ...typography.label,
    color: colors.text,
  },

  activeRideBannerSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },

  activeRideBannerAction: {
    ...typography.label,
    color: colors.primaryBright,
  },

  // Full-screen tracking modal
  trackingModal: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
  },

  trackingHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  trackingEyebrow: {
    ...typography.caption,
    color: colors.primaryBright,
    letterSpacing: 2,
  },

  trackingTitle: {
    ...typography.heading,
    color: colors.text,
    marginTop: 2,
  },

  minimizeButton: {
    backgroundColor: colors.surface,
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  minimizeButtonText: {
    fontSize: 30,
    lineHeight: 34,
    color: colors.text,
  },

  recordingStatus: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xxl,
  },

  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 99,
    backgroundColor: colors.success,
    marginRight: spacing.sm,
  },

  recordingStatusText: {
    ...typography.caption,
    color: colors.success,
    letterSpacing: 1,
  },

  speedSection: {
    flex: 1,
    justifyContent: 'center',
  },

  speedPanel: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },

  speedLabel: {
    ...typography.label,
    color: colors.textMuted,
    letterSpacing: 2,
  },

  speedValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    marginTop: spacing.md,
  },

  speedValue: {
    fontFamily: 'Rajdhani_700Bold',
    fontSize: 112,
    lineHeight: 120,
    color: colors.primaryBright,
    fontVariant: ['tabular-nums'],
  },

  speedUnit: {
    ...typography.body,
    fontWeight: '600',
    marginLeft: spacing.sm,
  },

  speedIndicator: {
    height: 5,
    width: '75%',
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
    marginTop: spacing.xl,
  },

  speedIndicatorFill: {
    height: '100%',
    backgroundColor: colors.primaryBright,
    borderRadius: radii.pill,
  },

  rideStats: {
    flexDirection: 'row',
    gap: spacing.md,
  },

  rideStatCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    alignItems: 'center',
  },

  rideStatLabel: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 1,
  },

  rideStatValue: {
    ...typography.heading,
    color: colors.text,
    fontSize: 27,
    marginTop: spacing.sm,
  },

  rideTimeValue: {
    ...typography.heading,
    color: colors.text,
    fontSize: 21,
    marginTop: spacing.sm,
    fontVariant: ['tabular-nums'],
  },

  rideStatUnit: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },

  trackingFooter: {
    marginTop: spacing.xxl,
  },

  stopTrackingButton: {
    backgroundColor: '#FF4D6D',
    borderRadius: radii.lg,
    minHeight: 56,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.md,
  },

  stopTrackingText: {
    ...typography.body,
    color: '#FFFFFF',
    fontWeight: '700',
    letterSpacing: 1,
  },

  trackingFooterHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});