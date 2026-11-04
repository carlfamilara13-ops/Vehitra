import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import * as Crypto from 'expo-crypto';
import { TouchableOpacity, View } from '../../ui/neu/NeuAuto';
import { Text, TextInput } from '../../ui/neu/NeuText';
import { getDb } from '../../data/local/db';
import { createCustomPart, CUSTOM_PART_CATEGORIES, type CustomPartCategory } from '../../data/local/customPartStore';
import { colors, radii, spacing, typography } from '../../ui/theme';
import { categoryLabel } from './partsView';

type Props = { vehicleId: string; onSaved: () => void; onCancel: () => void };

export default function AddPartPanel({ vehicleId, onSaved, onCancel }: Props) {
  const [category, setCategory] = useState<CustomPartCategory | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!category) {
      setError('Choose a category first.');
      return;
    }
    if (!name.trim()) {
      setError('Enter a part name.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const id = Crypto.randomUUID();
      const db = await getDb();
      await createCustomPart(db, {
        id,
        user_vehicle_id: vehicleId,
        component_code: `custom_${id.replace(/-/g, '')}`,
        name,
        category,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={s.card}>
      <Text style={s.title}>Add a custom part</Text>
      <Text style={s.hint}>Choose a category first, then give the part a name.</Text>
      <Text style={s.label}>Category</Text>
      <View style={s.chips}>
        {CUSTOM_PART_CATEGORIES.map((value) => (
          <TouchableOpacity
            key={value}
            style={[s.chip, category === value && s.chipSelected]}
            onPress={() => { setCategory(value); setError(null); }}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ selected: category === value }}
            accessibilityLabel={`${categoryLabel(value)} category`}
          >
            <Text style={[s.chipText, category === value && s.chipTextSelected]}>{categoryLabel(value)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {category && (
        <>
          <Text style={s.label}>Part name</Text>
          <TextInput
            style={s.input}
            value={name}
            onChangeText={(value) => { setName(value); setError(null); }}
            placeholder="e.g. Auxiliary light"
            autoCapitalize="sentences"
            maxLength={80}
            accessibilityLabel="Part name"
          />
        </>
      )}
      {!!error && <Text style={s.error} accessibilityRole="alert">{error}</Text>}

      <View style={s.actions}>
        <TouchableOpacity style={s.cancelButton} onPress={onCancel} accessibilityRole="button">
          <Text style={s.cancelText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.saveButton, (!category || !name.trim() || busy) && s.disabled]}
          onPress={() => void save()}
          disabled={!category || !name.trim() || busy}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityState={{ disabled: !category || !name.trim() || busy }}
        >
          {busy ? <ActivityIndicator color={colors.primaryInk} /> : <Text style={s.saveText}>Add part</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: { marginTop: spacing.md, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth },
  title: { ...typography.heading, fontSize: 18 },
  hint: { ...typography.caption, marginTop: spacing.xs, marginBottom: spacing.md },
  label: { ...typography.label, marginBottom: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm },
  chip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: radii.pill, backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth, marginRight: spacing.sm, marginBottom: spacing.sm },
  chipSelected: { backgroundColor: colors.primaryTint, borderColor: colors.primaryBright },
  chipText: { ...typography.caption, color: colors.textMuted },
  chipTextSelected: { color: colors.primaryBright, fontWeight: '700' },
  input: { minHeight: 48, paddingHorizontal: spacing.md, borderRadius: radii.md, backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth, marginBottom: spacing.sm, color: colors.text },
  error: { ...typography.caption, color: colors.dangerText, marginBottom: spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: spacing.xs },
  cancelButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md, marginRight: spacing.sm },
  cancelText: { ...typography.label, color: colors.textMuted },
  saveButton: { minHeight: 44, minWidth: 108, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, borderRadius: radii.md, backgroundColor: colors.primary },
  saveText: { ...typography.label, color: colors.primaryInk },
  disabled: { opacity: 0.55 },
});
