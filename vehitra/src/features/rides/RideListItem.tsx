import React, { memo, useCallback } from 'react';
import { StyleSheet } from 'react-native';
import { TouchableOpacity, View } from '../../ui/neu/NeuAuto';
import { Text } from '../../ui/neu/NeuText';
import { Ionicons } from '@expo/vector-icons';
import type { RideRow } from '../../data/local/ridesStore';
import { formatDistanceM, formatSpeedMs, type Units } from '../../domain/units';
import { colors, radii, spacing, typography } from '../../ui/theme';
import { usePrefs } from '../../app/prefs';
import { RIDE_STATUS_LABELS, rideRouteSegments } from './ridesView';
import RideMapPreview from './RideMapPreview';

const PREVIEW_HEIGHT = 148;

function duration(s: number | null): string {
  if (s == null) return ' ';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${sec}s`;
}

// The schema has no ride title column, so the title falls back to a date-based label. The date
// and time shown on the card come from the stored `started_at`   nothing is generated.
function rideTitle(ride: RideRow): string {
  return `Ride on ${new Date(ride.started_at).toLocaleDateString()}`;
}

function timeText(ride: RideRow): string {
  return new Date(ride.started_at).toLocaleTimeString();
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

// The route geometry is decoded from the saved ride record and displayed over the basemap.
//
function RideRoutePreview({ ride, height = PREVIEW_HEIGHT }: { ride: RideRow; height?: number }) {
  return (
    <RideMapPreview
      segments={rideRouteSegments(ride)}
      containerStyle={[s.preview, { height }]}
    />
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
