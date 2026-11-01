import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { TouchableOpacity, View } from '../../ui/neu/NeuAuto';
import { Text } from '../../ui/neu/NeuText';
import { useFocusEffect } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { getDb } from '../../data/local/db';
import {
  getActiveVehicleId,
  listVehicles,
  setActiveVehicle,
  vehicleDisplayName,
  VEHICLE_TYPE_LABELS,
  type VehicleRow,
} from '../../data/local/vehicleStore';
import Screen from '../../ui/Screen';
import Placeholder from '../../ui/Placeholder';
import { colors, radii, spacing, typography } from '../../ui/theme';
import type { RootTabParamList } from '../../app/RootNavigator';
import { formatDistanceKm, type Units } from '../../domain/units';
import { usePrefs } from '../../app/prefs';

type Props = BottomTabScreenProps<RootTabParamList, 'Garage'>;

const typeLabel = (v: VehicleRow) => (VEHICLE_TYPE_LABELS as Record<string, string>)[v.vehicle_type] ?? v.vehicle_type;

const detail = (v: VehicleRow, units: Units) =>
  [
    typeLabel(v),
    v.model_year ? String(v.model_year) : null,
    v.plate,
    v.odometer_km != null ? formatDistanceKm(v.odometer_km, units) : null,
  ]
    .filter(Boolean)
    .join(' · ');

// Vehicle list. Local-only: reads and writes the on-device store, no catalog or network.
export default function GarageScreen({ navigation }: Props) {
  const prefs = usePrefs();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [vehicles, setVehicles] = useState<VehicleRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const db = await getDb();
      const [list, active] = await Promise.all([listVehicles(db), getActiveVehicleId(db)]);
      setVehicles(list);
      setActiveId(active);
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

  const makeActive = useCallback(async (id: string) => {
    try {
      const db = await getDb();
      await setActiveVehicle(db, id);
      setActiveId(id);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  return (
    <Screen
      title="Garage"
      subtitle="Your vehicles"
      right={
        <TouchableOpacity
          style={s.addBtn}
          onPress={() => navigation.navigate('VehicleLibrary')}
          accessibilityRole="button"
          accessibilityLabel="Add vehicle"
        >
          <Text style={s.addBtnTxt}>+ Add</Text>
        </TouchableOpacity>
      }
    >
      {loading ? (
        <ActivityIndicator color={colors.primary} style={s.loading} />
      ) : (
        <>
          {!!error && (
            <View style={s.errorCard}>
              <Text style={s.muted}>{error}</Text>
              <TouchableOpacity style={s.btnGhost} onPress={() => void load()} accessibilityRole="button">
                <Text style={s.btnGhostTxt}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}

          {vehicles.length === 0 ? (
            <Placeholder
              title="No vehicles yet"
              message="Add a vehicle to keep its profile here. Everything is stored on this device, so the garage works offline."
            />
          ) : (
            vehicles.map((v) => (
              <View key={v.id} style={s.card}>
                <View style={s.cardHead}>
                  <View style={s.cardText}>
                    <Text style={s.cardTitle}>{vehicleDisplayName(v)}</Text>
                    <Text style={s.muted}>{detail(v, prefs.units)}</Text>
                  </View>
                  {v.id === activeId && (
                    <View style={s.badge}>
                      <Text style={s.badgeTxt}>Active</Text>
                    </View>
                  )}
                </View>
                <View style={s.actions}>
                  <TouchableOpacity
                    style={s.btnGhost}
                    onPress={() => navigation.navigate('VehicleForm', { id: v.id })}
                    accessibilityRole="button"
                  >
                    <Text style={s.btnGhostTxt}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={s.btnGhost}
                    onPress={() => navigation.navigate('Equipment', { vehicleId: v.id })}
                    accessibilityRole="button"
                  >
                    <Text style={s.btnGhostTxt}>Equipment</Text>
                  </TouchableOpacity>
                  {v.id !== activeId && (
                    <TouchableOpacity
                      style={s.btnGhost}
                      onPress={() => void makeActive(v.id)}
                      accessibilityRole="button"
                    >
                      <Text style={s.btnGhostTxt}>Set active</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))
          )}
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  addBtn: {
    borderColor: colors.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  addBtnTxt: { ...typography.body, color: colors.primary, fontWeight: '700' },
  loading: { marginTop: spacing.xl },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  errorCard: {
    backgroundColor: colors.surface,
    borderColor: colors.danger,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start' },
  cardText: { flex: 1 },
  cardTitle: { ...typography.heading, fontSize: 16 },
  muted: { ...typography.body, color: colors.textMuted, marginTop: spacing.xs, lineHeight: 20 },
  badge: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    marginLeft: spacing.sm,
  },
  badgeTxt: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  actions: { flexDirection: 'row', marginTop: spacing.md },
  btnGhost: {
    backgroundColor: colors.surface,

    alignSelf: 'flex-start',
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginRight: spacing.md,
  },
  btnGhostTxt: { ...typography.body, color: colors.primary, fontWeight: '600' },
});
