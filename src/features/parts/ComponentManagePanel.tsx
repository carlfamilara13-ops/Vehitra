import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as Crypto from 'expo-crypto';
import { getDb } from '../../data/local/db';
import { deleteOverride, getOverride, upsertOverride } from '../../data/local/overrideStore';
import { insertServiceEvent, listServiceEvents, type ServiceEventRow } from '../../data/local/serviceStore';
import { listInstalls, replaceInstall, type PartInstallRow } from '../../data/local/installStore';
import { colors, radii, spacing, typography } from '../../ui/theme';
import {
  parseDateInput,
  parseIntervalKm,
  parseOptionalOdometerKm,
  todayInput,
} from './partsView';

// Inline forms for one component of the selected vehicle: a custom distance interval (override), and
// recording a replacement / generic maintenance / explicit baseline. Every write goes through the
// existing stores (which validate and serialize); this component never touches SQL directly and never
// computes a status. After a successful write it calls onSaved so Parts can re-read the overview.

type RecordMode = 'replace' | 'log' | 'baseline';

const LOG_ACTIONS = ['inspect', 'clean', 'lubricate'] as const;

const MODE_HINT: Record<RecordMode, string> = {
  replace: 'Records a new part or fluid and restarts usage from the chosen date and odometer.',
  log: 'A maintenance note. It is logged but does NOT restart the usage interval.',
  baseline: 'Sets a starting point for unknown history. Usage is counted from the chosen date.',
};

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type Props = {
  vehicleId: string;
  componentCode: string;
  componentName: string;
  allowedActions: readonly string[];
  defaultOdometerKm: number | null;
  onSaved: () => void;
};

export default function ComponentManagePanel({
  vehicleId,
  componentCode,
  componentName,
  allowedActions,
  defaultOdometerKm,
  onSaved,
}: Props) {
  const [intervalRaw, setIntervalRaw] = useState('');
  const [hasOverride, setHasOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [mode, setMode] = useState<RecordMode | null>(null);
  const [logAction, setLogAction] = useState<string>('service');
  const [dateRaw, setDateRaw] = useState(todayInput());
  const [odoRaw, setOdoRaw] = useState(defaultOdometerKm != null ? String(defaultOdometerKm) : '');
  const [notesRaw, setNotesRaw] = useState('');

  // Synchronous in-flight gate. A ref flips before the first await, so a second tap in the same
  // frame is ignored instead of firing a duplicate write; `busy` still drives the disabled state.
  const inFlight = useRef(false);

  // Reset every field to the defaults for the current vehicle/component whenever the target changes,
  // then load the stored override. Keyed on defaultOdometerKm too so the odometer prefill always
  // matches the shown vehicle and cannot be carried over from a previous one.
  useEffect(() => {
    let alive = true;
    setMode(null);
    setLogAction('service');
    setDateRaw(todayInput());
    setOdoRaw(defaultOdometerKm != null ? String(defaultOdometerKm) : '');
    setNotesRaw('');
    setError(null);
    setOk(null);
    setHasOverride(false);
    setIntervalRaw('');
    (async () => {
      try {
        const db = await getDb();
        const existing = await getOverride(db, vehicleId, componentCode);
        if (!alive) return;
        setHasOverride(!!existing);
        setIntervalRaw(existing?.interval_km != null ? String(existing.interval_km) : '');
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [vehicleId, componentCode, defaultOdometerKm]);

  const saveInterval = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setOk(null);
    try {
      const parsed = parseIntervalKm(intervalRaw);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      setBusy(true);
      const db = await getDb();
      await upsertOverride(db, {
        id: Crypto.randomUUID(),
        user_vehicle_id: vehicleId,
        component_code: componentCode,
        interval_km: parsed.value,
      });
      setHasOverride(true);
      setOk('Custom interval saved.');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [intervalRaw, vehicleId, componentCode, onSaved]);

  const removeInterval = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setOk(null);
    try {
      setBusy(true);
      const db = await getDb();
      await deleteOverride(db, vehicleId, componentCode);
      setHasOverride(false);
      setIntervalRaw('');
      setOk('Custom interval removed.');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [vehicleId, componentCode, onSaved]);

  const submitRecord = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setOk(null);
    try {
      const date = parseDateInput(dateRaw);
      if (!date.ok) {
        setError(date.error);
        return;
      }
      const odo = parseOptionalOdometerKm(odoRaw);
      if (!odo.ok) {
        setError(odo.error);
        return;
      }
      if (!mode) return;
      setBusy(true);
      const notes = notesRaw.trim() || null;
      const db = await getDb();
      if (mode === 'replace') {
        await replaceInstall(db, {
          id: Crypto.randomUUID(),
          user_vehicle_id: vehicleId,
          component_code: componentCode,
          installed_at: date.value,
          install_odo: odo.value,
          notes,
        });
        setOk('Replacement recorded. Usage restarts from this date.');
      } else if (mode === 'baseline') {
        await insertServiceEvent(db, {
          id: Crypto.randomUUID(),
          user_vehicle_id: vehicleId,
          component_code: componentCode,
          action: 'baseline',
          performed_at: date.value,
          odo_at: odo.value,
          estimated: true,
          notes,
        });
        setOk('Baseline recorded. Usage counts from this date.');
      } else {
        await insertServiceEvent(db, {
          id: Crypto.randomUUID(),
          user_vehicle_id: vehicleId,
          component_code: componentCode,
          action: logAction as 'service' | 'inspect' | 'clean' | 'lubricate',
          performed_at: date.value,
          odo_at: odo.value,
          notes,
        });
        setOk('Maintenance logged. The usage interval was not reset.');
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [dateRaw, odoRaw, notesRaw, mode, logAction, vehicleId, componentCode, onSaved]);

  const logChoices = ['service', ...LOG_ACTIONS.filter((a) => allowedActions.includes(a))];

  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [installs, setInstalls] = useState<PartInstallRow[]>([]);
  const [events, setEvents] = useState<ServiceEventRow[]>([]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const db = await getDb();
      const [inst, ev] = await Promise.all([
        listInstalls(db, vehicleId, componentCode),
        listServiceEvents(db, vehicleId, componentCode),
      ]);
      setInstalls(inst);
      setEvents(ev);
    } catch (e) {
      setError((e instanceof Error ? e.message : String(e)));
    } finally {
      setHistoryLoading(false);
    }
  }, [vehicleId, componentCode]);

  useEffect(() => {
    if (historyOpen) {
      void loadHistory();
    }
  }, [historyOpen, loadHistory]);

  const formatDate = (ms: number) => {
    try {
      const d = new Date(ms);
      return d.toLocaleDateString();
    } catch {
      return String(ms);
    }
  };

  return (
    <View style={s.panel}>
      <Text style={s.sectionTitle}>Custom interval</Text>
      <View style={s.row}>
        <TextInput
          style={[s.input, s.flexInput]}
          value={intervalRaw}
          onChangeText={setIntervalRaw}
          placeholder="Distance in km"
          placeholderTextColor={colors.textMuted}
          keyboardType="numeric"
          accessibilityLabel={`Custom interval for ${componentName}, in kilometres`}
        />
        <TouchableOpacity
          style={[s.smallBtn, busy && s.disabled]}
          onPress={() => void saveInterval()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
        >
          <Text style={s.smallBtnTxt}>Save</Text>
        </TouchableOpacity>
        {hasOverride && (
          <TouchableOpacity
            style={[s.smallGhost, busy && s.disabled]}
            onPress={() => void removeInterval()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
          >
            <Text style={s.smallGhostTxt}>Remove</Text>
          </TouchableOpacity>
        )}
      </View>
      <Text style={s.hint}>
        {hasOverride
          ? 'User configured — for this vehicle only, not a manufacturer recommendation.'
          : 'No custom interval. A local estimate is used only where one exists.'}
      </Text>

      <Text style={s.sectionTitle}>Record an event</Text>
      <View style={s.chips}>
        <Chip label="Replace part" active={mode === 'replace'} onPress={() => setMode('replace')} />
        <Chip label="Log maintenance" active={mode === 'log'} onPress={() => setMode('log')} />
        <Chip label="Set baseline" active={mode === 'baseline'} onPress={() => setMode('baseline')} />
      </View>

      {mode && (
        <>
          {mode === 'log' && (
            <View style={s.chips}>
              {logChoices.map((a) => (
                <Chip key={a} label={a} active={logAction === a} onPress={() => setLogAction(a)} />
              ))}
            </View>
          )}
          <TextInput
            style={s.input}
            value={dateRaw}
            onChangeText={setDateRaw}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Date, year month day"
          />
          <TextInput
            style={s.input}
            value={odoRaw}
            onChangeText={setOdoRaw}
            placeholder="Odometer at the time (km, optional)"
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
            accessibilityLabel="Odometer at the time, optional"
          />
          <TextInput
            style={s.input}
            value={notesRaw}
            onChangeText={setNotesRaw}
            placeholder="Notes (optional)"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Notes"
          />
          <Text style={s.hint}>{MODE_HINT[mode]}</Text>
          <TouchableOpacity
            style={[s.primaryBtn, busy && s.disabled]}
            onPress={() => void submitRecord()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
          >
            <Text style={s.smallBtnTxt}>
              {mode === 'replace' ? 'Save replacement' : mode === 'baseline' ? 'Save baseline' : 'Log maintenance'}
            </Text>
          </TouchableOpacity>
        </>
      )}

      <TouchableOpacity
        style={[s.manageBtn, { marginTop: spacing.lg }]}
        onPress={() => setHistoryOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: historyOpen }}
        accessibilityLabel={`History for ${componentName}`}
      >
        <Text style={s.manageTxt}>{historyOpen ? 'Hide history' : 'View history'}</Text>
      </TouchableOpacity>

      {historyOpen && (
        <View style={s.historySection}>
          <Text style={s.sectionTitle}>Installed parts</Text>
          {historyLoading && installs.length === 0 && events.length === 0 ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.sm }} />
          ) : installs.length === 0 ? (
            <Text style={s.hint}>No install records.</Text>
          ) : (
            installs.map((i) => (
              <View key={i.id} style={s.historyItem}>
                <Text style={s.historyTitle}>
                  {i.removed_at ? 'Replaced/removed' : 'Current install'}
                </Text>
                <Text style={s.hint}>
                  Installed {formatDate(i.installed_at)}
                  {i.install_odo != null ? ` · ${i.install_odo} km` : ''}
                </Text>
                {(i.brand || i.model) && (
                  <Text style={s.hint}>
                    {[i.brand, i.model].filter(Boolean).join(' · ')}
                  </Text>
                )}
                {i.removed_at && (
                  <Text style={s.hint}>
                    Removed {formatDate(i.removed_at)}
                    {i.removal_odo != null ? ` · ${i.removal_odo} km` : ''}
                    {i.close_notes ? ` · ${i.close_notes}` : ''}
                  </Text>
                )}
                {i.notes && <Text style={s.hint}>Notes: {i.notes}</Text>}
              </View>
            ))
          )}

          <Text style={[s.sectionTitle, { marginTop: spacing.md }]}>Service history</Text>
          {historyLoading && events.length === 0 ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.sm }} />
          ) : events.length === 0 ? (
            <Text style={s.hint}>No service events.</Text>
          ) : (
            events
              .slice()
              .reverse()
              .map((ev) => (
                <View key={ev.id} style={s.historyItem}>
                  <Text style={s.historyTitle}>{ev.action}</Text>
                  <Text style={s.hint}>
                    {formatDate(ev.performed_at)}
                    {ev.odo_at != null ? ` · ${ev.odo_at} km` : ''}
                    {ev.estimated ? ' · estimated' : ''}
                    {ev.voids_event_id ? ' · void' : ''}
                  </Text>
                  {ev.notes && <Text style={s.hint}>{ev.notes}</Text>}
                </View>
              ))
          )}
        </View>
      )}

      {!!error && <Text style={s.errorTxt}>{error}</Text>}
      {!!ok && <Text style={s.okTxt}>{ok}</Text>}
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[s.chip, active && s.chipSelected]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <Text style={[s.chipTxt, active && s.chipTxtSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  panel: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  flexInput: { flex: 1 },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: 15,
    marginBottom: spacing.sm,
  },
  smallBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginLeft: spacing.sm,
  },
  smallBtnTxt: { ...typography.body, color: colors.text, fontWeight: '700' },
  smallGhost: {
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginLeft: spacing.sm,
  },
  smallGhostTxt: { ...typography.body, color: colors.textMuted },
  hint: { ...typography.caption, lineHeight: 18, marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm },
  chip: {
    borderColor: colors.glassBorder,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginRight: spacing.sm,
    marginBottom: spacing.sm,
  },
  chipSelected: { borderColor: colors.primaryBright, backgroundColor: colors.primaryTint },
  chipTxt: { ...typography.body, color: colors.textMuted },
  chipTxtSelected: { color: colors.primaryBright, fontWeight: '700' },
  primaryBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  disabled: { opacity: 0.6 },
  manageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
    borderColor: 'rgba(77, 141, 255, 0.45)',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.primaryTint,
  },
  manageTxt: { ...typography.label, color: colors.primaryBright, fontWeight: '600' },
  historySection: { marginTop: spacing.md },
  historyItem: {
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
  },
  historyTitle: { ...typography.label, textTransform: 'capitalize' },
  errorTxt: { ...typography.caption, color: colors.dangerText, marginTop: spacing.sm },
  okTxt: { ...typography.caption, color: colors.successText, marginTop: spacing.sm },
});
