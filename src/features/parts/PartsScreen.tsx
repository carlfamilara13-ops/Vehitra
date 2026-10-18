import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { getDb } from '../../data/local/db';
import {
  getActiveVehicle,
  setVehicleOdometer,
  vehicleDisplayName,
  VEHICLE_TYPE_LABELS,
  type VehicleRow,
} from '../../data/local/vehicleStore';
import { evaluateVehicleMaintenance, type ComponentMaintenance } from '../../data/local/maintenanceQuery';
import { getComponentDefinition } from '../../domain/maintenance/components';
import Screen from '../../ui/Screen';
import Placeholder from '../../ui/Placeholder';
import { colors, radii, spacing, typography } from '../../ui/theme';
import type { RootTabParamList } from '../../app/RootNavigator';
import ComponentManagePanel from './ComponentManagePanel';
import {
  categoryLabel,
  formatKm,
  intervalSourceNote,
  matchesQuery,
  parseOdometerKm,
  progressFraction,
  reasonLabel,
  STATUS_LABELS,
  STATUS_TONES,
  summarize,
  usageLine,
  type StatusTone,
} from './partsView';

type Props = BottomTabScreenProps<RootTabParamList, 'Parts'>;

const TONE_COLORS: Record<StatusTone, string> = {
  good: colors.success,
  due: colors.warningText,
  overdue: colors.danger,
  unknown: colors.textMuted,
  off: colors.textMuted,
};

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

const typeLabel = (v: VehicleRow) =>
  (VEHICLE_TYPE_LABELS as Record<string, string>)[v.vehicle_type] ?? v.vehicle_type;

// Maintenance overview for the active vehicle. Status, reason, interval and progress are always the
// values returned by the maintenance evaluator; this screen only draws them, collects edits and
// re-reads after each write. Summary counts are deliberately vehicle-wide (over the whole component
// list) even while the search box filters the cards below, so the overview never changes with search.
export default function PartsScreen({ navigation }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<VehicleRow | null>(null);
  const [items, setItems] = useState<ComponentMaintenance[]>([]);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const db = await getDb();
      const active = await getActiveVehicle(db);
      if (!active) {
        setVehicle(null);
        setItems([]);
        setError(null);
        return;
      }
      const model = await evaluateVehicleMaintenance(db, active.id);
      if (!model) {
        // The active vehicle was removed between the two reads.
        setVehicle(null);
        setItems([]);
        setError(null);
        return;
      }
      setVehicle(model.vehicle);
      setItems(model.items);
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

  const counts = useMemo(() => summarize(items.map((i) => i.evaluation.status)), [items]);
  const filtered = useMemo(() => items.filter((i) => matchesQuery(i, query)), [items, query]);

  return (
    <Screen title="Parts" subtitle="Maintenance overview" keyboardShouldPersistTaps="handled">
      {loading ? (
        <ActivityIndicator color={colors.primary} style={s.loading} />
      ) : error ? (
        <View style={[s.card, s.errorCard]}>
          <Text style={s.cardTitle}>Could not read maintenance</Text>
          <Text style={s.muted}>{error}</Text>
          <TouchableOpacity style={s.btnGhost} onPress={() => void load()} accessibilityRole="button">
            <Text style={s.btnGhostTxt}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : !vehicle ? (
        <>
          <Placeholder
            title="No active vehicle"
            message="Add a vehicle in the garage and set it active. Maintenance is shown for the active vehicle only."
          />
          <TouchableOpacity
            style={s.btn}
            onPress={() => navigation.navigate('Garage')}
            accessibilityRole="button"
          >
            <Text style={s.btnTxt}>Open garage</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <View style={s.vehicleCard}>
            <Text style={s.kicker}>{typeLabel(vehicle)}</Text>
            <Text style={s.cardTitle}>{vehicleDisplayName(vehicle)}</Text>
            <OdometerEditor
              key={vehicle.id}
              vehicleId={vehicle.id}
              currentKm={vehicle.odometer_km}
              onSaved={load}
            />
          </View>

          <View style={s.card}>
            <Text style={s.cardTitle}>Overview</Text>
            <View style={s.metrics}>
              <Stat value={counts.good} label="Good" tone="good" />
              <Stat value={counts.due_soon} label="Due soon" tone="due" />
              <Stat value={counts.overdue} label="Overdue" tone="overdue" />
              <Stat value={counts.unknown} label="Unknown" tone="unknown" />
            </View>
            {counts.not_applicable > 0 && (
              <Text style={s.muted}>{counts.not_applicable} not applicable to this vehicle.</Text>
            )}
            {counts.unknown > 0 && (
              <Text style={s.note}>
                Unknown means there is not enough recorded history yet — it is not a pass.
              </Text>
            )}
          </View>

          <TextInput
            style={s.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Search components"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search components by name or code"
          />

          {items.length === 0 ? (
            <Placeholder
              title="No components"
              message="No maintenance components apply to this vehicle type."
            />
          ) : filtered.length === 0 ? (
            <Placeholder
              title="No matches"
              message={`No components match "${query.trim()}". Try another name or code.`}
            />
          ) : (
            filtered.map((item) => (
              <ComponentCard
                key={item.componentCode}
                item={item}
                vehicleId={vehicle.id}
                defaultOdometerKm={vehicle.odometer_km}
                expanded={expanded === item.componentCode}
                onToggle={() =>
                  setExpanded((cur) => (cur === item.componentCode ? null : item.componentCode))
                }
                onSaved={load}
              />
            ))
          )}

          <Text style={s.footnote}>
            Everything here is stored on this device and works offline. Tap Manage on a component to
            set an interval or record a replacement, service or baseline.
          </Text>
        </>
      )}
    </Screen>
  );
}

function OdometerEditor({
  vehicleId,
  currentKm,
  onSaved,
}: {
  vehicleId: string;
  currentKm: number | null;
  onSaved: () => void;
}) {
  const [raw, setRaw] = useState(currentKm != null ? String(currentKm) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const save = async () => {
    const parsed = parseOdometerKm(raw);
    if (!parsed.ok) {
      setError(parsed.error);
      setOk(null);
      return;
    }
    setError(null);
    setOk(null);
    setBusy(true);
    try {
      const db = await getDb();
      await setVehicleOdometer(db, vehicleId, parsed.value);
      setOk('Odometer updated.');
      onSaved();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.odo}>
      <Text style={s.muted}>
        Current odometer: {currentKm != null ? `${formatKm(currentKm)} km` : 'not set'}
      </Text>
      <View style={s.odoRow}>
        <TextInput
          style={[s.input, s.flexInput]}
          value={raw}
          onChangeText={setRaw}
          placeholder="e.g. 12500.5"
          placeholderTextColor={colors.textMuted}
          keyboardType="numeric"
          accessibilityLabel="Current odometer in kilometres"
        />
        <TouchableOpacity
          style={[s.smallBtn, busy && s.disabled]}
          onPress={() => void save()}
          disabled={busy}
          accessibilityRole="button"
          accessibilityState={{ disabled: busy }}
        >
          <Text style={s.btnTxt}>Update</Text>
        </TouchableOpacity>
      </View>
      {!!error && <Text style={s.errorTxt}>{error}</Text>}
      {!!ok && <Text style={s.okTxt}>{ok}</Text>}
      <Text style={s.note}>
        This only records the number on your dashboard. It does not change maintenance history by
        itself — use a component's Replace or Baseline action for that.
      </Text>
    </View>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone: StatusTone }) {
  return (
    <View style={s.metric}>
      <Text style={[s.metricValue, { color: TONE_COLORS[tone] }]}>{value}</Text>
      <Text style={s.metricLabel}>{label}</Text>
    </View>
  );
}

function ComponentCard({
  item,
  vehicleId,
  defaultOdometerKm,
  expanded,
  onToggle,
  onSaved,
}: {
  item: ComponentMaintenance;
  vehicleId: string;
  defaultOdometerKm: number | null;
  expanded: boolean;
  onToggle: () => void;
  onSaved: () => void;
}) {
  const { evaluation } = item;
  const tone = STATUS_TONES[evaluation.status];
  const toneColor = TONE_COLORS[tone];
  const progress = evaluation.progress;
  const reason = reasonLabel(evaluation.reason);
  const source = progress && evaluation.rule ? intervalSourceNote(evaluation.rule.source) : null;
  const allowedActions = getComponentDefinition(item.componentCode)?.allowedActions ?? [];

  return (
    <View style={[s.card, tone === 'overdue' && s.cardOverdue]}>
      <View style={s.cardHead}>
        <View style={s.cardText}>
          <Text style={s.cardTitle}>{item.name}</Text>
          <Text style={s.code}>
            {categoryLabel(item.category)} · {item.componentCode}
          </Text>
        </View>
        <View style={[s.badge, { borderColor: toneColor }]}>
          <Text style={[s.badgeTxt, { color: toneColor }]}>{STATUS_LABELS[evaluation.status]}</Text>
        </View>
      </View>

      {progress ? (
        <>
          <View
            style={s.track}
            accessibilityRole="progressbar"
            accessibilityLabel={`${item.name} usage`}
            accessibilityValue={{ min: 0, max: 100, now: Math.min(100, Math.round(progress.usedPercent)) }}
          >
            <View
              style={[s.fill, { width: `${progressFraction(progress.usedPercent) * 100}%`, backgroundColor: toneColor }]}
            />
          </View>
          <Text style={s.muted}>{usageLine(progress.usedKm, progress.intervalKm, progress.remainingKm)}</Text>
          {source && <Text style={s.note}>{source}</Text>}
        </>
      ) : (
        <Text style={s.muted}>{reason ?? 'Not enough data to show a status yet.'}</Text>
      )}

      <TouchableOpacity
        style={s.manageBtn}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`Manage ${item.name}`}
      >
        <Text style={s.manageTxt}>{expanded ? 'Close' : 'Manage'}</Text>
      </TouchableOpacity>

      {expanded && (
        <ComponentManagePanel
          vehicleId={vehicleId}
          componentCode={item.componentCode}
          componentName={item.name}
          allowedActions={allowedActions}
          defaultOdometerKm={defaultOdometerKm}
          onSaved={onSaved}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  loading: { marginTop: spacing.xl },
  vehicleCard: {
    backgroundColor: colors.surface,
    borderColor: colors.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.lg,
  },
  odo: { marginTop: spacing.md, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing.md },
  odoRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginTop: spacing.md,
  },
  cardOverdue: { borderColor: colors.danger },
  errorCard: { borderColor: colors.danger },
  kicker: { ...typography.caption, color: colors.primary, letterSpacing: 1.5, fontWeight: '700' },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start' },
  cardText: { flex: 1 },
  cardTitle: { ...typography.heading, fontSize: 16, marginTop: spacing.xs },
  code: { ...typography.caption, marginTop: spacing.xs },
  muted: { ...typography.body, color: colors.textMuted, lineHeight: 20 },
  note: { ...typography.caption, lineHeight: 18, marginTop: spacing.sm },
  metrics: { flexDirection: 'row', marginTop: spacing.md },
  metric: { flex: 1 },
  metricValue: { ...typography.title, fontSize: 22 },
  metricLabel: { ...typography.caption, marginTop: spacing.xs },
  badge: {
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginLeft: spacing.sm,
  },
  badgeTxt: { ...typography.caption, fontWeight: '700' },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: 15,
  },
  flexInput: { flex: 1 },
  smallBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginLeft: spacing.sm,
  },
  btnTxt: { ...typography.body, color: colors.text, fontWeight: '700' },
  disabled: { opacity: 0.6 },
  track: {
    height: 8,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  fill: { height: 8, borderRadius: radii.pill },
  manageBtn: {
    alignSelf: 'flex-start',
    borderColor: colors.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  manageTxt: { ...typography.body, color: colors.primary, fontWeight: '600' },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },
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
  errorTxt: { ...typography.caption, color: colors.danger, marginTop: spacing.sm },
  okTxt: { ...typography.caption, color: colors.success, marginTop: spacing.sm },
  footnote: { ...typography.caption, marginTop: spacing.lg, marginBottom: spacing.lg, lineHeight: 18 },
});
