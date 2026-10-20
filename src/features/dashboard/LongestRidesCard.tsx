import React, { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Path } from 'react-native-svg';
import type { RideRow } from '../../data/local/ridesStore';
import { decodePolyline, type LatLon } from '../../domain/ride/polyline';
import { projectRoute, type RouteSketch, type SketchedPoint } from '../../domain/ride/sketch';
import type { Route } from '../../domain/ride/route';
import { rankLongestRides } from '../../domain/dashboard/longestRides';
import { formatDistanceM, type Units } from '../../domain/units';
import { colors, radii, spacing, typography } from '../../ui/theme';
import { usePrefs } from '../../app/prefs';

type Props = {
  rides: readonly RideRow[];
  units: Units;
  limit?: number;
  onOpenRide: (id: string) => void;
};

const SKETCH_HEIGHT = 64;

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

// Same path builder the ride detail screen uses, so the mini map and the full route agree.
function toPath(points: SketchedPoint[]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  const moves = rest.map((p) => `L ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  return `M ${first.x.toFixed(1)} ${first.y.toFixed(1)} ${moves}`;
}

function duration(s: number | null): string {
  if (s == null) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Section 5: the longest rides. Ranked from saved rides only, each row with a small offline
// route sketch projected from the stored polyline (no tiles, no network) and a tap through to
// the full ride detail.
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
          Once you have saved rides, your three longest appear here with a sketch of each route.
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
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const sketch: RouteSketch | null = useMemo(() => {
    if (width <= 0) return null;
    const segments = segmentsOf(ride);
    if (segments.length === 0) return null;
    return projectRoute(segments, { width, height: SKETCH_HEIGHT, padding: 8 });
  }, [ride, width]);

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
      <View style={s.sketchBox} onLayout={onLayout}>
        {sketch && !sketch.isEmpty && width > 0 ? (
          <Svg width={width} height={SKETCH_HEIGHT}>
            {sketch.segments.map((seg, i) => (
              <Path
                key={i}
                d={toPath(seg)}
                stroke={colors.primaryBright}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ))}
            <Circle cx={sketch.segments[0][0].x} cy={sketch.segments[0][0].y} r={3} fill={colors.success} />
            <Circle
              cx={sketch.segments[sketch.segments.length - 1].slice(-1)[0].x}
              cy={sketch.segments[sketch.segments.length - 1].slice(-1)[0].y}
              r={3}
              fill={colors.danger}
            />
          </Svg>
        ) : (
          <Text style={s.noRoute}>No stored route for this ride</Text>
        )}
      </View>
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
  sketchBox: { height: SKETCH_HEIGHT, marginTop: spacing.sm, justifyContent: 'center' },
  noRoute: { ...typography.caption, color: colors.textMuted },
  easyDistance: { fontSize: 20 },
});
