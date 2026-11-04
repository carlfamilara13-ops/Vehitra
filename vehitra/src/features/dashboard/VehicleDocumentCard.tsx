import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet } from 'react-native';
import { TouchableOpacity, View } from '../../ui/neu/NeuAuto';
import { Text } from '../../ui/neu/NeuText';
import { Ionicons } from '@expo/vector-icons';
import {
  VEHICLE_DOCUMENT_DEFINITIONS,
  type VehicleDocumentKind,
} from '../../domain/vehicleDocuments/documents';
import type { VehicleDocumentRow } from '../../data/local/vehicleDocumentStore';
import { colors, radii, spacing, typography } from '../../ui/theme';

type Props = {
  kind: VehicleDocumentKind;
  document: VehicleDocumentRow | null;
  hasVehicle: boolean;
  /** Active vehicle name, so the subtitle names whose OR/CR this is. */
  vehicleName?: string | null;
  loading: boolean;
  busy: boolean;
  /** Another document is being picked/saved. */
  blocked?: boolean;
  onChoose: () => void;
  onOpen: (uri: string) => void;
};

const PHOTO_ASPECT_RATIO = 3 / 2;

// One vehicle document slot. Both cards use the same frame so OR and CR line up even when only
// one photo is stored. The image keeps its own proportions (contain) and never stretches.
export default function VehicleDocumentCard({
  kind,
  document,
  hasVehicle,
  vehicleName,
  loading,
  busy,
  blocked,
  onChoose,
  onOpen,
}: Props) {
  const definition = VEHICLE_DOCUMENT_DEFINITIONS[kind];
  const uri = document?.image_uri ?? null;
  const [failed, setFailed] = useState(false);
  const disabled = !hasVehicle || loading || busy || !!blocked;
  const showImage = !!uri && !failed;

  useEffect(() => {
    setFailed(false);
  }, [uri]);

  const emptyTitle = !hasVehicle
    ? 'No active vehicle'
    : loading
      ? 'Loading document photos…'
      : failed
        ? `${definition.shortLabel} photo unavailable`
        : `No ${definition.shortLabel} photo yet`;

  const emptyHint = !hasVehicle
    ? 'Add a vehicle to keep its OR and CR photos here.'
    : loading
      ? 'Reading this vehicle’s saved photos.'
      : failed
        ? 'The saved image is missing. Replace it with a new photo.'
        : 'Keep a clear, well-lit photo of the document.';

  return (
    <View style={s.card}>
      <View style={s.head}>
        <View style={s.badge}>
          <Ionicons
            name={kind === 'or' ? 'receipt-outline' : 'document-text-outline'}
            size={17}
            color={colors.primaryBright}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        </View>
        <View style={s.headText}>
          <Text style={s.title} numberOfLines={1}>
            {definition.title}
          </Text>
          <Text style={s.subtitle} numberOfLines={1}>
            {document && vehicleName
              ? `${definition.shortLabel} of ${vehicleName}`
              : definition.shortLabel}
          </Text>
        </View>
        {showImage && hasVehicle ? (
          <TouchableOpacity
            style={[s.replace, disabled && s.disabled]}
            onPress={onChoose}
            disabled={disabled}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={`Replace ${definition.title} photo`}
            accessibilityState={{ disabled, busy }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons
              name="swap-horizontal"
              size={15}
              color={colors.primaryBright}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
            <Text style={s.replaceText}>{busy ? 'Opening…' : 'Replace'}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {showImage ? (
        <TouchableOpacity
          style={s.frame}
          activeOpacity={0.9}
          onPress={() => onOpen(uri)}
          accessibilityRole="imagebutton"
          accessibilityLabel={`Open ${definition.title} photo`}
        >
          <Image
            source={{ uri }}
            style={s.image}
            resizeMode="contain"
            onError={() => setFailed(true)}
            accessibilityLabel={`${definition.title} photo`}
          />
          <View style={s.viewHint} pointerEvents="none">
            <Ionicons
              name="expand-outline"
              size={13}
              color="#FFFFFF"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
            <Text style={s.viewHintText}>Tap to view</Text>
          </View>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[s.frame, s.emptyFrame, disabled && s.disabled]}
          activeOpacity={0.75}
          onPress={onChoose}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={
            hasVehicle ? `${failed ? 'Replace' : 'Add'} ${definition.title} photo` : 'No active vehicle'
          }
          accessibilityState={{ disabled, busy }}
        >
          {busy || loading ? (
            <ActivityIndicator color={colors.primaryBright} />
          ) : (
            <View style={s.emptyIcon}>
              <Ionicons
                name={hasVehicle ? 'camera-outline' : 'car-outline'}
                size={24}
                color={colors.textMuted}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
            </View>
          )}
          <Text style={s.emptyTitle}>{busy ? 'Opening photo library…' : emptyTitle}</Text>
          <Text style={s.emptyHint}>{busy ? 'Choose an image from this device.' : emptyHint}</Text>
          {hasVehicle && !loading && !busy ? (
            <View style={s.addAction}>
              <Ionicons
                name="add"
                size={15}
                color={colors.primaryBright}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
              <Text style={s.addActionText}>
                {failed ? 'Replace photo' : definition.emptyAction}
              </Text>
            </View>
          ) : null}
        </TouchableOpacity>
      )}

      {failed && hasVehicle ? (
        <Text style={s.errorText}>
          This image could not be opened. Replace it with a new {definition.shortLabel} photo.
        </Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  badge: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  headText: { flex: 1, minWidth: 0 },
  title: { ...typography.label, fontSize: 14 },
  subtitle: { ...typography.caption, marginTop: 2 },
  replace: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingLeft: spacing.sm,
  },
  replaceText: { ...typography.label, color: colors.primaryBright, fontSize: 12 },
  disabled: { opacity: 0.55 },
  frame: {
    width: '100%',
    aspectRatio: PHOTO_ASPECT_RATIO,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  image: { width: '100%', height: '100%' },
  viewHint: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  viewHintText: { ...typography.caption, color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
  emptyFrame: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  emptyIcon: {
    width: 48,
    height: 48,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  emptyTitle: { ...typography.label, textAlign: 'center' },
  emptyHint: {
    ...typography.caption,
    textAlign: 'center',
    marginTop: spacing.xs,
    maxWidth: 260,
    lineHeight: 17,
  },
  addAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  addActionText: { ...typography.label, color: colors.primaryBright, fontSize: 12 },
  errorText: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.sm,
  },
});
