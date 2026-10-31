import React, { useCallback, useState } from 'react';
<<<<<<< HEAD
import { Alert, Image, StyleSheet } from 'react-native';
import { NeuToggle, NeuSegmented } from '../../ui/neu/NeuControls';
import { Pressable, TouchableOpacity, View } from '../../ui/neu/NeuAuto';
import { Text } from '../../ui/neu/NeuText';
=======
import {
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
>>>>>>> 085d579c1634fc5cd9a597346cae31cf95b819b5
import { useFocusEffect } from '@react-navigation/native';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import Screen from '../../ui/Screen';
import { colors, radii, spacing, typography } from '../../ui/theme';
import type { RootTabParamList } from '../../app/RootNavigator';
import { usePrefs } from '../../app/prefs';
import { getDb } from '../../data/local/db';
import { getAppSettings, updateAppSettings, type AppSettingsPatch, type AppSettingsRow, type UiMode, type UnitsPref } from '../../data/local/settingsStore';
import { getDriverProfile, type DriverProfileRow } from '../../data/local/driverProfileStore';
import DriverProfileEditModal from '../dashboard/DriverProfileEditModal';
import { createNotificationsAdapter } from '../reminders/notifications';
import { syncReminders } from '../reminders/scheduler';

type Props = BottomTabScreenProps<RootTabParamList, 'Settings'>;

const UNITS_LABEL: Record<UnitsPref, string> = { metric: 'Metric', imperial: 'Imperial' };
const MODE_LABEL: Record<UiMode, string> = { standard: 'Standard', easy: 'Easy' };
const NOTIFICATION_KEYS: ReadonlyArray<keyof AppSettingsPatch> = [
  'notifications_enabled',
  'maintenance_upcoming_enabled',
  'maintenance_overdue_enabled',
  'document_reminders_enabled',
  'battery_reminders_enabled',
];

export default function SettingsScreen({ navigation }: Props) {
  const prefs = usePrefs();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettingsRow | null>(null);
  const [profile, setProfile] = useState<DriverProfileRow | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const db = await getDb();
      const [nextSettings, nextProfile] = await Promise.all([getAppSettings(db), getDriverProfile(db)]);
      setSettings(nextSettings);
      setProfile(nextProfile);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const save = async (patch: AppSettingsPatch) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const db = await getDb();
      const saved = await updateAppSettings(db, patch);
      setSettings(saved);
      await prefs.reload();
      if (NOTIFICATION_KEYS.some((key) => key in patch)) {
        const result = await syncReminders(db, createNotificationsAdapter());
        if (!result.available && saved.notifications_enabled === 1) {
          setError('Saved, but reminders are unavailable in this app build. Install the updated Vehitra app to enable them.');
        } else if (result.permissionDenied) {
          setError('Saved, but Android notification permission is off. Allow notifications in Android settings to receive reminders.');
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const version = Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? 'Unavailable';
  const notificationsEnabled = settings?.notifications_enabled === 1;

  return (
    <Screen title="Settings" subtitle="Your Vehitra preferences">
      <View style={s.profileCard}>
        <View style={s.avatar}>
          {profile?.portrait_uri ? (
            <Image source={{ uri: profile.portrait_uri }} style={s.avatarImage} />
          ) : (
            <Ionicons name="person-outline" size={27} color={colors.primaryBright} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          )}
        </View>
        <View style={s.profileCopy}>
          <Text style={s.profileName} numberOfLines={1}>{profile?.full_name || 'Your driver profile'}</Text>
          <Text style={s.profileHint}>{profile ? 'Saved on this device' : 'Add a name and photo for your profile'}</Text>
        </View>
        <TouchableOpacity
          style={s.editProfile}
          onPress={() => setProfileOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={profile ? 'Edit driver profile' : 'Set up driver profile'}
        >
          <Text style={s.editProfileText}>{profile ? 'Edit' : 'Set up'}</Text>
        </TouchableOpacity>
      </View>

      <Section title="Appearance" description="Choose a theme for every Vehitra screen.">
<<<<<<< HEAD
        <NeuSegmented
          value={prefs.appearance}
          onChange={(v) => { if (!saving) void save({ appearance: v }); }}
          options={[
            { value: 'dark', label: 'Dark', icon: 'moon-outline' },
            { value: 'light', label: 'Light', icon: 'sunny-outline' },
          ]}
        />
=======
        <View style={s.appearanceChoices} accessibilityRole="radiogroup" accessibilityLabel="Appearance">
          <AppearanceOption label="Dark" selected={prefs.appearance === 'dark'} onPress={() => void save({ appearance: 'dark' })} disabled={saving} />
          <AppearanceOption label="Light" selected={prefs.appearance === 'light'} onPress={() => void save({ appearance: 'light' })} disabled={saving} />
        </View>
>>>>>>> 085d579c1634fc5cd9a597346cae31cf95b819b5
      </Section>

      <Section title="Your Vehitra">
        <LinkRow label="My Vehicles" hint="Manage vehicles and your active ride profile" onPress={() => navigation.navigate('Garage')} />
        <LinkRow label="Storage & data" hint="What stays on this device and what syncs" onPress={() => Alert.alert('Storage & data', 'Rides, maintenance history, driver profile, and preferences are stored on this device. If you sign in, manual sync includes vehicles and reminders.')} />
        <LinkRow label="About Vehitra" hint={`Version ${version} · offline-first`} onPress={() => Alert.alert('Vehitra', `Version ${version}\nAn offline-first vehicle companion for maintenance and rides.`)} last />
      </Section>

      <Section title="Notifications" description="Local reminders are scheduled on this device. Android controls notification sound and vibration." grouped>
        <Text style={s.groupLabel}>General</Text>
        <View style={s.group}>
        <ToggleRow
          label="Reminders"
          hint="Master control for Vehitra's local reminders"
          value={notificationsEnabled}
          disabled={saving || settings == null}
          onValueChange={(value) => void save({ notifications_enabled: value })}
          last
        />
        </View>
        <Text style={s.groupLabel}>Reminder types</Text>
        <View style={s.group}>
        <ToggleRow
          label="Upcoming maintenance"
          hint="Maintenance items currently marked due soon in Parts"
          value={settings?.maintenance_upcoming_enabled === 1}
          disabled={saving || !notificationsEnabled}
          onValueChange={(value) => void save({ maintenance_upcoming_enabled: value })}
        />
        <ToggleRow
          label="Overdue maintenance"
          hint="Components already marked overdue"
          value={settings?.maintenance_overdue_enabled === 1}
          disabled={saving || !notificationsEnabled}
          onValueChange={(value) => void save({ maintenance_overdue_enabled: value })}
        />
        <ToggleRow
          label="Vehicle document expiry"
          hint="Registration, licence, insurance, inspection, and saved deadlines"
          value={settings?.document_reminders_enabled === 1}
          disabled={saving || !notificationsEnabled}
          onValueChange={(value) => void save({ document_reminders_enabled: value })}
        />
        <ToggleRow
          label="Battery inactivity"
          hint="A nudge when a vehicle has not been used for a while"
          value={settings?.battery_reminders_enabled === 1}
          disabled={saving || !notificationsEnabled}
          onValueChange={(value) => void save({ battery_reminders_enabled: value })}
          last
        />
        <Text style={s.notificationFootnote}>Ride recording uses its required Android foreground notification and remains independent of these reminder controls.</Text>
        </View>
      </Section>

      <Section title="Preferences">
<<<<<<< HEAD
        <SegRow
          label="Units"
          hint="Display preference only; stored distances remain unchanged"
          value={prefs.units}
          onChange={(v) => { if (!saving) void save({ units: v }); }}
          options={[
            { value: 'metric', label: UNITS_LABEL.metric },
            { value: 'imperial', label: UNITS_LABEL.imperial },
          ]}
        />
        <SegRow
          label="Interface mode"
          hint="Larger text and controls on every screen"
          value={prefs.uiMode}
          onChange={(v) => { if (!saving) void save({ ui_mode: v }); }}
          options={[
            { value: 'standard', label: MODE_LABEL.standard },
            { value: 'easy', label: MODE_LABEL.easy },
          ]}
=======
        <LinkRow
          label="Units"
          hint="Display preference only; stored distances remain unchanged"
          value={UNITS_LABEL[prefs.units]}
          onPress={() => void save({ units: prefs.units === 'metric' ? 'imperial' : 'metric' })}
        />
        <LinkRow
          label="Interface mode"
          hint="Larger text and controls on every screen"
          value={MODE_LABEL[prefs.uiMode]}
          onPress={() => void save({ ui_mode: prefs.uiMode === 'standard' ? 'easy' : 'standard' })}
>>>>>>> 085d579c1634fc5cd9a597346cae31cf95b819b5
        />
        <LinkRow
          label="Account & sync"
          hint="Sign in and manually sync vehicles and reminders"
          onPress={() => navigation.navigate('Account')}
          last
        />
      </Section>

      <Section title="Support">
        <LinkRow label="Reminders & deadlines" hint="Manage dates and reminder timing" onPress={() => navigation.navigate('Deadlines')} />
        <LinkRow label="Ride diagnostics" hint="GPS status, rides, and event log" onPress={() => navigation.navigate('Diagnostics')} last />
      </Section>

      {!!error && <Text style={s.saveError} accessibilityRole="alert">{error}</Text>}
      {saving && <Text style={s.saving}>Saving…</Text>}

      <DriverProfileEditModal
        visible={profileOpen}
        profile={profile}
        onCancel={() => setProfileOpen(false)}
        onSaved={(saved) => { setProfile(saved); setProfileOpen(false); }}
      />
    </Screen>
  );
}

<<<<<<< HEAD
function SegRow<T extends string>({ label, hint, value, onChange, options }: { label: string; hint?: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <View style={[s.row, s.rowDivider, s.segRow]}>
      <View style={s.rowText}>
        <Text style={s.rowLabel}>{label}</Text>
        {!!hint && <Text style={s.rowHint}>{hint}</Text>}
      </View>
      <NeuSegmented value={value} onChange={onChange} options={options} />
=======
function AppearanceOption({ label, selected, disabled, onPress }: { label: string; selected: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[s.appearanceOption, selected && s.appearanceSelected, disabled && s.disabledRow]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
    >
      <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={19} color={selected ? colors.primary : colors.textMuted} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      <Text style={[s.appearanceLabel, selected && s.appearanceLabelSelected]}>{label}</Text>
    </Pressable>
  );
}

function Section({ title, description, children, grouped = false }: { title: string; description?: string; children: React.ReactNode; grouped?: boolean }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {description ? <Text style={s.sectionDescription}>{description}</Text> : null}
      {grouped ? children : <View style={s.group}>{children}</View>}
>>>>>>> 085d579c1634fc5cd9a597346cae31cf95b819b5
    </View>
  );
}

<<<<<<< HEAD
function Section({ title, description, children, grouped = false }: { title: string; description?: string; children: React.ReactNode; grouped?: boolean }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {description ? <Text style={s.sectionDescription}>{description}</Text> : null}
      {grouped ? children : <View style={s.group}>{children}</View>}
    </View>
  );
}

=======
>>>>>>> 085d579c1634fc5cd9a597346cae31cf95b819b5
function LinkRow({ label, hint, value, onPress, last = false }: { label: string; hint?: string; value?: string; onPress: () => void; last?: boolean }) {
  return (
    <TouchableOpacity style={[s.row, !last && s.rowDivider]} onPress={onPress} accessibilityRole="button">
      <View style={s.rowText}>
        <Text style={s.rowLabel}>{label}</Text>
        {!!hint && <Text style={s.rowHint}>{hint}</Text>}
      </View>
      {!!value && <Text style={s.rowValue}>{value}</Text>}
      <Ionicons name="chevron-forward" size={17} color={colors.textMuted} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
    </TouchableOpacity>
  );
}

function ToggleRow({ label, hint, value, disabled, onValueChange, last = false }: { label: string; hint?: string; value: boolean; disabled: boolean; onValueChange: (value: boolean) => void; last?: boolean }) {
  return (
    <View style={[s.row, !last && s.rowDivider, disabled && s.disabledRow]}>
      <View style={s.rowText}>
        <Text style={s.rowLabel}>{label}</Text>
        {!!hint && <Text style={s.rowHint}>{hint}</Text>}
      </View>
<<<<<<< HEAD
      <NeuToggle value={value} onChange={onValueChange} label={label} disabled={disabled} />
=======
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor={value ? colors.primaryInk : colors.textMuted}
        accessibilityLabel={label}
      />
>>>>>>> 085d579c1634fc5cd9a597346cae31cf95b819b5
    </View>
  );
}

const s = StyleSheet.create({
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xl, padding: spacing.lg, borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primaryTint, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 1, borderColor: colors.primary },
  avatarImage: { width: '100%', height: '100%' },
  profileCopy: { flex: 1, minWidth: 0 },
  profileName: { ...typography.body, fontWeight: '700' },
  profileHint: { ...typography.caption, marginTop: spacing.xs },
  editProfile: { minHeight: 44, minWidth: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radii.sm, backgroundColor: colors.primaryTint },
  editProfileText: { ...typography.label, color: colors.primaryBright },
  appearanceChoices: { flexDirection: 'row', gap: spacing.sm },
  appearanceOption: { flex: 1, minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.md },
  appearanceSelected: { borderColor: colors.primary, backgroundColor: colors.primaryTint },
  appearanceLabel: { ...typography.label, color: colors.textMuted },
  appearanceLabelSelected: { color: colors.primaryBright },
  section: { marginBottom: spacing.xl },
  sectionTitle: { ...typography.caption, color: colors.textMuted, letterSpacing: 1.2, fontWeight: '700', marginBottom: spacing.sm, marginLeft: spacing.xs },
  sectionDescription: { ...typography.caption, marginHorizontal: spacing.xs, marginBottom: spacing.sm, lineHeight: 17 },
  groupLabel: { ...typography.caption, color: colors.textMuted, fontWeight: '700', letterSpacing: 0.8, marginLeft: spacing.xs, marginTop: spacing.sm, marginBottom: spacing.xs },
  group: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, overflow: 'hidden' },
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
<<<<<<< HEAD
  segRow: { flexDirection: 'column', alignItems: 'stretch', gap: spacing.sm },
=======
>>>>>>> 085d579c1634fc5cd9a597346cae31cf95b819b5
  rowDivider: { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { ...typography.body, fontWeight: '600' },
  rowHint: { ...typography.caption, marginTop: spacing.xs, lineHeight: 17 },
  rowValue: { ...typography.caption, color: colors.primaryBright },
  disabledRow: { opacity: 0.55 },
  notificationFootnote: { ...typography.caption, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg, lineHeight: 17 },
  saveError: { ...typography.caption, color: colors.danger, marginTop: spacing.sm },
  saving: { ...typography.caption, marginTop: spacing.xs },
});
