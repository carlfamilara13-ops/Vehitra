
import React, { useCallback, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  View as RNView,
} from 'react-native';
import { View } from '../../ui/neu/NeuAuto';
import { Text } from '../../ui/neu/NeuText';
import { useFocusEffect } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { getDb } from '../../data/local/db';
import { getRide, type RideRow } from '../../data/local/ridesStore';
import { getAppSettings, type UnitsPref } from '../../data/local/settingsStore';
import { decodePolyline, type LatLon } from '../../domain/ride/polyline';
import { formatDistanceM, formatSpeedMs, speedUnit, KM_PER_MILE } from '../../domain/units';
import type { Route } from '../../domain/ride/route';
import Screen from '../../ui/Screen';
import Placeholder from '../../ui/Placeholder';
import RideMapPreview from './RideMapPreview';
import { colors, radii, spacing, typography } from '../../ui/theme';
import type { RootTabParamList } from '../../app/RootNavigator';
import Svg, { Circle, Path, Line, Text as SvgText } from 'react-native-svg';

type Props = BottomTabScreenProps<RootTabParamList, 'RideDetail'>;

function duration(s: number | null): string {
  if (s == null) return ' ';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${sec}s`;
}

// Reads the persisted route: one encoded polyline per GPS segment.
function segmentsOf(ride: RideRow): LatLon[][] {
  if (!ride.route_segments) return [];

  try {
    const route = JSON.parse(ride.route_segments) as Route;
    if (!route || !Array.isArray(route.segments)) return [];

    return route.segments
      .map((segment) => decodePolyline(segment.polyline))
      .filter((points) => points.length > 1);
  } catch {
    return [];
  }
}

export default function RideDetailScreen({ navigation, route }: Props) {
  const rideId = route.params?.id;

  const [ride, setRide] = useState<RideRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [units, setUnits] = useState<UnitsPref>('metric');
  const [mapVisible, setMapVisible] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      (async () => {
        try {
          const db = await getDb();

          const [row, settings] = await Promise.all([
            rideId ? getRide(db, rideId) : Promise.resolve(null),
            getAppSettings(db),
          ]);

          if (cancelled) return;

          setRide(row);
          setUnits(settings.units);
        } catch {
          if (!cancelled) setRide(null);
        } finally {
          if (!cancelled) setLoaded(true);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [rideId]),
  );

  const segments = useMemo(
    () => (ride ? segmentsOf(ride) : []),
    [ride],
  );

  if (loaded && !ride) {
    return (
      <Screen title="Ride" subtitle={rideId ? undefined : 'Missing ride'}>
        <Placeholder
          title="Ride not found"
          message={
            rideId
              ? 'This ride is no longer stored on this device. It may have been deleted.'
              : 'Open a ride from the Rides list.'
          }
        />
      </Screen>
    );
  }

  const title = ride ? new Date(ride.started_at).toLocaleDateString() : 'Ride';
  const subtitle = ride ? new Date(ride.started_at).toLocaleTimeString() : 'Loading…';
  const speedLabel = speedUnit(units);

  const toDisplay = (kmh: number) =>
    units === 'imperial' ? kmh / KM_PER_MILE : kmh;

  const step = units === 'imperial' ? 10 : 20;
  const floor = units === 'imperial' ? 40 : 60;
  const margin = units === 'imperial' ? 5 : 10;

  const maxSpeedDisplay =
    ride && ride.max_speed_ms > 0 ? toDisplay(ride.max_speed_ms * 3.6) : 0;

  const dialMax = Math.max(
    floor,
    Math.ceil((maxSpeedDisplay + margin) / step) * step,
  );

  const avgDisplay =
    ride?.avg_speed_ms != null
      ? toDisplay(ride.avg_speed_ms * 3.6)
      : 0;

  return (
    <Screen title={title} subtitle={subtitle}>
      {ride && (
        <>
          <View style={s.statusRow}>
            <Text style={[s.badge, ride.status === 'recording' && s.badgeActive]}>
              {ride.status === 'recording'
                ? 'Recording'
                : ride.status === 'recovered'
                  ? 'Recovered'
                  : 'Finished'}
            </Text>
            <Text style={s.vehicle}>{ride.vehicle_name ?? 'No vehicle'}</Text>
          </View>

          <View style={s.grid}>
            <Metric value={formatDistanceM(ride.distance_m, units, { decimals: 2 })} label="Distance" />
            <Metric value={duration(ride.duration_s ?? ride.tracked_s)} label="Duration" />
            <Metric value={formatSpeedMs(ride.avg_speed_ms, units)} label="Avg speed" />
            <Metric value={formatSpeedMs(ride.max_speed_ms, units)} label="Max speed" />
            <Metric value={duration(ride.tracked_s)} label="Tracked" />
            <Metric value={String(ride.point_count)} label="Points" />
          </View>

          <View style={s.card}>
            <Text style={s.cardTitle}>Speed</Text>
            <SpeedDial
              value={avgDisplay}
              max={dialMax}
              maxLabel={`${Math.round(dialMax)}`}
              valueLabel={formatSpeedMs(ride.avg_speed_ms, units)}
              subLabel={`Max ${formatSpeedMs(ride.max_speed_ms, units)}`}
              speedLabel={speedLabel}
            />
            {ride.avg_speed_ms == null && (
              <Text style={s.note}>
                Average speed appears once a ride has enough tracked time.
              </Text>
            )}
          </View>

          <View style={s.card}>
            <Text style={s.cardTitle}>Route</Text>

            {segments.length > 0 ? (
              <>
                <Pressable
                  onPress={() => setMapVisible(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Open interactive ride map"
                  style={s.mapPreviewButton}
                >
                  <RideMapPreview
                    segments={segments}
                    containerStyle={s.mapPreview}
                  />
                  <View style={s.mapExpandHint}>
                    <Text style={s.mapExpandText}>Tap to explore map</Text>
                  </View>
                </Pressable>

                <Text style={s.sketchNote}>
                  {segments.reduce((total, segment) => total + segment.length, 0)} route points · Tap the map to explore
                </Text>
              </>
            ) : (
              <RideMapPreview
                segments={segments}
                emptyLabel={
                  ride.point_count === 0
                    ? 'No GPS points were recorded for this ride.'
                    : 'No usable route was recorded for this ride.'
                }
                containerStyle={s.emptyMap}
              />
            )}
          </View>

          {(ride.needs_review === 1 || ride.integrity_issue || ride.interrupted === 1) && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Data quality</Text>
              {ride.integrity_issue && (
                <Text style={s.warnText}>{ride.integrity_issue}</Text>
              )}
              {ride.needs_review === 1 && !ride.integrity_issue && (
                <Text style={s.warnText}>This ride was flagged for review.</Text>
              )}
              {ride.interrupted === 1 && (
                <Text style={s.note}>
                  Tracking was interrupted {ride.interruption_count} time(s)
                  {ride.interruption_s > 0
                    ? ` (${duration(ride.interruption_s)} total)`
                    : ''}.
                </Text>
              )}
              <Text style={s.note}>
                Untracked gaps: {duration(ride.untracked_gap_s)} · Longest gap:{' '}
                {duration(ride.max_gap_s)}.
              </Text>
            </View>
          )}

          <Modal
            visible={mapVisible}
            animationType="slide"
            presentationStyle="fullScreen"
            onRequestClose={() => setMapVisible(false)}
          >
            <RNView style={s.mapModal}>
              <RNView style={s.mapModalHeader}>
                <RNView style={s.mapModalHeading}>
                  <Text style={s.mapModalTitle}>Ride route</Text>
                  <Text style={s.mapModalSubtitle}>
                    {title} · {subtitle}
                  </Text>
                </RNView>

                <Pressable
                  onPress={() => setMapVisible(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Close map"
                  hitSlop={12}
                  style={s.mapCloseButton}
                >
                  <Text style={s.mapCloseText}>×</Text>
                </Pressable>
              </RNView>

              <RideMapPreview
                segments={segments}
                interactive
                containerStyle={s.fullMap}
              />

              <RNView style={s.mapModalFooter}>
                <Text style={s.mapModalHint}>
                  Drag to move · Pinch to zoom · Rotate with two fingers
                </Text>
              </RNView>
            </RNView>
          </Modal>
        </>
      )}
    </Screen>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <View style={s.metric}>
      <Text style={s.metricValue}>{value}</Text>
      <Text style={s.metricLabel}>{label}</Text>
    </View>
  );
}

function SpeedDial({
  value,
  max,
  valueLabel,
  subLabel,
  maxLabel,
  speedLabel,
}: {
  value: number;
  max: number;
  valueLabel: string;
  subLabel: string;
  maxLabel: string;
  speedLabel: string;
}) {
  const width = 240;
  const height = 140;
  const cx = width / 2;
  const cy = height - 16;
  const r = 96;

  const fraction = max > 0 ? Math.min(Math.max(value / max, 0), 1) : 0;
  const startDeg = 180;
  const endDeg = 360;
  const valueDeg = startDeg + fraction * 180;

  const polar = (deg: number, radius: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  };

  const arc = (from: number, to: number) => {
    const a = polar(from, r);
    const b = polar(to, r);
    const largeArc = Math.abs(to - from) > 180 ? 1 : 0;
    return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} A ${r} ${r} 0 ${largeArc} 1 ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  };

  const needle = polar(valueDeg, r - 14);

  return (
    <View style={s.dialWrap}>
      <Svg width={width} height={height}>
        <Path d={arc(startDeg, endDeg)} stroke={colors.border} strokeWidth={12} fill="none" strokeLinecap="round" />
        {fraction > 0 && (
          <Path d={arc(startDeg, valueDeg)} stroke={colors.primary} strokeWidth={12} fill="none" strokeLinecap="round" />
        )}
        <Line x1={cx} y1={cy} x2={needle.x} y2={needle.y} stroke={colors.text} strokeWidth={3} strokeLinecap="round" />
        <Circle cx={cx} cy={cy} r={6} fill={colors.primary} />
        <SvgText x={cx - r} y={cy + 16} fontSize={11} fill={colors.textMuted} textAnchor="middle">
          0
        </SvgText>
        <SvgText x={cx + r} y={cy + 16} fontSize={11} fill={colors.textMuted} textAnchor="middle">
          {maxLabel}
        </SvgText>
      </Svg>
      <View style={s.dialCenter}>
        <Text style={s.dialValue}>{valueLabel}</Text>
        <Text style={s.dialSub}>{subLabel}</Text>
        <Text style={s.dialUnit}>avg · {speedLabel}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  badge: {
    ...typography.caption,
    color: colors.textMuted,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    overflow: 'hidden',
  },
  badgeActive: {
    color: colors.background,
    backgroundColor: colors.primary,
    fontWeight: '700',
  },
  vehicle: { ...typography.caption },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.lg },
  metric: { width: '33.33%', marginBottom: spacing.lg },
  metricValue: { ...typography.body, fontWeight: '700' },
  metricLabel: { ...typography.caption, marginTop: spacing.xs },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  cardTitle: { ...typography.label, marginBottom: spacing.md },
  note: { ...typography.caption, marginTop: spacing.xs, lineHeight: 18 },
  warnText: {
    ...typography.caption,
    color: colors.warningText,
    marginBottom: spacing.xs,
    lineHeight: 18,
  },
  mapPreviewButton: {
    height: 220,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  mapPreview: {
    flex: 1,
    minHeight: 0,
  },
  mapExpandHint: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    backgroundColor: 'rgba(10, 10, 26, 0.78)',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  mapExpandText: {
    ...typography.caption,
    color: '#FFFFFF',
    fontSize: 11,
  },
  sketchNote: { ...typography.caption, marginTop: spacing.sm },
  emptyMap: { minHeight: 90 },
  mapModal: {
    flex: 1,
    backgroundColor: colors.background,
  },
  mapModalHeader: {
    minHeight: 76,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  mapModalHeading: { flex: 1 },
  mapModalTitle: { ...typography.heading },
  mapModalSubtitle: { ...typography.caption, marginTop: 2 },
  mapCloseButton: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  mapCloseText: {
    color: colors.text,
    fontSize: 28,
    lineHeight: 30,
    fontWeight: '300',
  },
  fullMap: { flex: 1 },
  mapModalFooter: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  mapModalHint: { ...typography.caption, textAlign: 'center' },
  dialWrap: { alignItems: 'center' },
  dialCenter: { position: 'absolute', top: 56, alignItems: 'center', width: '100%' },
  dialValue: { ...typography.heading, fontSize: 22 },
  dialSub: { ...typography.caption, marginTop: 2 },
  dialUnit: { ...typography.caption, marginTop: 2, fontSize: 11 },
});
