import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import Screen from '../../ui/Screen';
import { colors, radii, spacing, typography } from '../../ui/theme';
import type { RootTabParamList } from '../../app/RootNavigator';

type Props = BottomTabScreenProps<RootTabParamList, 'Settings'>;

export default function SettingsScreen({ navigation }: Props) {
  return (
    <Screen title="Settings" subtitle="App preferences">
      <Section title="Vehicle">
        <Row
          label="Garage"
          hint="Vehicles, nicknames and plates"
          onPress={() => navigation.navigate('Garage')}
        />
      </Section>

      <Section title="Support">
        <Row
          label="Ride diagnostics"
          hint="GPS status, rides and event log"
          onPress={() => navigation.navigate('Diagnostics')}
        />
        <Row
          label="Reminders & deadlines"
          hint="Registration, licence and insurance notices"
          onPress={() => navigation.navigate('Deadlines')}
        />
      </Section>

      <Section title="Preferences">
        <Row label="Units" value="Metric" />
        <Row label="Account & sync" value="Coming soon" />
      </Section>

      <Text style={s.footnote}>Vehitra 0.1.0 · offline-first</Text>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      <View style={s.group}>{children}</View>
    </View>
  );
}

function Row({
  label,
  hint,
  value,
  onPress,
}: {
  label: string;
  hint?: string;
  value?: string;
  onPress?: () => void;
}) {
  const content = (
    <>
      <View style={s.rowText}>
        <Text style={s.rowLabel}>{label}</Text>
        {!!hint && <Text style={s.rowHint}>{hint}</Text>}
      </View>
      {!!value && <Text style={s.rowValue}>{value}</Text>}
      {!!onPress && <Text style={s.chevron}>›</Text>}
    </>
  );

  if (!onPress) {
    return <View style={[s.row, s.rowDisabled]}>{content}</View>;
  }
  return (
    <TouchableOpacity style={s.row} onPress={onPress} accessibilityRole="button">
      {content}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  section: { marginBottom: spacing.xl },
  sectionTitle: {
    ...typography.caption,
    color: colors.textMuted,
    letterSpacing: 1.2,
    fontWeight: '700',
    marginBottom: spacing.sm,
    marginLeft: spacing.xs,
  },
  group: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowDisabled: { opacity: 0.6 },
  rowText: { flex: 1 },
  rowLabel: { ...typography.body, fontWeight: '600' },
  rowHint: { ...typography.caption, marginTop: spacing.xs },
  rowValue: { ...typography.body, color: colors.textMuted },
  chevron: { color: colors.textMuted, fontSize: 22, marginLeft: spacing.sm },
  footnote: { ...typography.caption, textAlign: 'center', marginTop: spacing.md },
});
