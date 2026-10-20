import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { RideRow } from '../../data/local/ridesStore';
import type { Units } from '../../domain/units';
import { formatDistanceM } from '../../domain/units';
import PrimaryButton from '../../ui/PrimaryButton';
import { colors, radii, spacing, typography } from '../../ui/theme';
import { usePrefs } from '../../app/prefs';

type Props = {
  /** The ride currently recording. The dashboard only renders this card while one exists. */
  ride: RideRow;
  units: Units;
  onOpenRecorder: () => void;
};

// Section 2 of the dashboard, shown only while a ride is recording. The values and the action
// are unchanged from the original card — a recording ride still reports its persisted distance
// and point count and still opens the recorder. The idle "Ready to ride" state was removed so
// the weekly activity card leads the dashboard when nothing is in progress.
export default function ActiveRideCard({ ride, units, onOpenRecorder }: Props) {
  const easy = usePrefs().uiMode === 'easy';

  return (
    <View style={s.live}>
      <View style={s.liveRow}>
        <View style={s.liveDot} />
        <Text style={[typography.kicker, s.liveKicker]}>Recording</Text>
      </View>
      <Text style={[typography.heading, easy && s.easyHeading]}>Ride in progress</Text>
      <Text style={s.vehicle}>{ride.vehicle_name ?? 'No vehicle'}</Text>
      <View style={s.metrics}>
        <View style={s.metric}>
          <Text style={[typography.metric, easy && s.easyMetric]}>
            {formatDistanceM(ride.distance_m, units)}
          </Text>
          <Text style={s.metricLabel}>Distance so far</Text>
        </View>
        <View style={s.metricEnd}>
          <Text style={[typography.metric, easy && s.easyMetric]}>{ride.point_count}</Text>
          <Text style={s.metricLabel}>Points</Text>
        </View>
      </View>
      <PrimaryButton
        label="Open ride recorder"
        onPress={onOpenRecorder}
        accessibilityHint="Switches to the Record tab for the ride in progress"
      />
    </View>
  );
}

const s = StyleSheet.create({
  // Live wash rather than the plain card colour: a ride in progress is then distinguishable from
  // the settled panels without depending on the border alone.
  live: {
    backgroundColor: colors.primaryTint,
    borderColor: colors.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  liveRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primaryBright,
    marginRight: spacing.sm,
  },
  // The live state is the one place the neutral kicker is raised, so the dot is backed up by
  // the word "Recording" rather than carrying the meaning alone.
  liveKicker: { color: colors.primaryBright },
  vehicle: { ...typography.caption, marginTop: spacing.xs },
  metrics: { flexDirection: 'row', marginTop: spacing.md, marginBottom: spacing.md },
  metric: { flex: 1 },
  metricEnd: { alignItems: 'flex-end' },
  metricLabel: { ...typography.caption, marginTop: spacing.xs },
  easyMetric: { fontSize: 30 },
  easyHeading: { fontSize: 19 },
});
