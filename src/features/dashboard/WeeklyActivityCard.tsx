import React from 'react';
import { StyleSheet } from 'react-native';
import { View } from '../../ui/neu/NeuAuto';
import { Text } from '../../ui/neu/NeuText';
import { Ionicons } from '@expo/vector-icons';
import type { Units } from '../../domain/units';
import { formatDistanceM } from '../../domain/units';
import { buildWeeklyActivity, formatDurationS, type ActivityRide, type WeeklyActivity } from '../../domain/dashboard/activity';
import { colors, radii, spacing, typography } from '../../ui/theme';
import { usePrefs } from '../../app/prefs';

type Props = {
  rides: readonly ActivityRide[];
  units: Units;
  nowMs: number;
};

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

// Section 3 of the dashboard: the weekly activity hero. Every figure comes from
// buildWeeklyActivity over saved rides — no animation counts numbers up, so what is shown is
// always the real stored total. Empty weeks get an explicit empty state instead of a wall of
// zeroes.
export default function WeeklyActivityCard({ rides, units, nowMs }: Props) {
  const easy = usePrefs().uiMode === 'easy';
  const week: WeeklyActivity = buildWeeklyActivity(rides, nowMs);

  if (week.isEmpty) {
    return (
      <View style={s.card}>
        <View style={s.headRow}>
          <Text style={[typography.kicker]}>Last 7 days</Text>
        </View>
        <Text style={[typography.heading, easy && s.easyHeading]}>No rides this week</Text>
        <Text style={s.muted}>
          Your last seven days are clear. Start a ride and its days, distance and time appear here
          — all worked out on this device.
        </Text>
        <View style={s.strip}>
          {week.days.map((day) => (
            <View key={day.dayKey} style={s.col}>
              <View style={[s.dot, s.dotEmpty, day.isToday && s.dotTodayRing]} />
              <Text style={[s.letter, day.isToday && s.letterToday]}>
                {WEEKDAY_LETTERS[new Date(`${day.dayKey}T12:00:00`).getDay()]}
              </Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={s.card}>
      <View style={s.headRow}>
        <Text style={typography.kicker}>Last 7 days</Text>
        {week.streakDays > 0 && (
          <View style={s.streak}>
            <Ionicons
              name="flame"
              size={14}
              color={colors.primaryBright}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
            <Text style={s.streakText}>
              {week.streakDays} day{week.streakDays === 1 ? '' : 's'} in a row
            </Text>
          </View>
        )}
      </View>

      <View style={s.metrics}>
        <View style={s.metric}>
          <Text style={[typography.metric, easy && s.easyMetric]}>
            {formatDistanceM(week.distanceM, units)}
          </Text>
          <Text style={s.metricLabel}>Distance</Text>
        </View>
        <View style={s.metric}>
          <Text style={[typography.metric, easy && s.easyMetric]}>{week.rideCount}</Text>
          <Text style={s.metricLabel}>Rides</Text>
        </View>
        <View style={s.metricEnd}>
          <Text style={[typography.metric, easy && s.easyMetric]}>
            {formatDurationS(week.durationS)}
          </Text>
          <Text style={s.metricLabel}>Time</Text>
        </View>
      </View>

      <View
        style={s.strip}
        accessible
        accessibilityLabel={`Seven day activity. ${week.rideCount} ride${week.rideCount === 1 ? '' : 's'} on ${week.days.filter((d) => d.hasRide).length} day${week.days.filter((d) => d.hasRide).length === 1 ? '' : 's'}.`}
      >
        {week.days.map((day) => (
          <View key={day.dayKey} style={s.col} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={[s.dot, day.hasRide ? s.dotOn : s.dotEmpty, day.isToday && s.dotTodayRing]} />
            <Text style={[s.letter, day.isToday && s.letterToday]}>
              {WEEKDAY_LETTERS[new Date(`${day.dayKey}T12:00:00`).getDay()]}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  streak: { flexDirection: 'row', alignItems: 'center' },
  streakText: { ...typography.caption, color: colors.primaryBright, marginLeft: spacing.xs },
  metrics: { flexDirection: 'row', marginTop: spacing.xs, marginBottom: spacing.md },
  metric: { flex: 1 },
  metricEnd: { alignItems: 'flex-end' },
  metricLabel: { ...typography.caption, marginTop: spacing.xs },
  muted: { ...typography.body, color: colors.textMuted, lineHeight: 20 },
  strip: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs },
  col: { alignItems: 'center', flex: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotOn: { backgroundColor: colors.primary },
  // Empty days keep a faint outline so the strip still reads as seven days, not blank space.
  dotEmpty: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: 'transparent' },
  dotTodayRing: { borderColor: colors.primaryBright, borderWidth: 1.5 },
  letter: { ...typography.caption, marginTop: spacing.xs },
  letterToday: { color: colors.text },
  easyMetric: { fontSize: 30 },
  easyHeading: { fontSize: 19 },
});
