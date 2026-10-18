import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { getDb } from '../../data/local/db';
import { getActiveRideId, getRide, listRides, type RideRow } from '../../data/local/ridesStore';
import Screen from '../../ui/Screen';
import Placeholder from '../../ui/Placeholder';
import { colors, radii, spacing, typography } from '../../ui/theme';
import type { RootTabParamList } from '../../app/RootNavigator';

type Props = BottomTabScreenProps<RootTabParamList, 'Dashboard'>;

// Totals are derived from the existing listRides API. Local data only; the cap is a
// guardrail, not a schema change.
const RIDE_LIST_LIMIT = 1000;

const km = (m: number) => (m / 1000).toFixed(1);

// Rides-focused dashboard. Reuses the local ride store only: the garage, maintenance
// and registration layers do not exist yet, so they are shown as unavailable, not faked.
export default function DashboardScreen({ navigation }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<RideRow | null>(null);
  const [rides, setRides] = useState<RideRow[]>([]);

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
                  <Text style={s.metricValue}>{km(active.distance_m)} km</Text>
                  <Text style={s.metricLabel}>So far</Text>
                </View>
                <View style={s.metric}>
                  <Text style={s.metricValue}>{active.point_count}</Text>
                  <Text style={s.metricLabel}>Points</Text>
                </View>
              </View>
              <TouchableOpacity
                style={s.btn}
                onPress={() => navigation.navigate('Record')}
                accessibilityRole="button"
              >
                <Text style={s.btnTxt}>Open Record</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={s.btn}
              onPress={() => navigation.navigate('Record')}
              accessibilityRole="button"
            >
              <Text style={s.btnTxt}>START A RIDE</Text>
            </TouchableOpacity>
          )}

          <View style={s.card}>
            <Text style={s.cardTitle}>Ride totals</Text>
            <View style={s.metrics}>
              <View style={s.metric}>
                <Text style={s.metricValue}>{rideCount}</Text>
                <Text style={s.metricLabel}>Rides recorded</Text>
              </View>
              <View style={s.metric}>
                <Text style={s.metricValue}>{km(totalM)} km</Text>
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
            <Text style={s.cardTitle}>Garage</Text>
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

      <Text style={s.sectionTitle}>Coming later</Text>
      <View style={s.card}>
        <ComingSoon label="Maintenance schedule" />
        <ComingSoon label="Registration & deadlines" />
        <Text style={s.muted}>
          These are not built yet. No maintenance or registration data is shown until then.
        </Text>
      </View>
    </Screen>
  );
}

function ComingSoon({ label }: { label: string }) {
  return (
    <View style={s.comingRow}>
      <Text style={s.comingLabel}>{label}</Text>
      <Text style={s.comingTag}>Soon</Text>
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
  sectionTitle: {
    ...typography.label,
    color: colors.textMuted,
    letterSpacing: 1,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  comingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing.sm,
  },
  comingLabel: { ...typography.body },
  comingTag: {
    ...typography.caption,
    color: colors.textMuted,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    overflow: 'hidden',
  },
});
