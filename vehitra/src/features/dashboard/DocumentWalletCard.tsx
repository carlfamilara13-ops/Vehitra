
import React from 'react';
import { StyleSheet } from 'react-native';
import { TouchableOpacity, View } from '../../ui/neu/NeuAuto';
import { Text } from '../../ui/neu/NeuText';
import { Ionicons } from '@expo/vector-icons';
import type { WalletDoc } from '../../domain/dashboard/wallet';
import type { DriverProfile } from '../../domain/driverProfile/profile';
import {
  VEHICLE_DOCUMENT_DEFINITIONS,
  VEHICLE_DOCUMENT_KINDS,
  type VehicleDocumentKind,
} from '../../domain/vehicleDocuments/documents';
import type { VehicleDocumentRow } from '../../data/local/vehicleDocumentStore';
import { colors, spacing, typography } from '../../ui/theme';
import DriverProfileCard from './DriverProfileCard';
import VehicleDocumentCard from './VehicleDocumentCard';

type Props = {
  docs: readonly WalletDoc[];
  /** Personal card details. Null until the driver saves a profile. */
  profile: DriverProfile | null;
  /** A local read failed; the profile card still renders its empty states. */
  profileUnavailable?: boolean;
  /** True when an active vehicle exists; OR/CR photos need one. */
  hasVehicle: boolean;
  /** Display name of the active vehicle, used to label whose documents these are. */
  vehicleName?: string | null;
  /** Saved OR/CR rows for the active vehicle only. */
  documents: readonly VehicleDocumentRow[];
  documentsLoading?: boolean;
  /** The document read failed; cards keep their empty states and the wallet says so. */
  documentsUnavailable?: boolean;
  documentBusyKind?: VehicleDocumentKind | null;
  documentError?: string | null;
  onChooseDocument: (kind: VehicleDocumentKind) => void;
  onOpenDocument: (kind: VehicleDocumentKind, uri: string) => void;
  onEditProfile: () => void;
  /** Vehicles may have no plate recorded   the card says so rather than showing a blank. */
  onManage: () => void;
};

// Section 4 of the dashboard: the document wallet. The personal profile keeps its existing flip
// card, followed by the active vehicle's OR and CR photos.
export default function DocumentWalletCard({
  docs,
  profile,
  profileUnavailable,
  hasVehicle,
  vehicleName,
  documents,
  documentsLoading,
  documentsUnavailable,
  documentBusyKind,
  documentError,
  onChooseDocument,
  onOpenDocument,
  onEditProfile,
  onManage,
}: Props) {
  const license = docs.find((doc) => doc.kind === 'license');

  return (
    <View style={s.root}>
      <View style={s.headRow}>
        <Text style={typography.heading}>Document wallet </Text>
        <TouchableOpacity
          onPress={onManage}
          accessibilityRole="button"
          accessibilityLabel="Open reminders"
          accessibilityHint="Opens the reminders screen to add or edit document dates"
          activeOpacity={0.75}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={s.manage}
        >
          <Text style={s.manageText}>Manage </Text>
          <Ionicons
            name="chevron-forward"
            size={14}
            color={colors.primaryBright}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        </TouchableOpacity>
      </View>
      <View style={s.cards}>
        {license ? (
          <DriverProfileCard key={license.kind} doc={license} profile={profile} />
        ) : null}
        {VEHICLE_DOCUMENT_KINDS.map((kind) => (
          <VehicleDocumentCard
            key={kind}
            kind={kind}
            document={documents.find((row) => row.kind === kind) ?? null}
            hasVehicle={hasVehicle}
            vehicleName={vehicleName}
            loading={!!documentsLoading}
            busy={documentBusyKind === kind}
            blocked={!!documentBusyKind && documentBusyKind !== kind}
            onChoose={() => onChooseDocument(kind)}
            onOpen={(uri) => onOpenDocument(kind, uri)}
          />
        ))}
      </View>
      {documentsUnavailable ? (
        <Text style={s.error} accessibilityLiveRegion="polite">
          Could not load this vehicle’s document photos. Try again from this screen.
        </Text>
      ) : null}
      {documentError ? (
        <Text style={s.error} accessibilityLiveRegion="polite">
          {documentError}
        </Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { marginBottom: spacing.lg },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  manage: { flexDirection: 'row', alignItems: 'center' },
  manageText: { ...typography.label, color: colors.primaryBright },
  cards: { gap: spacing.md },
  error: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.md,
  },
});
