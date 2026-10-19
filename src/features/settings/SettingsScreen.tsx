import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import Screen from '../../ui/Screen';
import { colors, radii, spacing, typography } from '../../ui/theme';
import type { RootTabParamList } from '../../app/RootNavigator';
import { usePrefs } from '../../app/prefs';
import { getDb } from '../../data/local/db';
import { updateAppSettings, type UiMode, type UnitsPref } from '../../data/local/settingsStore';

type Props = BottomTabScreenProps<RootTabParamList, 'Settings'>;

const UNITS_LABEL: Record<UnitsPref, string> = { metric: 'Metric', imperial: 'Imperial' };
const MODE_LABEL: Record<UiMode, string> = { standard: 'Standard', easy: 'Easy' };

export default function SettingsScreen({ navigation }: Props) {
  const prefs = usePrefs();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Both rows write the single app_settings row, then reload() so this screen and every other
  // prefs consumer re-render from the stored value. A failed write keeps the old value and says
  // so instead of pretending it applied.
  const save = async (patch: { units?: UnitsPref; ui_mode?: UiMode }) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateAppSettings(await getDb(), patch);
      await prefs.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

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
        <Row
          label="Units"
          hint="Distances display only — stored data stays in kilometres"
          value={UNITS_LABEL[prefs.units]}
          onPress={() =>
            void save({ units: prefs.units === 'metric' ? 'imperial' : 'metric' })
          }
        />
        <Row
          label="Interface mode"
          hint="Larger text on every screen"
          value={MODE_LABEL[prefs.uiMode]}
          onPress={() => void save({ ui_mode: prefs.uiMode === 'standard' ? 'easy' : 'standard' })}
        />
        <Row
          label="Account & sync"
          hint="Sign in and sync vehicles and reminders"
          onPress={() => navigation.navigate('Account')}
        />
      </Section>

      {!!error && <Text style={s.saveError}>{error}</Text>}
      {saving && <Text style={s.saving}>Saving…</Text>}

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
  saveError: { ...typography.caption, color: colors.danger, marginTop: spacing.sm },
  saving: { ...typography.caption, marginTop: spacing.xs },
  footnote: { ...typography.caption, textAlign: 'center', marginTop: spacing.md },
});
