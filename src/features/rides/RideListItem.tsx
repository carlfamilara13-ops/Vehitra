import React, { memo, useCallback, useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Path } from 'react-native-svg';
import type { RideRow } from '../../data/local/ridesStore';
import { projectRoute, type RouteSketch, type SketchedPoint } from '../../domain/ride/sketch';
import { formatDistanceM, formatSpeedMs, type Units } from '../../domain/units';
import { colors, radii, spacing, typography } from '../../ui/theme';
import { usePrefs } from '../../app/prefs';
import { RIDE_STATUS_LABELS, rideRouteSegments } from './ridesView';

const PREVIEW_HEIGHT = 148;

function duration(s: number | null): string {
  if (s == null) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${sec}s`;
}

// The schema has no ride title column, so the title falls back to a date-based label. The date
// and time shown on the card come from the stored `started_at` — nothing is generated.
function rideTitle(ride: RideRow): string {
  return `Ride on ${new Date(ride.started_at).toLocaleDateString()}`;
}

function timeText(ride: RideRow): string {
  return new Date(ride.started_at).toLocaleTimeString();
}

function toPath(points: SketchedPoint[]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  const moves = rest.map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  return `M ${first.x.toFixed(1)} ${first.y.toFixed(1)} ${moves}`;
}

function needsReviewFlag(ride: RideRow): boolean {
  return ride.needs_review === 1 || !!ride.integrity_issue;
}

// ------------------------------------------------------------------ status badge

// Text label first, glyph second: the state never depends on colour alone. The tones reuse the
// existing badge styling (neutral surface, blue for an active recording) so the Rides list
// reads the same way Ride Detail already does.
function StatusBadge({ status }: { status: RideRow['status'] }) {
  const icon: keyof typeof Ionicons.glyphMap =
    status === 'finished' ? 'checkmark-circle' : status === 'recovered' ? 'refresh-circle' : 'radio-button-on';
  const active = status === 'recording';
  return (
    <View style={[s.badge, active && s.badgeActive]}>
      <Ionicons
        name={icon}
        size={12}
        color={active ? colors.background : colors.textMuted}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <Text style={[s.badgeText, active && s.badgeTextActive]}>{RIDE_STATUS_LABELS[status]}</Text>
    </View>
  );
}

function ReviewNote({ ride }: { ride: RideRow }) {
  return (
    <View style={s.reviewRow}>
      <Ionicons
        name="warning-outline"
        size={13}
        color={colors.warningText}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <Text style={s.review} numberOfLines={2}>
        Needs review{ride.integrity_issue ? ` · ${ride.integrity_issue}` : ''}
      </Text>
    </View>
  );
}

function Metric({ value, label, easy }: { value: string; label: string; easy: boolean }) {
  return (
    <View style={s.metric}>
      <Text style={[s.metricValue, easy && s.easyMetric]}>{value}</Text>
      <Text style={s.metricLabel}>{label}</Text>
    </View>
  );
}

// ------------------------------------------------------------------ route preview

// Draws the saved route geometry the ride was finalized with — the same `route_segments` JSON
// and projection the Ride Detail screen and the Dashboard's longest-rides card already use.
//
// This project ships no MapLibre module and no map tile provider, so there are no tiles, no
// provider attribution and no MapLibre logo to manage: the preview is the offline route drawn
// on the dark surface, and it says so instead of pretending to be a live map.
function RideRoutePreview({ ride, height = PREVIEW_HEIGHT }: { ride: RideRow; height?: number }) {
  const [width, setWidth] = useState(0);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.width);
    setWidth((prev) => (prev === next ? prev : next));
  }, []);

  const segments = useMemo(() => rideRouteSegments(ride), [ride]);
  const sketch: RouteSketch | null = useMemo(() => {
    if (width <= 0 || segments.length === 0) return null;
    return projectRoute(segments, { width, height, padding: 14 });
  }, [segments, width, height]);

  const usable = sketch != null && !sketch.isEmpty;
  const first = usable ? sketch.segments[0][0] : null;
  const lastSeg = usable ? sketch.segments[sketch.segments.length - 1] : null;
  const last = lastSeg ? lastSeg[lastSeg.length - 1] : null;

  return (
    <View style={[s.preview, { height }]} onLayout={onLayout}>
      {usable && first && last ? (
        <>
          <Svg width={width} height={height} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {sketch.segments.map((seg, i) => (
              <Path
                key={i}
                d={toPath(seg)}
                stroke={colors.primaryBright}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ))}
            <Circle cx={first.x} cy={first.y} r={4} fill={colors.success} />
            <Circle cx={last.x} cy={last.y} r={4} fill={colors.danger} />
          </Svg>
          <Text style={s.previewNote} importantForAccessibility="no" accessibilityElementsHidden>
            Offline route — shape only, no map
          </Text>
        </>
      ) : width > 0 ? (
        <View
          style={s.previewEmpty}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Ionicons name="map-outline" size={22} color={colors.textMuted} />
          <Text style={s.previewEmptyText}>Route preview unavailable</Text>
        </View>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------ rich route card

export type RideItemProps = { ride: RideRow; units: Units; onOpenRide: (id: string) => void };

// Memoised so scrolling only mounts/unmounts previews instead of re-decoding every visible
// route; the sketch itself is computed inside the component from the stored segments.
export const RideRichCard = memo(function RideRichCard({ ride, units, onOpenRide }: RideItemProps) {
  const easy = usePrefs().uiMode === 'easy';
  const onPress = useCallback(() => onOpenRide(ride.id), [onOpenRide, ride.id]);

  const title = rideTitle(ride);
  const time = timeText(ride);
  const vehicle = ride.vehicle_name ?? 'No vehicle';
  const distanceText = formatDistanceM(ride.distance_m, units, { decimals: 2 });
  const durationText = duration(ride.duration_s ?? ride.tracked_s);
  const review = needsReviewFlag(ride);

  const label =
    `${title}, ${time}. ${distanceText}. ${durationText}. ${vehicle}. ` +
    `${RIDE_STATUS_LABELS[ride.status]}.${review ? ' Needs review.' : ''}`;

  return (
    <TouchableOpacity
      style={s.card}
      activeOpacity={0.75}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens this ride"
    >
      <RideRoutePreview ride={ride} />
      <View style={s.cardBody}>
        <View style={s.titleRow}>
          <Text style={[s.title, easy && s.easyTitle]} numberOfLines={1}>
            {title}
          </Text>
          <StatusBadge status={ride.status} />
        </View>
        <Text style={s.meta}>
          {time} · {vehicle}
        </Text>
        <View style={s.metrics}>
          <Metric value={distanceText} label="Distance" easy={easy} />
          <Metric value={durationText} label="Duration" easy={easy} />
          <Metric value={formatSpeedMs(ride.avg_speed_ms, units)} label="Avg speed" easy={easy} />
        </View>
        {review && <ReviewNote ride={ride} />}
      </View>
    </TouchableOpacity>
  );
});

// ------------------------------------------------------------------ compact row

export const RideCompactRow = memo(function RideCompactRow({ ride, units, onOpenRide }: RideItemProps) {
  const easy = usePrefs().uiMode === 'easy';
  const onPress = useCallback(() => onOpenRide(ride.id), [onOpenRide, ride.id]);

  const title = rideTitle(ride);
  const time = timeText(ride);
  const distanceText = formatDistanceM(ride.distance_m, units, { decimals: 1 });
  const durationText = duration(ride.duration_s ?? ride.tracked_s);
  const review = needsReviewFlag(ride);

  const label =
    `${title}, ${time}. ${distanceText}. ${durationText}. ` +
    `${ride.vehicle_name ? `${ride.vehicle_name}. ` : ''}${RIDE_STATUS_LABELS[ride.status]}.` +
    `${review ? ' Needs review.' : ''}`;

  return (
    <TouchableOpacity
      style={s.row}
      activeOpacity={0.75}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens this ride"
    >
      <View style={s.rowMain}>
        <View style={s.rowLine}>
          <Text style={[s.rowTitle, easy && s.easyTitle]} numberOfLines={1}>
            {title}
          </Text>
          <StatusBadge status={ride.status} />
        </View>
        <Text style={s.rowMeta} numberOfLines={1}>
          {time} · {distanceText} · {durationText}
          {ride.vehicle_name ? ` · ${ride.vehicle_name}` : ''}
        </Text>
        {review && <ReviewNote ride={ride} />}
      </View>
      <Ionicons
        name="chevron-forward"
        size={16}
        color={colors.textMuted}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </TouchableOpacity>
  );
});

const s = StyleSheet.create({
  // Rich card
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  cardBody: { padding: spacing.lg },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  title: { ...typography.heading, fontSize: 17, flex: 1 },
  easyTitle: { fontSize: 19 },
  meta: { ...typography.caption, marginTop: spacing.xs },
  metrics: { flexDirection: 'row', marginTop: spacing.md },
  metric: { flex: 1 },
  metricValue: { ...typography.body, fontWeight: '700' },
  easyMetric: { fontSize: 17 },
  metricLabel: { ...typography.caption, marginTop: spacing.xs },

  // Route preview
  preview: {
    backgroundColor: colors.background,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  previewNote: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.xs,
    fontSize: 10,
    color: colors.textMuted,
  },
  previewEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  previewEmptyText: { ...typography.caption },

  // Compact row
  row: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowMain: { flex: 1 },
  rowLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  rowTitle: { ...typography.label, flexShrink: 1 },
  rowMeta: { ...typography.caption, marginTop: 2 },

  // Shared
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    overflow: 'hidden',
    flexShrink: 0,
  },
  badgeActive: { backgroundColor: colors.primary },
  badgeText: { ...typography.caption },
  badgeTextActive: { color: colors.background, fontWeight: '700' },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.md },
  review: { ...typography.caption, color: colors.warningText, flexShrink: 1 },
});
