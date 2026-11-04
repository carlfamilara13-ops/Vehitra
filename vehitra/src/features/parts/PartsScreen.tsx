
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, type ColorValue, StyleSheet } from 'react-native';
import { TouchableOpacity, View } from '../../ui/neu/NeuAuto';
import { Text, TextInput } from '../../ui/neu/NeuText';
import { useFocusEffect } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getDb } from '../../data/local/db';
import {
  getActiveVehicle,
  setVehicleOdometer,
  vehicleDisplayName,
  VEHICLE_TYPE_LABELS,
  type VehicleRow,
} from '../../data/local/vehicleStore';
import {
  evaluateVehicleMaintenance,
  type ComponentMaintenance,
} from '../../data/local/maintenanceQuery';
import { getComponentDefinition } from '../../domain/maintenance/components';
import { distanceUnit, KM_PER_MILE } from '../../domain/units';
import Screen from '../../ui/Screen';
import Placeholder from '../../ui/Placeholder';

import { colors, radii, spacing, typography } from '../../ui/theme';
import { tabBarBottomClearance } from '../../ui/tabBarLayout';
import type { RootTabParamList } from '../../app/RootNavigator';
import { usePrefs } from '../../app/prefs';
import ComponentManagePanel from './ComponentManagePanel';
import AddPartPanel from './AddPartPanel';
import { refreshLocalReminders } from '../reminders/refresh';
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

const TONE_COLORS: Record<StatusTone, ColorValue> = {
  good: colors.successText,
  due: colors.warningText,
  overdue: colors.dangerText,
  unknown: colors.textMuted,
  off: colors.textMuted,
};

const TONE_PILL: Record<StatusTone, { bg: ColorValue; border: ColorValue }> = {
  good: { bg: colors.surfaceRaised, border: 'transparent' },
  due: { bg: colors.surfaceRaised, border: 'transparent' },
  overdue: { bg: colors.surfaceRaised, border: 'transparent' },
  unknown: { bg: colors.surfaceRaised, border: 'transparent' },
  off: { bg: colors.surfaceRaised, border: 'transparent' },
};

const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  engine: 'cog-outline',
  fluids: 'water-outline',
  brakes: 'stop-circle-outline',
  wheels_tires: 'disc-outline',
  electrical: 'flash-outline',
  transmission: 'git-branch-outline',
};

const errText = (e: unknown) =>
  e instanceof Error ? e.message : String(e);

const typeLabel = (v: VehicleRow) =>
  (VEHICLE_TYPE_LABELS as Record<string, string>)[v.vehicle_type] ??
  v.vehicle_type;

// Maintenance overview for the active vehicle. Status, reason, interval and
// progress are always the values returned by the maintenance evaluator.
export default function PartsScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<VehicleRow | null>(null);
  const [items, setItems] = useState<ComponentMaintenance[]>([]);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [addPartOpen, setAddPartOpen] = useState(false);

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
        setVehicle(null);
        setItems([]);
        setError(null);
        return;
      }

      setVehicle(model.vehicle);
      setItems(model.items);
      setError(null);
    } catch (e) {
      setError(errText(e));
    } finally {
      setLoading(false);
      void refreshLocalReminders().catch(() => undefined);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const counts = useMemo(
    () => summarize(items.map((i) => i.evaluation.status)),
    [items],
  );

  const filtered = useMemo(
    () => items.filter((i) => matchesQuery(i, query)),
    [items, query],
  );

  const attentionItems = useMemo(
    () =>
      items
        .filter(
          (item) =>
            item.evaluation.status === 'overdue' ||
            item.evaluation.status === 'due_soon',
        )
        .sort(
          (a, b) =>
            Number(b.evaluation.status === 'overdue') -
            Number(a.evaluation.status === 'overdue'),
        ),
    [items],
  );

  const categories = useMemo(() => {
    const grouped = new Map<string, ComponentMaintenance[]>();

    for (const item of items) {
      const group = grouped.get(item.category) ?? [];
      group.push(item);
      grouped.set(item.category, group);
    }

    return Array.from(grouped, ([code, components]) => ({
      code,
      components,
    }));
  }, [items]);

  const renderComponent = (item: ComponentMaintenance) => (
    <ComponentCard
      key={item.componentCode}
      item={item}
      vehicleId={vehicle!.id}
      defaultOdometerKm={vehicle!.odometer_km}
      expanded={expanded === item.componentCode}
      onToggle={() =>
        setExpanded((cur) =>
          cur === item.componentCode ? null : item.componentCode,
        )
      }
      onSaved={load}
    />
  );

  return (
    <Screen
      title="Parts"
      subtitle="Maintenance overview"
      keyboardShouldPersistTaps="handled"
      contentStyle={{
        paddingBottom: tabBarBottomClearance(insets.bottom) + spacing.lg,
      }}
    >
      {loading ? (
        <ActivityIndicator color={colors.primary} style={s.loading} />
      ) : error ? (
        <View style={[s.card, s.errorCard]}>
          <Text style={s.cardTitle}>Could not read maintenance</Text>
          <Text style={s.muted}>{error}</Text>

          <TouchableOpacity
            style={s.btnGhost}
            onPress={() => void load()}
            accessibilityRole="button"
          >
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
            <View style={s.vehicleHead}>
              <View style={s.vehicleText}>
                <Text style={s.kicker}>{typeLabel(vehicle)}</Text>
                <Text style={s.vehicleTitle} numberOfLines={2}>
                  {vehicleDisplayName(vehicle)}
                </Text>
              </View>

              <View
                style={s.vehicleIcon}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <Ionicons
                  name="build-outline"
                  size={22}
                  color={colors.primaryBright}
                />
              </View>
            </View>

            <OdometerEditor
              key={vehicle.id}
              vehicleId={vehicle.id}
              currentKm={vehicle.odometer_km}
              onSaved={load}
            />
          </View>

          <TouchableOpacity
            style={s.addPartButton}
            onPress={() => setAddPartOpen((open) => !open)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ expanded: addPartOpen }}
            accessibilityLabel={addPartOpen ? 'Close add part form' : 'Add a custom part'}
          >
            <Ionicons name={addPartOpen ? 'close' : 'add'} size={20} color={colors.primaryBright} />
            <Text style={s.addPartText}>{addPartOpen ? 'Close form' : 'Add Part'}</Text>
          </TouchableOpacity>

          {addPartOpen && (
            <AddPartPanel
              vehicleId={vehicle.id}
              onCancel={() => setAddPartOpen(false)}
              onSaved={() => { setAddPartOpen(false); void load(); }}
            />
          )}

          <View style={s.card}>
            <View style={s.sectionHead}>
              <Text style={s.sectionTitle}>Overview</Text>
              <Text style={s.sectionMeta}>
                {counts.total} components
              </Text>
            </View>

            <View style={s.metrics}>
              <Stat value={counts.good} label="Good" tone="good" />
              <Stat value={counts.due_soon} label="Due soon" tone="due" />
              <Stat value={counts.overdue} label="Overdue" tone="overdue" />
              <Stat value={counts.unknown} label="Unknown" tone="unknown" />
            </View>

            {counts.not_applicable > 0 && (
              <Text style={s.muted}>
                {counts.not_applicable} not applicable to this vehicle.
              </Text>
            )}

            {counts.unknown > 0 && (
              <Text style={s.note}>
                Unknown means there is not enough recorded history yet it is not a pass.
              </Text>
            )}
          </View>

          <View style={s.searchWrap}>
            <Ionicons
              name="search-outline"
              size={18}
              color={colors.textMuted}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />

            <TextInput
              style={s.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search components"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Search components by name or code"
            />

            {query.length > 0 && (
              <TouchableOpacity
                onPress={() => setQuery('')}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
                hitSlop={{
                  top: 8,
                  bottom: 8,
                  left: 8,
                  right: 8,
                }}
              >
                <Ionicons
                  name="close-circle"
                  size={18}
                  color={colors.textMuted}
                />
              </TouchableOpacity>
            )}
          </View>

          {query.trim() ? (
            filtered.length === 0 ? (
              <Placeholder
                title="No matches"
                message={`No components match "${query.trim()}". Try another name or code.`}
              />
            ) : (
              filtered.map(renderComponent)
            )
          ) : !libraryOpen ? (
            <>
              <View style={s.sectionHead}>
                <Text style={s.sectionTitle}>Needs attention</Text>
                <Text style={s.sectionMeta}>
                  {attentionItems.length}
                </Text>
              </View>

              {attentionItems.length === 0 ? (
                <View style={[s.card, s.emptyCard]}>
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={24}
                    color={colors.successText}
                  />
                  <Text style={s.cardTitle}>
                    Nothing due right now
                  </Text>
                  <Text style={s.muted}>
                    No upcoming or overdue items with a usable interval.
                  </Text>
                </View>
              ) : (
                attentionItems.map(renderComponent)
              )}

              <TouchableOpacity
                style={s.browseButton}
                onPress={() => {
                  setLibraryOpen(true);
                  setSelectedCategory(null);
                }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Browse all parts by category"
              >
                <View>
                  <Text style={s.browseTitle}>Browse all parts</Text>
                  <Text style={s.browseHint}>
                    Explore this vehicle's component categories
                  </Text>
                </View>

                <Ionicons
                  name="arrow-forward"
                  size={20}
                  color={colors.primaryBright}
                />
              </TouchableOpacity>
            </>
          ) : selectedCategory ? (
            <>
              <TouchableOpacity
                style={s.libraryBack}
                onPress={() => setSelectedCategory(null)}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="Back to parts categories"
              >
                <Ionicons
                  name="chevron-back"
                  size={18}
                  color={colors.primaryBright}
                />
                <Text style={s.libraryBackText}>All categories</Text>
              </TouchableOpacity>

              <View style={s.sectionHead}>
                <Text style={s.sectionTitle}>
                  {categoryLabel(selectedCategory)}
                </Text>
                <Text style={s.sectionMeta}>
                  {categories.find(
                    (category) => category.code === selectedCategory,
                  )?.components.length ?? 0}{' '}
                  parts
                </Text>
              </View>

              {items
                .filter((item) => item.category === selectedCategory)
                .map(renderComponent)}
            </>
          ) : (
            <>
              <View style={s.sectionHead}>
                <Text style={s.sectionTitle}>Parts library</Text>
                <Text style={s.sectionMeta}>
                  {items.length} components
                </Text>
              </View>

              {categories.length === 0 ? (
                <Placeholder
                  title="No components"
                  message="No maintenance components apply to this vehicle type."
                />
              ) : (
                categories.map(({ code, components }) => {
                  const attentionCount = components.filter(
                    (item) =>
                      item.evaluation.status === 'overdue' ||
                      item.evaluation.status === 'due_soon',
                  ).length;

                  return (
                    <TouchableOpacity
                      key={code}
                      style={s.categoryCard}
                      onPress={() => setSelectedCategory(code)}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel={`${categoryLabel(code)}, ${components.length} components${
                        attentionCount
                          ? `, ${attentionCount} need attention`
                          : ''
                      }`}
                    >
                      <View style={s.categoryGlyph}>
                        <Ionicons
                          name={CATEGORY_ICONS[code] ?? 'build-outline'}
                          size={20}
                          color={colors.primaryBright}
                        />
                      </View>

                      <View style={s.categoryCopy}>
                        <Text style={s.categoryTitle}>
                          {categoryLabel(code)}
                        </Text>
                        <Text style={s.categoryMeta}>
                          {components.length} components
                        </Text>
                      </View>

                      {attentionCount > 0 && (
                        <Text style={s.attentionCount}>
                          {attentionCount} due
                        </Text>
                      )}

                      <Ionicons
                        name="chevron-forward"
                        size={18}
                        color={colors.textMuted}
                      />
                    </TouchableOpacity>
                  );
                })
              )}

              <TouchableOpacity
                style={s.libraryBack}
                onPress={() => setLibraryOpen(false)}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="Back to maintenance overview"
              >
                <Ionicons
                  name="chevron-back"
                  size={18}
                  color={colors.primaryBright}
                />
                <Text style={s.libraryBackText}>
                  Maintenance overview
                </Text>
              </TouchableOpacity>
            </>
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
  const units = usePrefs().units;

  const [raw, setRaw] = useState(
    currentKm != null ? String(currentKm) : '',
  );
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

  const shown =
    currentKm != null
      ? formatKm(
          units === 'imperial'
            ? currentKm / KM_PER_MILE
            : currentKm,
        )
      : ' ';

  return (
    <View style={s.odo}>
      <View style={s.odoDisplay}>
        <Text style={s.odoLabel}>Current odometer</Text>

        <View style={s.odoValueRow}>
          <Text
            style={s.odoValue}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            {shown}
          </Text>
          <Text style={s.odoUnit}>
            {distanceUnit(units)}
          </Text>
        </View>
      </View>

      <View style={s.odoRow}>
        <TextInput
          style={[s.input, s.flexInput]}
          value={raw}
          onChangeText={setRaw}
          placeholder="e.g. 12500.5"
          placeholderTextColor={colors.textMuted}
          keyboardType="numeric"
          accessibilityLabel={`Current odometer in ${distanceUnit(units)}`}
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
        Updating the odometer recalculates maintenance progress when a component's Replace or
        Baseline record includes an odometer reading.
      </Text>
    </View>
  );
}

function Stat({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: StatusTone;
}) {
  return (
    <View
      style={s.metric}
      accessible
      accessibilityLabel={`${label}: ${value}`}
    >
      <View style={s.metricDotRow}>
        <View
          style={[
            s.metricDot,
            { backgroundColor: TONE_COLORS[tone] },
          ]}
        />
        <Text
          style={[
            s.metricValue,
            { color: TONE_COLORS[tone] },
          ]}
        >
          {value}
        </Text>
      </View>

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
  const units = usePrefs().units;

  const { evaluation } = item;
  const tone = STATUS_TONES[evaluation.status];
  const toneColor = TONE_COLORS[tone];
  const progress = evaluation.progress;
  const reason = reasonLabel(evaluation.reason);

  const source =
    progress && evaluation.rule
      ? intervalSourceNote(evaluation.rule.source)
      : null;

  const allowedActions = item.allowedActions ?? getComponentDefinition(item.componentCode)?.allowedActions ?? [];

  const pill = TONE_PILL[tone];
  const icon = CATEGORY_ICONS[item.category] ?? 'build-outline';

  return (
    <View
      style={[
        s.card,
        tone === 'overdue' && s.cardOverdue,
      ]}
    >
      <View style={s.cardHead}>
        <View
          style={[
            s.categoryIcon,
            {
              borderColor: pill.border,
              backgroundColor: pill.bg,
            },
          ]}
        >
          <Ionicons
            name={icon}
            size={18}
            color={toneColor}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        </View>

        <View style={s.cardText}>
          <Text style={s.cardTitle}>{item.name}</Text>
          <Text style={s.code}>
            {categoryLabel(item.category)} · {item.componentCode}
          </Text>
        </View>

        <View
          style={[
            s.badge,
            {
              borderColor: pill.border,
              backgroundColor: pill.bg,
            },
          ]}
          accessible
          accessibilityLabel={`Status: ${STATUS_LABELS[evaluation.status]}`}
        >
          <Text style={[s.badgeTxt, { color: toneColor }]}>
            {STATUS_LABELS[evaluation.status]}
          </Text>
        </View>
      </View>

      {progress ? (
        <>
          <View
            style={s.track}
            accessibilityRole="progressbar"
            accessibilityLabel={`${item.name} usage`}
            accessibilityValue={{
              min: 0,
              max: 100,
              now: Math.min(
                100,
                Math.round(progress.usedPercent),
              ),
            }}
          >
            <View
              style={[
                s.fill,
                {
                  width: `${
                    progressFraction(progress.usedPercent) * 100
                  }%`,
                  backgroundColor: toneColor,
                },
              ]}
            />
          </View>

          <Text style={s.muted}>
            {usageLine(
              progress.usedKm,
              progress.intervalKm,
              progress.remainingKm,
              units,
            )}
          </Text>

          {source && <Text style={s.note}>{source}</Text>}
        </>
      ) : (
        <Text style={s.muted}>
          {reason ?? 'Not enough data to show a status yet.'}
        </Text>
      )}

      <TouchableOpacity
        style={[
          s.manageBtn,
          expanded && s.manageBtnActive,
        ]}
        onPress={onToggle}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`Manage ${item.name}`}
      >
        <Text style={s.manageTxt}>
          {expanded ? 'Close' : 'Manage'}
        </Text>

        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={colors.primaryBright}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
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
  loading: {
    marginTop: spacing.xl,
  },

  card: {
    padding: spacing.lg,
    marginTop: spacing.md,
    borderRadius: radii.xl,
    backgroundColor: colors.surface,
    borderColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
  },

  emptyCard: {
    alignItems: 'flex-start',
  },

  browseButton: {
    minHeight: 64,
    marginTop: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.xl,
    backgroundColor: colors.surface,
    borderColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  browseTitle: {
    ...typography.heading,
    fontSize: 17,
  },

  browseHint: {
    ...typography.caption,
    marginTop: spacing.xs,
    lineHeight: 18,
  },

  libraryBack: {
    minHeight: 48,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    marginTop: spacing.md,
  },

  libraryBackText: {
    ...typography.label,
    color: colors.primaryBright,
  },

  categoryCard: {
    minHeight: 72,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },

  categoryGlyph: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
  },

  categoryCopy: {
    flex: 1,
  },

  categoryTitle: {
    ...typography.heading,
    fontSize: 16,
  },

  categoryMeta: {
    ...typography.caption,
    marginTop: spacing.xs,
  },

  attentionCount: {
    ...typography.caption,
    color: colors.warningText,
  },

  cardOverdue: {
    borderColor: colors.dangerText,
    borderWidth: 1.5,
  },

  errorCard: {
    backgroundColor: colors.surface,
    borderColor: colors.danger,
  },

  cardTitle: {
    ...typography.heading,
    fontSize: 16,
  },

  muted: {
    ...typography.body,
    color: colors.textMuted,
    lineHeight: 20,
    marginTop: spacing.sm,
  },

  note: {
    ...typography.caption,
    lineHeight: 18,
    marginTop: spacing.sm,
  },

  vehicleCard: {
    padding: spacing.lg,
    marginTop: spacing.md,
    borderRadius: radii.xl,
    backgroundColor: colors.surface,
    borderColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
  },

  addPartButton: {
    minHeight: 48,
    marginTop: spacing.md,
    borderRadius: radii.md,
    borderColor: colors.primaryBright,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.primaryTint,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  addPartText: { ...typography.label, color: colors.primaryBright },

  vehicleHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },

  vehicleText: {
    flex: 1,
    paddingRight: spacing.md,
  },

  kicker: {
    ...typography.kicker,
    color: colors.primaryBright,
  },

  vehicleTitle: {
    ...typography.title,
    fontSize: 22,
    marginTop: spacing.xs,
  },

  vehicleIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryTint,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
  },

  odo: {
    marginTop: spacing.lg,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing.md,
  },

  odoDisplay: {
    marginBottom: spacing.sm,
  },

  odoLabel: {
    ...typography.kicker,
  },

  odoValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
  },

  odoValue: {
    ...typography.metric,
    fontSize: 34,
    flexShrink: 1,
  },

  odoUnit: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMuted,
    marginLeft: spacing.sm,
  },

  odoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  sectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },

  sectionTitle: {
    ...typography.heading,
    fontSize: 16,
  },

  sectionMeta: {
    ...typography.caption,
  },

  metrics: {
    flexDirection: 'row',
    marginTop: spacing.md,
    gap: spacing.sm,
  },

  metric: {
    flex: 1,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
  },

  metricDotRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  metricDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: spacing.xs,
  },

  metricValue: {
    ...typography.metric,
    fontSize: 20,
  },

  metricLabel: {
    ...typography.caption,
    fontSize: 12,
    marginTop: spacing.xs,
    textAlign: 'center',
  },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
    minHeight: 48,
  },

  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    paddingVertical: spacing.sm,
  },

  cardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },

  categoryIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    marginRight: spacing.sm,
  },

  cardText: {
    flex: 1,
  },

  code: {
    ...typography.caption,
    marginTop: spacing.xs,
  },

  badge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginLeft: spacing.sm,
  },

  badgeTxt: {
    ...typography.caption,
    fontWeight: '700',
  },

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

  flexInput: {
    flex: 1,
  },

  smallBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    marginLeft: spacing.sm,
  },

  btnTxt: {
    ...typography.body,
    color: colors.primaryInk,
    fontWeight: '700',
  },

  disabled: {
    opacity: 0.6,
  },

  track: {
    height: 12,
    padding: 2,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceRaised,
    marginTop: spacing.md,
    overflow: 'hidden',
  },

  fill: {
    height: 8,
    borderRadius: radii.pill,
  },

  manageBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: 40,
    borderColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    backgroundColor: colors.surface,
  },

  manageBtnActive: {
    backgroundColor: colors.surface,
  },

  manageTxt: {
    ...typography.label,
    color: colors.primaryBright,
    fontWeight: '600',
  },

  btn: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
  },

  btnGhost: {
    alignSelf: 'flex-start',
    borderColor: 'transparent',
    borderWidth: 0,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },

  btnGhostTxt: {
    ...typography.body,
    color: colors.primaryBright,
    fontWeight: '600',
  },

  errorTxt: {
    ...typography.caption,
    color: colors.dangerText,
    marginTop: spacing.sm,
  },

  okTxt: {
    ...typography.caption,
    color: colors.successText,
    marginTop: spacing.sm,
  },

  footnote: {
    ...typography.caption,
    marginTop: spacing.lg,
    marginBottom: spacing.lg,
    lineHeight: 18,
    textAlign: 'center',
  },
});
