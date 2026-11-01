
import React from 'react';
import type { ColorValue } from 'react-native';
import { StyleSheet } from 'react-native';
import { TouchableOpacity, View } from '../../ui/neu/NeuAuto';
import { Text } from '../../ui/neu/NeuText';
import { Ionicons } from '@expo/vector-icons';
import type { WalletDoc } from '../../domain/dashboard/wallet';
import type { DriverProfile } from '../../domain/driverProfile/profile';
import { colors, radii, spacing, typography } from '../../ui/theme';
import DriverProfileCard from './DriverProfileCard';

type Props = {
  docs: readonly WalletDoc[];
  /** Personal card details. Null until the driver saves a profile. */
  profile: DriverProfile | null;
  /** A local read failed; the profile card still renders its empty states. */
  profileUnavailable?: boolean;
  onEditProfile: () => void;
  /** Vehicles may have no plate recorded — the card says so rather than showing a blank. */
  onManage: () => void;
};

const PHASE_COLOR: Record<WalletDoc['phase'], ColorValue> = {
  overdue: colors.danger,
  due_soon: colors.warningText,
  upcoming: colors.textMuted,
  none: colors.textMuted,
};

// Section 4 of the dashboard: the document wallet. Two cards — personal driver profile then
// vehicle registration. The profile card keeps the existing flip interaction, but its faces are
// native views of the driver's own data rather than bundled credential artwork.
export default function DocumentWalletCard({
  docs,
  profile,
  profileUnavailable,
  onEditProfile,
  onManage,
}: Props) {
  return (
    <View style={s.root}>
      <View style={s.headRow}>
        <Text style={typography.heading}>Document wallet</Text>
        <TouchableOpacity
          onPress={onManage}
          accessibilityRole="button"
          accessibilityLabel="Open reminders"
          accessibilityHint="Opens the reminders screen to add or edit document dates"
          activeOpacity={0.75}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={s.manage}
        >
          <Text style={s.manageText}>Manage</Text>
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
        {docs.map((doc) =>
          doc.kind === 'license' ? (
            <DriverProfileCard
              key={doc.kind}
              doc={doc}
              profile={profile}
              profileUnavailable={profileUnavailable}
              onEditProfile={onEditProfile}
            />
          ) : (
            <RegistrationCard key={doc.kind} doc={doc} />
          ),
        )}
      </View>
    </View>
  );
}

function RegistrationCard({ doc }: { doc: WalletDoc }) {
  return (
    <View style={[s.registrationBase, s.registration]}>
      <View style={s.docHead}>
        <View style={s.badge}>
          <Ionicons
            name="card-outline"
            size={16}
            color={colors.primaryBright}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        </View>
        <Text style={s.docTitle}>{doc.title}</Text>
      </View>
      {doc.subject ? <Text style={s.subject}>{doc.subject}</Text> : null}
      <Text style={s.plate}>{doc.plate ?? 'No plate recorded'}</Text>
      <Text style={[s.expiry, { color: PHASE_COLOR[doc.phase] }]}>
        {doc.expiryText}
      </Text>
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
  registrationBase: {
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  registration: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
  },
  docHead: { flexDirection: 'row', alignItems: 'center' },
  badge: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  docTitle: { ...typography.label, flex: 1 },
  subject: { ...typography.caption, marginTop: spacing.sm },
  plate: { ...typography.heading, marginTop: spacing.xs, letterSpacing: 1 },
  expiry: { ...typography.label, marginTop: spacing.sm },
});
