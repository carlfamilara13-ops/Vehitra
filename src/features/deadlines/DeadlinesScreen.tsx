import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Crypto from 'expo-crypto';
import { getDb } from '../../data/local/db';
import {
  DEADLINE_KIND_LABELS,
  DEADLINE_KINDS,
  listDeadlines,
  parseDeadlineOffsets,
  setDeadlineEnabled,
  softDeleteDeadline,
  upsertDeadline,
  type DeadlineKind,
  type DeadlineRow,
} from '../../data/local/deadlineStore';
import { getAppSettings, updateAppSettings } from '../../data/local/settingsStore';
import { listVehicles, vehicleDisplayName, type VehicleRow } from '../../data/local/vehicleStore';
import {
  daysUntilDateOnly,
  deadlinePhase,
  nextOffsetDays,
  REMINDER_OFFSET_CHOICES,
  reminderFireAt,
} from '../../domain/reminders/dates';
import { createNotificationsAdapter } from '../reminders/notifications';
import { syncReminders, type SyncResult } from '../reminders/scheduler';
import Screen from '../../ui/Screen';
import Placeholder from '../../ui/Placeholder';
import { colors, radii, spacing, typography } from '../../ui/theme';

// Mirrors the store's VEHICLE_BOUND_KINDS rule (registration/insurance/inspection must have a
// vehicle; the store + DB trigger enforce it — this only decides when to show the picker).
const VEHICLE_BOUND_KINDS: readonly DeadlineKind[] = ['registration', 'insurance', 'inspection'];

type FormState = {
  id: string | null;
  kind: DeadlineKind;
  vehicleId: string | null;
  label: string;
  dueDate: string;
  offsets: number[];
  enabled: boolean;
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysLabel(days: number | null): string {
  if (days == null) return 'date not set';
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`;
  if (days === 0) return 'due today';
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

// Expiry/renewal reminders (registration, licence, insurance, inspection, custom) with their
// notice schedule, plus the apply-step control for local notifications. Every mutation re-runs
// the scheduler so the ledger and platform never drift from what is on screen.
export default function DeadlinesScreen() {
  const adapter = useMemo(() => createNotificationsAdapter(), []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deadlines, setDeadlines] = useState<DeadlineRow[]>([]);
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [syncInfo, setSyncInfo] = useState<SyncResult | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);

  const vehicleName = useCallback(
    (id: string | null) => {
      if (!id) return null;
      const v = vehicles.find((x) => x.id === id);
      return v ? vehicleDisplayName(v) : 'Removed vehicle';
    },
    [vehicles],
  );

  const runSync = useCallback(async () => {
    setSyncing(true);
    try {
      const db = await getDb();
      const result = await syncReminders(db, adapter);
      setSyncInfo(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, [adapter]);

  const refresh = useCallback(async () => {
    try {
      const db = await getDb();
      const [list, vehs, settings] = await Promise.all([
        listDeadlines(db),
        listVehicles(db),
        getAppSettings(db),
      ]);
      setDeadlines(list);
      setVehicles(vehs);
      setNotifEnabled(settings.notifications_enabled === 1);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        await refresh();
        if (!cancelled) await runSync();
      })().catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }, [refresh, runSync]),
  );

  const save = useCallback(async () => {
    if (!form) return;
    if (!DATE_RE.test(form.dueDate.trim())) {
      setError('Enter the due date as YYYY-MM-DD (e.g. 2026-12-31).');
      return;
    }
    setSaving(true);
    try {
      const db = await getDb();
      await upsertDeadline(db, {
        id: form.id ?? Crypto.randomUUID(),
        kind: form.kind,
        user_vehicle_id: form.vehicleId,
        label: form.label.trim() || null,
        due_date: form.dueDate.trim(),
        reminder_offsets: form.offsets,
        enabled: form.enabled,
      });
      setForm(null);
      await refresh();
      await runSync();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [form, refresh, runSync]);

  const remove = useCallback(
    (row: DeadlineRow) => {
      Alert.alert('Remove reminder', 'This removes the reminder and its scheduled notices.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                const db = await getDb();
                await softDeleteDeadline(db, row.id);
                setForm((f) => (f?.id === row.id ? null : f));
                await refresh();
                await runSync();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            })();
          },
        },
      ]);
    },
    [refresh, runSync],
  );

  const toggleEnabled = useCallback(
    async (row: DeadlineRow, enabled: boolean) => {
      try {
        const db = await getDb();
        await setDeadlineEnabled(db, row.id, enabled);
        await refresh();
        await runSync();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [refresh, runSync],
  );

  const toggleNotifications = useCallback(
    async (on: boolean) => {
      setNotifEnabled(on);
      try {
        const db = await getDb();
        await updateAppSettings(db, { notifications_enabled: on });
        await runSync();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [runSync],
  );

  const startAdd = useCallback(() => {
    const preferred = vehicles.find((v) => v.id) ?? null;
    setForm({
      id: null,
      kind: 'registration',
      vehicleId: preferred?.id ?? null,
      label: '',
      dueDate: '',
      offsets: [30, 7, 3, 0],
      enabled: true,
    });
    setError(null);
  }, [vehicles]);

  const startEdit = useCallback((row: DeadlineRow) => {
    setForm({
      id: row.id,
      kind: (DEADLINE_KINDS as readonly string[]).includes(row.kind)
        ? (row.kind as DeadlineKind)
        : 'custom',
      vehicleId: row.user_vehicle_id,
      label: row.label ?? '',
      dueDate: row.due_date,
      offsets: parseDeadlineOffsets(row.reminder_offsets),
      enabled: row.enabled === 1,
    });
    setError(null);
  }, []);

  if (loading) {
    return (
      <Screen title="Reminders" scroll={false}>
        <ActivityIndicator color={colors.primary} style={s.loading} />
      </Screen>
    );
  }

  const now = Date.now();
  const boundKind = form ? VEHICLE_BOUND_KINDS.includes(form.kind) : false;

  return (
    <Screen
      title="Reminders"
      subtitle="Expiry dates and notices"
      right={
        <TouchableOpacity style={s.addBtn} onPress={startAdd} accessibilityRole="button" accessibilityLabel="Add reminder">
          <Text style={s.addBtnTxt}>+ Add</Text>
        </TouchableOpacity>
      }
    >
      {!!error && (
        <View style={s.errorCard}>
          <Text style={s.errorTxt}>{error}</Text>
        </View>
      )}

      <View style={s.card}>
        <View style={s.cardHead}>
          <Text style={s.cardTitle}>Notifications</Text>
          <Switch
            value={notifEnabled}
            onValueChange={(v) => void toggleNotifications(v)}
            trackColor={{ false: colors.surfaceRaised, true: colors.primary }}
            thumbColor={colors.text}
            accessibilityLabel="Reminder notifications"
          />
        </View>
        {!adapter.available ? (
          <Text style={s.muted}>
            Notifications are unavailable in this build — a native rebuild with expo-notifications
            is required. Notices still show here in the app.
          </Text>
        ) : syncInfo?.permissionDenied ? (
          <Text style={s.warn}>
            Notification permission is denied, so nothing can be delivered. Enable it in system
            settings, then refresh.
          </Text>
        ) : syncInfo ? (
          <Text style={s.muted}>
            {notifEnabled
              ? `${syncInfo.plans} notice${syncInfo.plans === 1 ? '' : 's'} scheduled · ${syncInfo.unchanged} unchanged. Delivery time is approximate — the OS may batch notifications.`
              : 'Reminders are recorded here but not pushed while notifications are off.'}
          </Text>
        ) : (
          <Text style={s.muted}>Local notifications only — nothing leaves this device.</Text>
        )}
        <TouchableOpacity
          style={s.btnGhost}
          onPress={() => void runSync()}
          disabled={syncing}
          accessibilityRole="button"
        >
          <Text style={s.btnGhostTxt}>{syncing ? 'Refreshing…' : 'Refresh notices'}</Text>
        </TouchableOpacity>
      </View>

      {deadlines.length === 0 && !form && (
        <Placeholder
          title="No reminders yet"
          message="Add registration, licence, insurance or inspection dates and Vehitra will tell you as each one approaches."
        />
      )}

      {deadlines.map((row) => {
        const days = daysUntilDateOnly(row.due_date, now);
        const phase = deadlinePhase(days);
        const offsets = parseDeadlineOffsets(row.reminder_offsets);
        const nextOffset = row.enabled === 1 ? nextOffsetDays(days, offsets) : null;
        const nextFire = nextOffset != null ? reminderFireAt(row.due_date, nextOffset) : null;
        const tone =
          phase === 'overdue'
            ? { color: colors.danger }
            : phase === 'due_soon'
              ? { color: colors.warningText }
              : { color: colors.textMuted };

        return (
          <View key={row.id} style={s.card}>
            <View style={s.cardHead}>
              <View style={s.cardText}>
                <Text style={s.cardTitle}>{row.label || DEADLINE_KIND_LABELS[row.kind as DeadlineKind] || row.kind}</Text>
                <Text style={s.muted}>{vehicleName(row.user_vehicle_id) ?? 'All vehicles'}</Text>
              </View>
              <Switch
                value={row.enabled === 1}
                onValueChange={(v) => void toggleEnabled(row, v)}
                trackColor={{ false: colors.surfaceRaised, true: colors.primary }}
                thumbColor={colors.text}
                accessibilityLabel={`Reminders for ${row.label || row.kind}`}
              />
            </View>
            <Text style={[s.due, tone]}>
              Due {row.due_date} · {daysLabel(days)}
              {row.enabled === 0 ? ' · off' : ''}
            </Text>
            {nextFire != null && (
              <Text style={s.muted}>
                Next notice {new Date(nextFire).toLocaleDateString()} ({nextOffset}
                {'-day notice'}) · all notices: {offsets.map((o) => (o === 0 ? 'on the day' : `${o}d`)).join(', ')}
              </Text>
            )}
            <View style={s.rowActions}>
              <TouchableOpacity style={s.btnGhostSm} onPress={() => startEdit(row)} accessibilityRole="button">
                <Text style={s.btnGhostSmTxt}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.btnGhostSm}
                onPress={() => remove(row)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${row.label || row.kind}`}
              >
                <Text style={[s.btnGhostSmTxt, { color: colors.danger }]}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}

      {form && (
        <View style={s.card}>
          <Text style={s.cardTitle}>{form.id ? 'Edit reminder' : 'New reminder'}</Text>

          <Text style={s.fieldLabel}>Type</Text>
          <View style={s.chips}>
            {DEADLINE_KINDS.map((k) => {
              const selected = k === form.kind;
              return (
                <TouchableOpacity
                  key={k}
                  style={[s.chip, selected && s.chipSelected]}
                  onPress={() => setForm({ ...form, kind: k })}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[s.chipTxt, selected && s.chipTxtSelected]}>{DEADLINE_KIND_LABELS[k]}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {boundKind && (
            <>
              <Text style={s.fieldLabel}>Vehicle</Text>
              <View style={s.chips}>
                {vehicles.map((v) => {
                  const selected = v.id === form.vehicleId;
                  return (
                    <TouchableOpacity
                      key={v.id}
                      style={[s.chip, selected && s.chipSelected]}
                      onPress={() => setForm({ ...form, vehicleId: v.id })}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                    >
                      <Text style={[s.chipTxt, selected && s.chipTxtSelected]}>
                        {v.nickname || v.model || v.brand || 'Vehicle'}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          <Text style={s.fieldLabel}>Label (optional)</Text>
          <TextInput
            style={s.input}
            value={form.label}
            onChangeText={(t) => setForm({ ...form, label: t })}
            placeholder="e.g. MY Bike registration"
            placeholderTextColor={colors.textMuted}
          />

          <Text style={s.fieldLabel}>Due date (YYYY-MM-DD)</Text>
          <TextInput
            style={s.input}
            value={form.dueDate}
            onChangeText={(t) => setForm({ ...form, dueDate: t })}
            placeholder="2026-12-31"
            placeholderTextColor={colors.textMuted}
            keyboardType="numbers-and-punctuation"
          />

          <Text style={s.fieldLabel}>Tell me before</Text>
          <View style={s.chips}>
            {REMINDER_OFFSET_CHOICES.map((o) => {
              const selected = form.offsets.includes(o);
              return (
                <TouchableOpacity
                  key={o}
                  style={[s.chip, selected && s.chipSelected]}
                  onPress={() =>
                    setForm({
                      ...form,
                      offsets: selected ? form.offsets.filter((x) => x !== o) : [...form.offsets, o].sort((a, b) => b - a),
                    })
                  }
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[s.chipTxt, selected && s.chipTxtSelected]}>{o === 0 ? 'On the day' : `${o}d`}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={s.enabledRow}>
            <Text style={s.muted}>Reminders on</Text>
            <Switch
              value={form.enabled}
              onValueChange={(v) => setForm({ ...form, enabled: v })}
              trackColor={{ false: colors.surfaceRaised, true: colors.primary }}
              thumbColor={colors.text}
              accessibilityLabel="Reminders on"
            />
          </View>

          <View style={s.formActions}>
            <TouchableOpacity
              style={s.btnPrimary}
              onPress={() => void save()}
              disabled={saving}
              accessibilityRole="button"
            >
              <Text style={s.btnPrimaryTxt}>{saving ? 'Saving…' : 'Save reminder'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.btnGhost} onPress={() => setForm(null)} accessibilityRole="button">
              <Text style={s.btnGhostTxt}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Text style={s.footnote}>
        Notices are planned on this device. Vehitra cannot guarantee the exact delivery time.
      </Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  loading: { marginTop: spacing.xl },
  addBtn: {
    borderColor: colors.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  addBtnTxt: { ...typography.body, color: colors.primary, fontWeight: '700' },
  errorCard: {
    backgroundColor: colors.surface,
    borderColor: colors.danger,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  errorTxt: { ...typography.body, color: colors.danger },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardText: { flex: 1, paddingRight: spacing.md },
  cardTitle: { ...typography.heading, fontSize: 16 },
  muted: { ...typography.body, color: colors.textMuted, marginTop: spacing.xs, lineHeight: 20 },
  warn: { ...typography.body, color: colors.warningText, marginTop: spacing.xs, lineHeight: 20 },
  due: { ...typography.label, marginTop: spacing.sm },
  rowActions: { flexDirection: 'row', marginTop: spacing.md },
  fieldLabel: { ...typography.label, marginTop: spacing.md, marginBottom: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.pill,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceRaised,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipTxt: { ...typography.caption, color: colors.textMuted },
  chipTxtSelected: { color: '#FFFFFF', fontWeight: '700' },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.text,
    ...typography.body,
  },
  enabledRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md },
  formActions: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg },
  btnPrimary: {
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    marginRight: spacing.md,
  },
  btnPrimaryTxt: { ...typography.body, color: '#FFFFFF', fontWeight: '700' },
  btnGhost: {
    alignSelf: 'flex-start',
    borderColor: colors.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginRight: spacing.md,
  },
  btnGhostTxt: { ...typography.body, color: colors.primary, fontWeight: '600' },
  btnGhostSm: {
    borderColor: colors.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    marginRight: spacing.sm,
  },
  btnGhostSmTxt: { ...typography.caption, color: colors.primary, fontWeight: '600' },
  footnote: { ...typography.caption, textAlign: 'center', marginTop: spacing.sm, lineHeight: 16 },
});
