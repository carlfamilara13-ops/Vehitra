
import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { TouchableOpacity, View } from '../../ui/neu/NeuAuto';
import { Text } from '../../ui/neu/NeuText';
import { Ionicons } from '@expo/vector-icons';
import type { RideRow } from '../../data/local/ridesStore';
import { decodePolyline, type LatLon } from '../../domain/ride/polyline';
import type { Route } from '../../domain/ride/route';
import { rankLongestRides } from '../../domain/dashboard/longestRides';
import { formatDistanceM, type Units } from '../../domain/units';
import { colors, radii, spacing, typography } from '../../ui/theme';
import { usePrefs } from '../../app/prefs';
import RideMapPreview from '../rides/RideMapPreview';

const MAP_PREVIEW_HEIGHT = 200;

type Props = {
  rides: readonly RideRow[];
  units: Units;
  limit?: number;
  onOpenRide: (id: string) => void;
};

// Reads the route a ride was finalized with. Same JSON Route shape the ride detail screen
// reads; absent or unreadable segments simply mean "no map" for that row.
function segmentsOf(ride: RideRow): LatLon[][] {
  if (!ride.route_segments) return [];
  try {
    const route = JSON.parse(ride.route_segments) as Route;
    if (!route || !Array.isArray(route.segments)) return [];
    return route.segments
      .map((seg) => decodePolyline(seg.polyline))
      .filter((pts) => pts.length > 1);
  } catch {
    return [];
  }
}

// Uses the saved ride route segments so the preview matches ride detail.
function duration(s: number | null): string {
  if (s == null) return ' ';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Section 5: the longest rides. Ranked from saved rides, each row shows its saved route over a basemap.
export default function LongestRidesCard({ rides, units, limit = 3, onOpenRide }: Props) {
  const easy = usePrefs().uiMode === 'easy';
  const ranked = useMemo(
    () =>
      rankLongestRides(
        rides.map((r) => ({
          startedAt: r.started_at,
          status: r.status,
          distanceM: r.distance_m,
          durationS: r.duration_s,
          row: r,
        })),
        limit,
      ),
    [rides, limit],
  );

  if (ranked.length === 0) {
    return (
      <View style={s.card}>
        <Text style={typography.heading}>Longest rides</Text>
        <Text style={s.muted}>
          Once you have saved rides, your three longest appear here with their routes on the map.
        </Text>
      </View>
    );
  }

  return (
    <View style={s.card}>
      <Text style={typography.heading}>Longest rides</Text>
      <View style={s.list}>
        {ranked.map((item) => (
          <LongestRideRow
            key={item.row.id}
            rank={item.rank}
            ride={item.row}
            units={units}
            easy={easy}
            onPress={() => onOpenRide(item.row.id)}
          />
        ))}
      </View>
    </View>
  );
}

function LongestRideRow({
  rank,
  ride,
  units,
  easy,
  onPress,
}: {
  rank: number;
  ride: RideRow;
  units: Units;
  easy: boolean;
  onPress: () => void;
}) {
  const dateText = new Date(ride.started_at).toLocaleDateString();

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`Rank ${rank}. ${dateText}. ${formatDistanceM(ride.distance_m, units)}.`}
      accessibilityHint="Opens this ride"
      style={s.row}
    >
      <View style={s.rowTop}>
        <View style={s.rank}>
          <Text style={s.rankText}>{rank}</Text>
        </View>
        <View style={s.rowText}>
          <Text style={[s.distance, easy && s.easyDistance]}>
            {formatDistanceM(ride.distance_m, units)}
          </Text>
          <Text style={s.meta}>
            {dateText} · {duration(ride.duration_s)}
            {ride.vehicle_name ? ` · ${ride.vehicle_name}` : ''}
          </Text>
        </View>
        <Ionicons
          name="chevron-forward"
          size={16}
          color={colors.textMuted}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      </View>
      <RideMapPreview
        segments={segmentsOf(ride)}
        containerStyle={s.sketchBox}
        emptyLabel="No stored route for this ride"
      />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  muted: { ...typography.body, color: colors.textMuted, lineHeight: 20, marginTop: spacing.xs },
  list: { marginTop: spacing.md },
  row: { marginBottom: spacing.lg },
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  rank: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  rankText: { ...typography.label, color: colors.primaryBright },
  rowText: { flex: 1 },
  distance: { ...typography.heading },
  meta: { ...typography.caption, marginTop: 2 },
  sketchBox: {
  height: MAP_PREVIEW_HEIGHT,
  marginTop: spacing.sm,
  justifyContent: 'center',
  borderRadius: radii.md,
  overflow: 'hidden',
},
  noRoute: { ...typography.caption, color: colors.textMuted },
  easyDistance: { fontSize: 20 },
});
