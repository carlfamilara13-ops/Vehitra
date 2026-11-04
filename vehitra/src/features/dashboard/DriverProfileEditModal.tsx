
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Modal,
  StyleSheet,
  type TextInputProps,
} from 'react-native';

import { TouchableOpacity, View } from '../../ui/neu/NeuAuto';
import { Text, TextInput } from '../../ui/neu/NeuText';
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

import {
  deletePortrait,
  persistPortrait,
} from '../../data/local/driverPortrait';

import { getDb } from '../../data/local/db';
import Screen from '../../ui/Screen';
import { colors, radii, spacing, typography } from '../../ui/theme';
import { ImageCropEditor } from './ImageCropEditor';

type Props = {
  visible: boolean;
  profile: DriverProfile | null;
  onCancel: () => void;
  onSaved: (profile: DriverProfileRow) => void;
};

type Draft = Omit<DriverProfileInput, 'portraitUri' | 'backPhotoUri'>;

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
  dlCode: '',
  serialNumber: '',
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
    dlCode: profile.dl_code ?? '',
    serialNumber: profile.serial_number ?? '',
  };
}

export default function DriverProfileEditModal({
  visible,
  profile,
  onCancel,
  onSaved,
}: Props) {
  const insets = useSafeAreaInsets();

  const [draft, setDraft] = useState<Draft>({ ...EMPTY_DRAFT });

  const [portraitUri, setPortraitUri] = useState<string | null>(null);
  const [backPhotoUri, setBackPhotoUri] = useState<string | null>(null);

  const [errors, setErrors] = useState<string[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [backPhotoError, setBackPhotoError] = useState<string | null>(null);

  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);

  const [photoFailed, setPhotoFailed] = useState(false);
  const [backPhotoFailed, setBackPhotoFailed] = useState(false);

  // Custom crop editor state
  const [cropSourceUri, setCropSourceUri] = useState<string | null>(null);
  const [cropTarget, setCropTarget] = useState<'portrait' | 'back' | null>(null);
  const [cropFileName, setCropFileName] = useState<string | null>(null);

  const originalPortrait = useRef<string | null>(null);
  const pendingPortrait = useRef<string | null>(null);

  const originalBackPhoto = useRef<string | null>(null);
  const pendingBackPhoto = useRef<string | null>(null);

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

    const storedPortrait = profile?.portrait_uri ?? null;
    const storedBackPhoto = profile?.back_photo_uri ?? null;

    setPortraitUri(storedPortrait);
    setBackPhotoUri(storedBackPhoto);

    originalPortrait.current = storedPortrait;
    originalBackPhoto.current = storedBackPhoto;

    pendingPortrait.current = null;
    pendingBackPhoto.current = null;

    setErrors([]);
    setPhotoError(null);
    setBackPhotoError(null);

    setPhotoFailed(false);
    setBackPhotoFailed(false);

    setPicking(false);
    setSaving(false);

    setCropSourceUri(null);
    setCropTarget(null);
    setCropFileName(null);

    savingRef.current = false;
    pickingRef.current = false;

    return () => {
      active.current = false;

      const pendingFront = pendingPortrait.current;
      if (pendingFront && pendingFront !== originalPortrait.current) {
        deletePortrait(pendingFront);
      }

      const pendingBack = pendingBackPhoto.current;
      if (pendingBack && pendingBack !== originalBackPhoto.current) {
        deletePortrait(pendingBack);
      }

      pendingPortrait.current = null;
      pendingBackPhoto.current = null;

      savingRef.current = false;
      pickingRef.current = false;
    };
  }, [visible, profile]);

  useEffect(() => {
    setPhotoFailed(false);
  }, [portraitUri]);

  useEffect(() => {
    setBackPhotoFailed(false);
  }, [backPhotoUri]);

  const cancel = useCallback(() => {
    if (savingRef.current) return;

    active.current = false;

    const pendingFront = pendingPortrait.current;
    if (pendingFront && pendingFront !== originalPortrait.current) {
      deletePortrait(pendingFront);
    }

    const pendingBack = pendingBackPhoto.current;
    if (pendingBack && pendingBack !== originalBackPhoto.current) {
      deletePortrait(pendingBack);
    }

    pendingPortrait.current = null;
    pendingBackPhoto.current = null;

    setCropSourceUri(null);
    setCropTarget(null);
    setCropFileName(null);

    onCancel();
  }, [onCancel]);

  // FRONT PORTRAIT

  const choosePortrait = useCallback(async () => {
    if (pickingRef.current || savingRef.current || cropTarget) return;

    pickingRef.current = true;
    setPhotoError(null);
    setPicking(true);

    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!active.current) return;

      if (!permission.granted) {
        setPhotoError(
          'Allow photo access to choose a portrait. You can still save the profile without one.',
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });

      if (!active.current || result.canceled) return;

      const asset = result.assets[0];
      if (!asset) return;

      setCropFileName(asset.fileName ?? null);
      setCropTarget('portrait');
      setCropSourceUri(asset.uri);
    } catch {
      if (active.current) {
        setPhotoError('Could not open that photo. Try another image.');
      }
    } finally {
      pickingRef.current = false;

      if (active.current) {
        setPicking(false);
      }
    }
  }, [cropTarget]);

  const removePortrait = useCallback(() => {
    if (savingRef.current) return;

    const pending = pendingPortrait.current;

    if (pending && pending !== originalPortrait.current) {
      deletePortrait(pending);
    }

    pendingPortrait.current = null;

    setPortraitUri(null);
    setPhotoError(null);
  }, []);

  // BACK-SIDE PHOTO

  const chooseBackPhoto = useCallback(async () => {
    if (pickingRef.current || savingRef.current || cropTarget) return;

    pickingRef.current = true;
    setBackPhotoError(null);
    setPicking(true);

    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!active.current) return;

      if (!permission.granted) {
        setBackPhotoError(
          'Allow photo access to choose the back-side photo. You can still save without one.',
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });

      if (!active.current || result.canceled) return;

      const asset = result.assets[0];
      if (!asset) return;

      setCropFileName(asset.fileName ?? null);
      setCropTarget('back');
      setCropSourceUri(asset.uri);
    } catch {
      if (active.current) {
        setBackPhotoError('Could not open that photo. Try another image.');
      }
    } finally {
      pickingRef.current = false;

      if (active.current) {
        setPicking(false);
      }
    }
  }, [cropTarget]);

  const removeBackPhoto = useCallback(() => {
    if (savingRef.current) return;

    const pending = pendingBackPhoto.current;

    if (pending && pending !== originalBackPhoto.current) {
      deletePortrait(pending);
    }

    pendingBackPhoto.current = null;

    setBackPhotoUri(null);
    setBackPhotoError(null);
  }, []);

  // CROP CONFIRMATION

  const handleCropConfirm = useCallback(
    async (croppedUri: string) => {
      if (!cropTarget || savingRef.current || !active.current) return;

      const target = cropTarget;

      try {
        const stored = await persistPortrait(
          croppedUri,
          cropFileName ?? 'cropped.jpg',
        );

        if (!active.current) {
          deletePortrait(stored);
          return;
        }

        if (target === 'portrait') {
          const previous = pendingPortrait.current;

          if (previous && previous !== originalPortrait.current) {
            deletePortrait(previous);
          }

          pendingPortrait.current = stored;
          setPortraitUri(stored);
          setPhotoError(null);
        } else {
          const previous = pendingBackPhoto.current;

          if (previous && previous !== originalBackPhoto.current) {
            deletePortrait(previous);
          }

          pendingBackPhoto.current = stored;
          setBackPhotoUri(stored);
          setBackPhotoError(null);
        }

        setCropSourceUri(null);
        setCropTarget(null);
        setCropFileName(null);
      } catch (error) {
        if (target === 'portrait') {
          setPhotoError('Could not save the cropped portrait. Try again.');
        } else {
          setBackPhotoError('Could not save the cropped photo. Try again.');
        }

        throw error;
      }
    },
    [cropTarget, cropFileName],
  );

  const handleCropCancel = useCallback(() => {
    setCropSourceUri(null);
    setCropTarget(null);
    setCropFileName(null);
  }, []);

  // SAVE

  const save = useCallback(async () => {
    if (savingRef.current || pickingRef.current || cropTarget) return;

    const input: DriverProfileInput = {
      ...draft,
      portraitUri,
      backPhotoUri,
    };

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

      const previousPortrait = originalPortrait.current;
      const previousBackPhoto = originalBackPhoto.current;

      if (previousPortrait && previousPortrait !== saved.portrait_uri) {
        deletePortrait(previousPortrait);
      }

      if (previousBackPhoto && previousBackPhoto !== saved.back_photo_uri) {
        deletePortrait(previousBackPhoto);
      }

      pendingPortrait.current = null;
      pendingBackPhoto.current = null;

      onSaved(saved);
    } catch (e) {
      if (e instanceof DriverProfileValidationError) {
        setErrors(e.errors);
      } else {
        setErrors([
          e instanceof Error
            ? e.message
            : 'Could not save the profile. Try again.',
        ]);
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [draft, portraitUri, backPhotoUri, onSaved, cropTarget]);

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        onRequestClose={cancel}
        statusBarTranslucent
      >
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
            <Ionicons
              name="information-circle-outline"
              size={18}
              color={colors.primaryBright}
            />
            <Text style={s.noticeTxt}>
              This card is a personal record for your own reference. It is not
              an official government-issued licence.
            </Text>
          </View>

          {/* FRONT PORTRAIT */}

          <Text style={s.section}>Front-side portrait</Text>

          <View style={s.photoRow}>
            <View style={s.photoPreview}>
              {portraitUri && !photoFailed ? (
                <Image
                  source={{ uri: portraitUri }}
                  style={s.photoImage}
                  resizeMode="cover"
                  onError={() => setPhotoFailed(true)}
                  accessibilityLabel="Selected front-side portrait"
                />
              ) : (
                <Ionicons
                  name="person-outline"
                  size={34}
                  color={colors.textMuted}
                />
              )}
            </View>

            <View style={s.photoActions}>
              <Text style={s.photoHelp}>
                Choose the portrait displayed on the front of your driver's
                license card.
              </Text>

              {photoFailed && (
                <Text style={s.photoError}>
                  This image could not be loaded. Choose another photo.
                </Text>
              )}

              <View style={s.photoButtons}>
                <TouchableOpacity
                  style={[s.smallBtn, (picking || saving) && s.disabled]}
                  onPress={() => void choosePortrait()}
                  disabled={picking || saving || cropTarget !== null}
                  accessibilityRole="button"
                  accessibilityLabel={
                    portraitUri ? 'Change portrait' : 'Choose portrait'
                  }
                  accessibilityState={{ disabled: picking || saving }}
                >
                  <Text style={s.smallBtnTxt}>
                    {picking
                      ? 'Opening…'
                      : portraitUri
                        ? 'Change photo'
                        : 'Choose photo'}
                  </Text>
                </TouchableOpacity>

                {!!portraitUri && (
                  <TouchableOpacity
                    style={s.removeBtn}
                    onPress={removePortrait}
                    disabled={saving || cropTarget !== null}
                    accessibilityRole="button"
                    accessibilityLabel="Remove front-side portrait"
                  >
                    <Text style={s.removeTxt}>Remove</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>

          {!!photoError && <Text style={s.photoError}>{photoError}</Text>}

          {/* BACK-SIDE PHOTO */}

          <Text style={s.section}>Back-side photo</Text>

          <View style={s.photoRow}>
            <View style={s.backPhotoPreview}>
              {backPhotoUri && !backPhotoFailed ? (
                <Image
                  source={{ uri: backPhotoUri }}
                  style={s.photoImage}
                  resizeMode="cover"
                  onError={() => setBackPhotoFailed(true)}
                  accessibilityLabel="Selected back-side photo"
                />
              ) : (
                <Ionicons
                  name="image-outline"
                  size={34}
                  color={colors.textMuted}
                />
              )}
            </View>

            <View style={s.photoActions}>
              <Text style={s.photoHelp}>
                Choose the small square photo displayed on the back of your
                driver's license card.
              </Text>

              {backPhotoFailed && (
                <Text style={s.photoError}>
                  This image could not be loaded. Choose another photo.
                </Text>
              )}

              <View style={s.photoButtons}>
                <TouchableOpacity
                  style={[s.smallBtn, (picking || saving) && s.disabled]}
                  onPress={() => void chooseBackPhoto()}
                  disabled={picking || saving || cropTarget !== null}
                  accessibilityRole="button"
                  accessibilityLabel={
                    backPhotoUri
                      ? 'Change back-side photo'
                      : 'Choose back-side photo'
                  }
                  accessibilityState={{ disabled: picking || saving }}
                >
                  <Text style={s.smallBtnTxt}>
                    {picking
                      ? 'Opening…'
                      : backPhotoUri
                        ? 'Change photo'
                        : 'Choose photo'}
                  </Text>
                </TouchableOpacity>

                {!!backPhotoUri && (
                  <TouchableOpacity
                    style={s.removeBtn}
                    onPress={removeBackPhoto}
                    disabled={saving || cropTarget !== null}
                    accessibilityRole="button"
                    accessibilityLabel="Remove back-side photo"
                  >
                    <Text style={s.removeTxt}>Remove</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>

          {!!backPhotoError && (
            <Text style={s.photoError}>{backPhotoError}</Text>
          )}

          {/* PERSONAL DETAILS */}

          <Text style={s.section}>Personal</Text>

          <Field
            label="Full name"
            required
            value={draft.fullName}
            onChangeText={(fullName) => update({ fullName })}
            placeholder="Name shown on the card"
            autoCapitalize="words"
            maxLength={120}
          />

          <Field
            label="Nationality"
            value={draft.nationality}
            onChangeText={(nationality) => update({ nationality })}
            placeholder="Optional"
            autoCapitalize="words"
            maxLength={60}
          />

          <Field
            label="Sex"
            value={draft.sex}
            onChangeText={(sex) => update({ sex })}
            placeholder="Optional"
            autoCapitalize="words"
            maxLength={40}
          />

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

          {/* PHYSICAL DETAILS */}

          <Text style={s.section}>Physical</Text>

          <View style={s.twoCol}>
            <View style={s.col}>
              <Field
                label="Weight (kg)"
                value={draft.weightKg}
                onChangeText={(weightKg) => update({ weightKg })}
                placeholder="Optional"
                keyboardType="decimal-pad"
                autoCapitalize="none"
                maxLength={6}
              />
            </View>

            <View style={s.col}>
              <Field
                label="Height (m)"
                value={draft.heightM}
                onChangeText={(heightM) => update({ heightM })}
                placeholder="Optional"
                keyboardType="decimal-pad"
                autoCapitalize="none"
                maxLength={5}
              />
            </View>
          </View>

          <View style={s.twoCol}>
            <View style={s.col}>
              <Field
                label="Blood type"
                value={draft.bloodType}
                onChangeText={(bloodType) => update({ bloodType })}
                placeholder="Optional"
                autoCapitalize="characters"
                maxLength={8}
              />
            </View>

            <View style={s.col}>
              <Field
                label="Eye colour"
                value={draft.eyeColor}
                onChangeText={(eyeColor) => update({ eyeColor })}
                placeholder="Optional"
                autoCapitalize="words"
                maxLength={30}
              />
            </View>
          </View>

          {/* LICENCE DETAILS */}

          <Text style={s.section}>Licence details</Text>

          <Field
            label="Licence number"
            value={draft.licenseNumber}
            onChangeText={(licenseNumber) => update({ licenseNumber })}
            placeholder="Optional"
            autoCapitalize="characters"
            maxLength={50}
          />

          <Field
            label="DL Code"
            value={draft.dlCode ?? ''}
            onChangeText={(dlCode) => update({ dlCode })}
            placeholder="Optional"
            autoCapitalize="characters"
            maxLength={40}
          />

          <Field
            label="Serial number"
            value={draft.serialNumber ?? ''}
            onChangeText={(serialNumber) => update({ serialNumber })}
            placeholder="Optional"
            autoCapitalize="characters"
            maxLength={60}
          />

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

          <Field
            label="Agency code"
            value={draft.agencyCode}
            onChangeText={(agencyCode) => update({ agencyCode })}
            placeholder="Optional"
            autoCapitalize="characters"
            maxLength={40}
          />

          <Field
            label="Driver codes"
            value={draft.licenseCodes}
            onChangeText={(licenseCodes) => update({ licenseCodes })}
            placeholder="Optional, e.g. A, B, C"
            autoCapitalize="characters"
            maxLength={120}
          />

          {/* ADDRESS */}

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

          {/* CONDITIONS */}

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

          {/* VALIDATION */}

          {errors.length > 0 && (
            <View style={s.errors} accessibilityLiveRegion="polite">
              {errors.map((error, index) => (
                <Text key={index} style={s.errorTxt}>
                  • {error}
                </Text>
              ))}
            </View>
          )}

          <Text style={s.requiredNote}>
            * Required. Every other field can stay blank.
          </Text>

          {/* ACTIONS */}

          <TouchableOpacity
            style={[
              s.saveBtn,
              (saving || picking || cropTarget !== null) && s.disabled,
            ]}
            onPress={() => void save()}
            disabled={saving || picking || cropTarget !== null}
            accessibilityRole="button"
            accessibilityLabel="Save driver profile"
            accessibilityState={{
              disabled: saving || picking || cropTarget !== null,
              busy: saving,
            }}
          >
            <Text style={s.saveTxt}>
              {saving ? 'Saving…' : 'Save profile'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.cancelBtn}
            onPress={cancel}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Cancel without saving"
          >
            <Text style={s.cancelTxt}>Cancel</Text>
          </TouchableOpacity>
        </Screen>
      </Modal>

      {/* CUSTOM PHOTO CROP EDITOR */}

      <ImageCropEditor
        visible={cropSourceUri !== null}
        imageUri={cropSourceUri}
        onCancel={handleCropCancel}
        onConfirm={handleCropConfirm}
      />
    </>
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
  cancelTop: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },

  cancelTopTxt: {
    ...typography.label,
    color: colors.primaryBright,
  },

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

  noticeTxt: {
    ...typography.caption,
    flex: 1,
    lineHeight: 18,
  },

  section: {
    ...typography.kicker,
    marginTop: spacing.xl,
    marginBottom: spacing.xs,
  },

  photoRow: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
  },

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

  backPhotoPreview: {
    width: 84,
    height: 84,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },

  photoImage: {
    width: '100%',
    height: '100%',
  },

  photoActions: {
    flex: 1,
    minWidth: 0,
  },

  photoHelp: {
    ...typography.caption,
    lineHeight: 18,
  },

  photoButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
    flexWrap: 'wrap',
  },

  smallBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    borderColor: colors.primaryBright,
    borderWidth: StyleSheet.hairlineWidth,
  },

  smallBtnTxt: {
    ...typography.label,
    color: colors.primaryBright,
  },

  removeBtn: {
    minHeight: 44,
    justifyContent: 'center',
  },

  removeTxt: {
    ...typography.label,
    color: colors.danger,
  },

  photoError: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.sm,
  },

  field: {
    marginTop: spacing.md,
  },

  fieldLabel: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },

  required: {
    color: colors.warningText,
  },

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

  inputMultiline: {
    minHeight: 92,
    paddingTop: spacing.md,
  },

  helper: {
    ...typography.caption,
    marginTop: spacing.xs,
  },

  twoCol: {
    flexDirection: 'row',
    gap: spacing.md,
  },

  col: {
    flex: 1,
    minWidth: 0,
  },

  errors: {
    borderColor: colors.danger,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    padding: spacing.md,
    marginTop: spacing.lg,
  },

  errorTxt: {
    ...typography.body,
    color: colors.danger,
    marginBottom: spacing.xs,
  },

  requiredNote: {
    ...typography.caption,
    marginTop: spacing.md,
  },

  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    minHeight: 52,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },

  disabled: {
    opacity: 0.6,
  },

  saveTxt: {
    ...typography.body,
    color: colors.primaryInk,
    fontWeight: '700',
  },

  cancelBtn: {
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
    marginTop: spacing.sm,
  },

  cancelTxt: {
    ...typography.body,
    color: colors.primaryBright,
    fontWeight: '600',
  },
});
