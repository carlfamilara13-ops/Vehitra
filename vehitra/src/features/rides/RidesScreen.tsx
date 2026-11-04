import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { TouchableOpacity, View } from '../../ui/neu/NeuAuto';
import { Text, TextInput } from '../../ui/neu/NeuText';
import { useFocusEffect } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getDb } from '../../data/local/db';
import { listRides, type RideRow } from '../../data/local/ridesStore';
import { formatDistanceM } from '../../domain/units';
import Screen from '../../ui/Screen';
import Placeholder from '../../ui/Placeholder';
import { colors, radii, spacing, typography } from '../../ui/theme';
import { tabBarBottomClearance } from '../../ui/tabBarLayout';
import type { RootTabParamList } from '../../app/RootNavigator';
import { usePrefs } from '../../app/prefs';
import RideFilterSheet from './RideFilterSheet';
import RidesOverflowMenu from './RidesOverflowMenu';
import { RideCompactRow, RideRichCard } from './RideListItem';
import {
  DEFAULT_RIDE_FILTERS,
  QUICK_STATUS_LABELS,
  RIDES_PAGE_SIZE,
  RIDE_QUERY_LIMIT,
  isDefaultFilters,
  pageSlice,
  nextVisibleCount,
  hasMoreRides,
  quickFilterForStatuses,
  rideTotals,
  ridesEmptyState,
  selectRides,
  statusesForQuickFilter,
  vehicleOptions,
  type QuickStatus,
  type RideDisplayMode,
  type RideFilters,
} from './ridesView';

type Props = BottomTabScreenProps<RootTabParamList, 'Rides'>;

// The quick status chips. "All" also covers recovered rides, which is why it is not the same as
// an empty status filter elsewhere.
const QUICK_STATUSES: QuickStatus[] = ['all', 'finished', 'recovered'];

// Read-only list of locally stored rides: search, quick and advanced filters, sorting, and a
// rich/compact display preference. Refreshes whenever the tab gains focus. Tapping a card
// opens the ride detail (stats, route sketch, speed dial).
export default function RidesScreen({ navigation }: Props) {
  const prefs = usePrefs();
  const insets = useSafeAreaInsets();
  const [rides, setRides] = useState<RideRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<RideFilters>(DEFAULT_RIDE_FILTERS);
  const [display, setDisplay] = useState<RideDisplayMode>('rich');
  const [filterOpen, setFilterOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(RIDES_PAGE_SIZE);

  const refresh = useCallback(async () => {
    const db = await getDb();
    setRides(await listRides(db, RIDE_QUERY_LIMIT));
    setLoaded(true);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh().catch(() => setLoaded(true));
    }, [refresh]),
  );

  // The chips and the sheet write the same committed filters, so the chip row is derived from
  // the filters rather than tracked separately. A combination the chips cannot represent (for
  // example "recording" plus "finished") simply leaves no chip selected.
  const activeQuick = quickFilterForStatuses(filters.statuses);

  const results = useMemo(() => selectRides(rides, filters, query), [rides, filters, query]);
  const totals = useMemo(() => rideTotals(rides), [rides]);
  const options = useMemo(() => vehicleOptions(rides), [rides]);
  const visible = useMemo(() => pageSlice(results, visibleCount), [results, visibleCount]);
  const emptyState = ridesEmptyState(rides.length, results.length);
  const filtersActive = !isDefaultFilters(filters);

  // Any change to the visible set starts the list again from the first page.
  const applyFilters = useCallback((next: RideFilters) => {
    setFilters(next);
    setVisibleCount(RIDES_PAGE_SIZE);
  }, []);

  const applyQuick = useCallback(
    (value: QuickStatus) => {
      applyFilters({ ...filters, statuses: statusesForQuickFilter(value) });
    },
    [applyFilters, filters],
  );

  const openRide = useCallback(
    (id: string) => navigation.navigate('RideDetail', { id }),
    [navigation],
  );

  return (
    <Screen
      title="Rides"
      subtitle={
        loaded
          ? `${totals.savedCount} saved · ${formatDistanceM(totals.totalDistanceM, prefs.units)}`
          : 'Loading…'
      }
      right={
        <TouchableOpacity
          onPress={() => setMenuOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Sort and display options"
          accessibilityHint="Opens the sort and display menu"
          activeOpacity={0.75}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={s.iconBtn}
        >
          <Ionicons name="ellipsis-vertical" size={20} color={colors.textMuted} />
        </TouchableOpacity>
      }
      contentStyle={{ paddingBottom: tabBarBottomClearance(insets.bottom) }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={s.searchRow}>
        <View style={s.search}>
          <Ionicons
            name="search-outline"
            size={16}
            color={colors.textMuted}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          <TextInput
            value={query}
            onChangeText={(text) => {
              setQuery(text);
              setVisibleCount(RIDES_PAGE_SIZE);
            }}
            placeholder="Search rides"
            placeholderTextColor={colors.textMuted}
            style={s.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Search rides"
          />
        </View>
        <TouchableOpacity
          onPress={() => setFilterOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Filters"
          accessibilityHint="Opens the filter sheet"
          activeOpacity={0.75}
          style={[s.filterBtn, filtersActive && s.filterBtnActive]}
        >
          <Ionicons
            name="options-outline"
            size={16}
            color={filtersActive ? colors.background : colors.textMuted}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          <Text style={[s.filterText, filtersActive && s.filterTextActive]}>Filters</Text>
        </TouchableOpacity>
      </View>

      <View style={[s.chips, { backgroundColor: 'transparent' }]}>
        {QUICK_STATUSES.map((value) => {
          const selected = activeQuick === value;
          return (
            <TouchableOpacity
              key={value}
              onPress={() => applyQuick(value)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[s.chip, selected && s.chipActive]}
            >
              <Text style={[s.chipText, selected && s.chipTextActive]}>{QUICK_STATUS_LABELS[value]}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loaded && emptyState === 'none' ? (
        <Placeholder
          title="No rides yet"
          message="Recorded rides appear here with distance, duration and average speed. Start one from the Record tab."
        />
      ) : null}

      {loaded && emptyState === 'no_matches' ? (
        <Placeholder
          title="No rides match"
          message="No saved ride matches the current search and filters. Clear them to see everything again."
        />
      ) : null}

      {loaded && results.length > 0 ? (
        <Text style={s.count}>
          {results.length} ride{results.length === 1 ? '' : 's'} shown
        </Text>
      ) : null}

      {visible.map((ride) =>
        display === 'rich' ? (
          <RideRichCard key={ride.id} ride={ride} units={prefs.units} onOpenRide={openRide} />
        ) : (
          <RideCompactRow key={ride.id} ride={ride} units={prefs.units} onOpenRide={openRide} />
        ),
      )}

      {hasMoreRides(visibleCount, results.length) ? (
        <TouchableOpacity
          onPress={() => setVisibleCount((count) => nextVisibleCount(count, results.length))}
          accessibilityRole="button"
          style={s.more}
        >
          <Text style={s.moreText}>Load more</Text>
        </TouchableOpacity>
      ) : null}

      <RideFilterSheet
        visible={filterOpen}
        filters={filters}
        vehicleOptions={options}
        onApply={(next) => {
          applyFilters(next);
          setFilterOpen(false);
        }}
        onClose={() => setFilterOpen(false)}
      />

      <RidesOverflowMenu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        sort={filters.sort}
        onSortChange={(sort) => applyFilters({ ...filters, sort })}
        display={display}
        onDisplayChange={setDisplay}
      />
    </Screen>
  );
}

const s = StyleSheet.create({
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    ...typography.body,
    paddingVertical: 0,
  },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  filterBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { ...typography.label, color: colors.textMuted },
  filterTextActive: { color: colors.primaryInk },
  chips: {
    backgroundColor: colors.surface, flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.primaryTint, borderColor: colors.primary },
  chipText: { ...typography.label, color: colors.textMuted },
  chipTextActive: { color: colors.primaryBright },
  count: { ...typography.caption, marginTop: spacing.lg, marginBottom: spacing.sm },
  more: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  moreText: { ...typography.label, color: colors.primaryBright },
});
