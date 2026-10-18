import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { getDb } from '../../data/local/db';
import { listRides, type RideRow } from '../../data/local/ridesStore';
import Screen from '../../ui/Screen';
import Placeholder from '../../ui/Placeholder';
import { colors, radii, spacing, typography } from '../../ui/theme';
import type { RootTabParamList } from '../../app/RootNavigator';

type Props = BottomTabScreenProps<RootTabParamList, 'Rides'>;

const km = (m: number) => (m / 1000).toFixed(2);

function duration(s: number | null): string {
  if (s == null) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${sec}s`;
}

const statusLabel: Record<RideRow['status'], string> = {
  recording: 'Recording',
  finished: 'Finished',
  recovered: 'Recovered',
};

// Read-only list of locally stored rides. Refreshes whenever the tab gains focus. Tapping a
// card opens the ride detail (stats, route sketch, speed dial).
export default function RidesScreen({ navigation }: Props) {
  const [rides, setRides] = useState<RideRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    const db = await getDb();
    setRides(await listRides(db, 50));
    setLoaded(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh().catch(() => setLoaded(true));
    }, [refresh]),
  );

  return (
    <Screen title="Rides" subtitle={loaded ? `${rides.length} recorded` : 'Loading…'}>
      {loaded && rides.length === 0 && (
        <Placeholder
          title="No rides yet"
          message="Recorded rides appear here with distance, duration and average speed. Start one from the Record tab."
        />
      )}
      {rides.map((r) => (
        <TouchableOpacity
          key={r.id}
          style={s.card}
          activeOpacity={0.7}
          onPress={() => navigation.navigate('RideDetail', { id: r.id })}
          accessibilityRole="button"
          accessibilityLabel={`Ride on ${new Date(r.started_at).toLocaleString()}`}
        >
            <View style={s.cardHead}>
              <Text style={s.date}>{new Date(r.started_at).toLocaleString()}</Text>
              <Text style={[s.badge, r.status === 'recording' && s.badgeActive]}>
                {statusLabel[r.status]}
              </Text>
            </View>
            <Text style={s.vehicle}>{r.vehicle_name ?? 'No vehicle'}</Text>
            <View style={s.metrics}>
            <Metric value={`${km(r.distance_m)} km`} label="Distance" />
            <Metric value={duration(r.duration_s ?? r.tracked_s)} label="Duration" />
            <Metric
              value={r.avg_speed_ms != null ? `${(r.avg_speed_ms * 3.6).toFixed(1)} km/h` : '—'}
              label="Avg speed"
            />
          </View>
          {(r.needs_review === 1 || r.integrity_issue) && (
            <Text style={s.review}>Needs review{r.integrity_issue ? ` · ${r.integrity_issue}` : ''}</Text>
          )}
        </TouchableOpacity>
      ))}
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

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  date: { ...typography.label },
  badge: {
    ...typography.caption,
    color: colors.textMuted,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    overflow: 'hidden',
  },
  badgeActive: { color: colors.background, backgroundColor: colors.primary, fontWeight: '700' },
  vehicle: { ...typography.caption, marginTop: spacing.xs },
  metrics: { flexDirection: 'row', marginTop: spacing.md },
  metric: { flex: 1 },
  metricValue: { ...typography.body, fontWeight: '700' },
  metricLabel: { ...typography.caption, marginTop: spacing.xs },
  review: { ...typography.caption, color: colors.warningText, marginTop: spacing.md },
});
