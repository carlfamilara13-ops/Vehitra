import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type TextInputProps,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  validateDriverProfileInput,
  type DriverProfile,
  type DriverProfileInput,
} from '../../domain/driverProfile/profile';
import {
  DriverProfileValidationError,
  saveDriverProfile,
  type DriverProfileRow,
} from '../../data/local/driverProfileStore';
import { deletePortrait, persistPortrait } from '../../data/local/driverPortrait';
import { getDb } from '../../data/local/db';
import Screen from '../../ui/Screen';
import { colors, radii, spacing, typography } from '../../ui/theme';

type Props = {
  visible: boolean;
  profile: DriverProfile | null;
  onCancel: () => void;
  onSaved: (profile: DriverProfileRow) => void;
};

type Draft = Omit<DriverProfileInput, 'portraitUri'>;

const EMPTY_DRAFT: Draft = {
  fullName: '',
  nationality: '',
  sex: '',
  dateOfBirth: '',
  weightKg: '',
  heightM: '',
  address: '',
  licenseNumber: '',
  expirationDate: '',
  agencyCode: '',
  bloodType: '',
  eyeColor: '',
  licenseCodes: '',
  conditions: '',
};

function draftFromProfile(profile: DriverProfile | null): Draft {
  if (!profile) return { ...EMPTY_DRAFT };
  return {
    fullName: profile.full_name,
    nationality: profile.nationality ?? '',
    sex: profile.sex ?? '',
    dateOfBirth: profile.date_of_birth ?? '',
    weightKg: profile.weight_kg != null ? String(profile.weight_kg) : '',
    heightM: profile.height_m != null ? String(profile.height_m) : '',
    address: profile.address ?? '',
    licenseNumber: profile.license_number ?? '',
    expirationDate: profile.expiration_date ?? '',
    agencyCode: profile.agency_code ?? '',
    bloodType: profile.blood_type ?? '',
    eyeColor: profile.eye_color ?? '',
    licenseCodes: profile.license_codes ?? '',
    conditions: profile.conditions ?? '',
  };
}

// Full-screen native form. The draft lives entirely here until Save succeeds, so Cancel (or the
// Android back button) never touches the saved profile. A newly imported portrait is copied into
// the app document directory immediately and removed again if the form is cancelled.
export default function DriverProfileEditModal({ visible, profile, onCancel, onSaved }: Props) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<Draft>({ ...EMPTY_DRAFT });
  const [portraitUri, setPortraitUri] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const originalPortrait = useRef<string | null>(null);
  const pendingPortrait = useRef<string | null>(null);
  const active = useRef(false);
  const savingRef = useRef(false);
  const pickingRef = useRef(false);

  const update = useCallback((patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  useEffect(() => {
    if (!visible) return;
    active.current = true;
    setDraft(draftFromProfile(profile));
    const stored = profile?.portrait_uri ?? null;
    setPortraitUri(stored);
    originalPortrait.current = stored;
    pendingPortrait.current = null;
    setErrors([]);
    setPhotoError(null);
    setPhotoFailed(false);
    setPicking(false);
    setSaving(false);
    savingRef.current = false;
    pickingRef.current = false;
    return () => {
      active.current = false;
      const pending = pendingPortrait.current;
      if (pending && pending !== originalPortrait.current) deletePortrait(pending);
      pendingPortrait.current = null;
      savingRef.current = false;
      pickingRef.current = false;
    };
  }, [visible, profile]);

  useEffect(() => {
    setPhotoFailed(false);
  }, [portraitUri]);

  const cancel = useCallback(() => {
    if (savingRef.current) return;
    active.current = false;
    const pending = pendingPortrait.current;
    if (pending && pending !== originalPortrait.current) deletePortrait(pending);
    pendingPortrait.current = null;
    onCancel();
  }, [onCancel]);

  const choosePortrait = useCallback(async () => {
    if (pickingRef.current || savingRef.current) return;
    pickingRef.current = true;
    setPhotoError(null);
    setPicking(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!active.current) return;
      if (!permission.granted) {
        setPhotoError('Allow photo access to choose a portrait. You can still save the profile without one.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.8,
      });
      if (!active.current || result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      const stored = await persistPortrait(asset.uri, asset.fileName);
      if (!active.current) {
        deletePortrait(stored);
        return;
      }
      const previous = pendingPortrait.current;
      if (previous && previous !== originalPortrait.current) deletePortrait(previous);
      pendingPortrait.current = stored;
      setPortraitUri(stored);
    } catch {
      if (active.current) setPhotoError('Could not import that photo. Try another image.');
    } finally {
      pickingRef.current = false;
      if (active.current) setPicking(false);
    }
  }, []);

  const removePortrait = useCallback(() => {
    if (savingRef.current) return;
    const pending = pendingPortrait.current;
    if (pending && pending !== originalPortrait.current) deletePortrait(pending);
    pendingPortrait.current = null;
    setPortraitUri(null);
    setPhotoError(null);
  }, []);

  const save = useCallback(async () => {
    if (savingRef.current || pickingRef.current) return;
    const input: DriverProfileInput = { ...draft, portraitUri };
    const problems = validateDriverProfileInput(input);
    if (problems.length) {
      setErrors(problems);
      return;
    }
    setErrors([]);
    savingRef.current = true;
    setSaving(true);
    try {
      const db = await getDb();
      const saved = await saveDriverProfile(db, input);
      const previous = originalPortrait.current;
      if (previous && previous !== saved.portrait_uri) deletePortrait(previous);
      pendingPortrait.current = null;
      onSaved(saved);
    } catch (e) {
      if (e instanceof DriverProfileValidationError) {
        setErrors(e.errors);
      } else {
        setErrors([e instanceof Error ? e.message : 'Could not save the profile. Try again.']);
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [draft, portraitUri, onSaved]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={cancel} statusBarTranslucent>
      <Screen
        title="Edit driver profile"
        subtitle="Saved only on this device"
        keyboardShouldPersistTaps="handled"
        contentStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
        right={
          <TouchableOpacity
            onPress={cancel}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Cancel editing"
            accessibilityState={{ disabled: saving }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={[s.cancelTop, saving && s.disabled]}
            disabled={saving}
          >
            <Text style={s.cancelTopTxt}>Cancel</Text>
          </TouchableOpacity>
        }
      >
        <View style={s.notice}>
          <Ionicons name="information-circle-outline" size={18} color={colors.primaryBright} />
          <Text style={s.noticeTxt}>
            This card is a personal record for your own reference. It is not an official
            government-issued licence.
          </Text>
        </View>

        <Text style={s.section}>Portrait</Text>
        <View style={s.photoRow}>
          <View style={s.photoPreview}>
            {portraitUri && !photoFailed ? (
              <Image
                source={{ uri: portraitUri }}
                style={s.photoImage}
                resizeMode="cover"
                onError={() => setPhotoFailed(true)}
                accessibilityLabel="Selected portrait"
              />
            ) : (
              <Ionicons name="person-outline" size={34} color={colors.textMuted} />
            )}
          </View>
          <View style={s.photoActions}>
            <Text style={s.photoHelp}>Choose an image from this device. It is copied into the app and never uploaded.</Text>
            {photoFailed && (
              <Text style={s.photoError}>This image could not be loaded. Choose another photo.</Text>
            )}
            <View style={s.photoButtons}>
              <TouchableOpacity
                style={[s.smallBtn, (picking || saving) && s.disabled]}
                onPress={() => void choosePortrait()}
                disabled={picking || saving}
                accessibilityRole="button"
                accessibilityLabel={portraitUri ? 'Change portrait' : 'Choose portrait'}
                accessibilityState={{ disabled: picking || saving }}
              >
                <Text style={s.smallBtnTxt}>
                  {picking ? 'Opening…' : portraitUri ? 'Change photo' : 'Choose photo'}
                </Text>
              </TouchableOpacity>
              {!!portraitUri && (
                <TouchableOpacity
                  style={s.removeBtn}
                  onPress={removePortrait}
                  disabled={saving}
                  accessibilityRole="button"
                  accessibilityLabel="Remove portrait"
                >
                  <Text style={s.removeTxt}>Remove</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
        {!!photoError && <Text style={s.photoError}>{photoError}</Text>}

        <Text style={s.section}>Personal</Text>
        <Field label="Full name" required value={draft.fullName} onChangeText={(fullName) => update({ fullName })} placeholder="Name shown on the card" autoCapitalize="words" maxLength={120} />
        <Field label="Nationality" value={draft.nationality} onChangeText={(nationality) => update({ nationality })} placeholder="Optional" autoCapitalize="words" maxLength={60} />
        <Field label="Sex" value={draft.sex} onChangeText={(sex) => update({ sex })} placeholder="Optional" autoCapitalize="words" maxLength={40} />
        <Field
          label="Date of birth"
          value={draft.dateOfBirth}
          onChangeText={(dateOfBirth) => update({ dateOfBirth })}
          placeholder="YYYY-MM-DD"
          helper="Optional. Use the format YYYY-MM-DD."
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
          maxLength={10}
        />

        <Text style={s.section}>Physical</Text>
        <View style={s.twoCol}>
          <View style={s.col}>
            <Field label="Weight (kg)" value={draft.weightKg} onChangeText={(weightKg) => update({ weightKg })} placeholder="Optional" keyboardType="decimal-pad" autoCapitalize="none" maxLength={6} />
          </View>
          <View style={s.col}>
            <Field label="Height (m)" value={draft.heightM} onChangeText={(heightM) => update({ heightM })} placeholder="Optional" keyboardType="decimal-pad" autoCapitalize="none" maxLength={5} />
          </View>
        </View>
        <View style={s.twoCol}>
          <View style={s.col}>
            <Field label="Blood type" value={draft.bloodType} onChangeText={(bloodType) => update({ bloodType })} placeholder="Optional" autoCapitalize="characters" maxLength={8} />
          </View>
          <View style={s.col}>
            <Field label="Eye colour" value={draft.eyeColor} onChangeText={(eyeColor) => update({ eyeColor })} placeholder="Optional" autoCapitalize="words" maxLength={30} />
          </View>
        </View>

        <Text style={s.section}>Licence details</Text>
        <Field label="Licence number" value={draft.licenseNumber} onChangeText={(licenseNumber) => update({ licenseNumber })} placeholder="Optional" autoCapitalize="characters" maxLength={50} />
        <Field
          label="Expiration date"
          value={draft.expirationDate}
          onChangeText={(expirationDate) => update({ expirationDate })}
          placeholder="YYYY-MM-DD"
          helper="Optional. Use the format YYYY-MM-DD."
          keyboardType="numbers-and-punctuation"
          autoCapitalize="none"
          maxLength={10}
        />
        <Field label="Agency code" value={draft.agencyCode} onChangeText={(agencyCode) => update({ agencyCode })} placeholder="Optional" autoCapitalize="characters" maxLength={40} />
        <Field label="Driver codes" value={draft.licenseCodes} onChangeText={(licenseCodes) => update({ licenseCodes })} placeholder="Optional, e.g. A, B, C" autoCapitalize="characters" maxLength={120} />

        <Text style={s.section}>Address</Text>
        <Field
          label="Address"
          value={draft.address}
          onChangeText={(address) => update({ address })}
          placeholder="Optional"
          helper="Long addresses are fine."
          multiline
          autoCapitalize="sentences"
          maxLength={400}
        />

        <Text style={s.section}>Conditions</Text>
        <Field
          label="Conditions or restrictions"
          value={draft.conditions}
          onChangeText={(conditions) => update({ conditions })}
          placeholder="Optional"
          multiline
          autoCapitalize="sentences"
          maxLength={400}
        />

        {errors.length > 0 && (
          <View style={s.errors} accessibilityLiveRegion="polite">
            {errors.map((error, index) => (
              <Text key={index} style={s.errorTxt}>• {error}</Text>
            ))}
          </View>
        )}

        <Text style={s.requiredNote}>* Required. Every other field can stay blank.</Text>

        <TouchableOpacity
          style={[s.saveBtn, (saving || picking) && s.disabled]}
          onPress={() => void save()}
          disabled={saving || picking}
          accessibilityRole="button"
          accessibilityLabel="Save driver profile"
          accessibilityState={{ disabled: saving || picking, busy: saving }}
        >
          <Text style={s.saveTxt}>{saving ? 'Saving…' : 'Save profile'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.cancelBtn} onPress={cancel} disabled={saving} accessibilityRole="button" accessibilityLabel="Cancel without saving">
          <Text style={s.cancelTxt}>Cancel</Text>
        </TouchableOpacity>
      </Screen>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  helper,
  required,
  multiline,
  keyboardType,
  autoCapitalize,
  maxLength,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  helper?: string;
  required?: boolean;
  multiline?: boolean;
  keyboardType?: TextInputProps['keyboardType'];
  autoCapitalize?: TextInputProps['autoCapitalize'];
  maxLength?: number;
}) {
  const describedBy = helper ? `${label}. ${helper}` : label;
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>
        {label}
        {required ? <Text style={s.required}> *</Text> : null}
      </Text>
      <TextInput
        style={[s.input, multiline && s.inputMultiline]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize={autoCapitalize ?? 'sentences'}
        autoCorrect={false}
        maxLength={maxLength}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        accessibilityLabel={describedBy}
      />
      {!!helper && <Text style={s.helper}>{helper}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  cancelTop: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.sm },
  cancelTopTxt: { ...typography.label, color: colors.primaryBright },
  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  noticeTxt: { ...typography.caption, flex: 1, lineHeight: 18 },
  section: {
    ...typography.kicker,
    marginTop: spacing.xl,
    marginBottom: spacing.xs,
  },
  photoRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  photoPreview: {
    width: 84,
    height: 108,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoImage: { width: '100%', height: '100%' },
  photoActions: { flex: 1, minWidth: 0 },
  photoHelp: { ...typography.caption, lineHeight: 18 },
  photoButtons: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.sm, flexWrap: 'wrap' },
  smallBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    borderColor: colors.primaryBright,
    borderWidth: StyleSheet.hairlineWidth,
  },
  smallBtnTxt: { ...typography.label, color: colors.primaryBright },
  removeBtn: { minHeight: 44, justifyContent: 'center' },
  removeTxt: { ...typography.label, color: colors.danger },
  photoError: { ...typography.caption, color: colors.danger, marginTop: spacing.sm },
  field: { marginTop: spacing.md },
  fieldLabel: { ...typography.label, color: colors.textMuted, marginBottom: spacing.xs },
  required: { color: colors.warningText },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    color: colors.text,
    ...typography.body,
  },
  inputMultiline: { minHeight: 92, paddingTop: spacing.md },
  helper: { ...typography.caption, marginTop: spacing.xs },
  twoCol: { flexDirection: 'row', gap: spacing.md },
  col: { flex: 1, minWidth: 0 },
  errors: {
    borderColor: colors.danger,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  errorTxt: { ...typography.body, color: colors.danger, marginBottom: spacing.xs },
  requiredNote: { ...typography.caption, marginTop: spacing.md },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  disabled: { opacity: 0.6 },
  saveTxt: { ...typography.body, color: '#FFFFFF', fontWeight: '700' },
  cancelBtn: { alignItems: 'center', minHeight: 44, justifyContent: 'center', marginTop: spacing.sm },
  cancelTxt: { ...typography.body, color: colors.primaryBright, fontWeight: '600' },
});
