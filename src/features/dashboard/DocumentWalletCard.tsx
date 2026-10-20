import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  ImageSourcePropType,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { WalletDoc } from '../../domain/dashboard/wallet';
import { colors, motion, radii, spacing, typography } from '../../ui/theme';
import PrimaryButton from '../../ui/PrimaryButton';
import { usePrefs } from '../../app/prefs';

type Props = {
  docs: readonly WalletDoc[];
  /** Vehicles may have no plate recorded — the card says so rather than showing a blank. */
  onManage: () => void;
};

// Physical card artwork. The images are bundled as assets; they fill the card face edge-to-edge
// so the flip reads like a real ID card rather than a themed panel.
const LICENSE_FRONT: ImageSourcePropType = require('../../../assets/license_front.jpg');
const LICENSE_BACK: ImageSourcePropType = require('../../../assets/license_back.jpg');

const PHASE_COLOR: Record<WalletDoc['phase'], string> = {
  overdue: colors.danger,
  due_soon: colors.warningText,
  upcoming: colors.textMuted,
  none: colors.textMuted,
};

// Keep a tiny, legible label over the photo card to retain context (expiry + tap hint).
const OVERLAY_BG = 'rgba(0, 0, 0, 0.4)';
const OVERLAY_TEXT = '#FFFFFF';

// Section 4 of the dashboard: the document wallet. Two cards — Driver's licence then Vehicle
// registration — with the licence flipping to its back. The flip is presentation only: it
// changes which face is shown, never what the data is, and it is skipped under reduced motion.
export default function DocumentWalletCard({ docs, onManage }: Props) {
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
            <LicenceCard key={doc.kind} doc={doc} />
          ) : (
            <RegistrationCard key={doc.kind} doc={doc} />
          ),
        )}
      </View>
    </View>
  );
}

function CardBack({ doc }: { doc: WalletDoc }) {
  return (
    <View style={s.backImageWrap}>
      <Image
        source={LICENSE_BACK}
        style={s.backImage}
        resizeMode="cover"
        accessibilityLabel={`${doc.title} back`}
        importantForAccessibility="no-hide-descendants"
      />
    </View>
  );
}

function LicenceCard({ doc }: { doc: WalletDoc }) {
  const easy = usePrefs().uiMode === 'easy';
  const flip = useRef(new Animated.Value(0)).current;
  const [back, setBack] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    // Defensive probe: the flag is not part of the public RN type surface on every version, so
    // it is read through a cast and defaults to "animation allowed" when unavailable.
    const info = AccessibilityInfo as unknown as {
      isReduceMotionEnabled?: () => Promise<boolean>;
      addEventListener?: (event: string, handler: (value: boolean) => void) => { remove: () => void };
    };
    info
      .isReduceMotionEnabled?.()
      .then((v) => {
        if (alive) setReduceMotion(v);
      })
      .catch(() => {});
    const sub = info.addEventListener?.('reduceMotionChanged', (v) => {
      if (alive) setReduceMotion(v);
    });
    return () => {
      alive = false;
      sub?.remove();
    };
  }, []);

  const toggle = useCallback(() => {
    const toBack = !back;
    setBack(toBack);
    if (reduceMotion) {
      flip.setValue(toBack ? 1 : 0);
      return;
    }
    Animated.timing(flip, {
      toValue: toBack ? 1 : 0,
      duration: motion.slow,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [back, flip, reduceMotion]);

  // Interpolation is written into `rotateY` on both faces; the back starts pre-rotated so the
  // two faces line up as one card rather than two mirror images.
  const frontRotate = flip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  const backRotate = flip.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] });

  return (
    <TouchableOpacity
      onPress={toggle}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`${doc.title}. ${doc.expiryText}.`}
      accessibilityHint={back ? 'Shows the front of the licence card' : 'Shows the back of the licence card'}
      accessibilityState={{ expanded: back }}
      style={s.flipWrap}
    >
      <Animated.View
        style={[s.face, s.front, { transform: [{ perspective: 1000 }, { rotateY: frontRotate }] }]}
        pointerEvents={back ? 'none' : 'auto'}
      >
        <Image
          source={LICENSE_FRONT}
          style={s.frontImage}
          resizeMode="cover"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
        <View style={s.frontOverlay}>
          <View style={s.frontOverlayRow}>
            <View style={s.frontTitleWrap}>
              <Text style={s.frontTitle}>{doc.title}</Text>
            </View>
            <Ionicons
              name="refresh"
              size={14}
              color={OVERLAY_TEXT}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
          </View>
          <View style={s.frontBottom}>
            <Text style={[s.overlayExpiry, easy && s.easyExpiry]}>{doc.expiryText}</Text>
            <Text style={s.hint}>Tap to flip</Text>
          </View>
        </View>
      </Animated.View>
      <Animated.View
        style={[s.face, s.backFace, { transform: [{ perspective: 1000 }, { rotateY: backRotate }] }]}
        pointerEvents={back ? 'auto' : 'none'}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <CardBack doc={doc} />
      </Animated.View>
    </TouchableOpacity>
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
      <Text style={[s.expiry, { color: PHASE_COLOR[doc.phase] }]}>{doc.expiryText}</Text>
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
  // Both faces share this box; `backfaceVisibility` hides whichever side is turned away.
  flipWrap: { height: 265 },
  face: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backfaceVisibility: 'hidden',
    // Android needs the slight lift for the 3D flip to read as rotation rather than a squash.
    elevation: 2,
  },
  front: {
    backgroundColor: colors.surface,
  },
  frontImage: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%' },
  frontOverlay: { flex: 1, justifyContent: 'space-between', padding: spacing.lg },
  frontOverlayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  frontTitleWrap: { backgroundColor: OVERLAY_BG, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.sm },
  frontTitle: { ...typography.label, color: OVERLAY_TEXT },
  frontBottom: { alignItems: 'flex-start' },
  overlayExpiry: { ...typography.label, color: OVERLAY_TEXT, backgroundColor: OVERLAY_BG, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.sm, overflow: 'hidden' },
  backFace: {
    backgroundColor: colors.surface,
  },
  backImageWrap: { flex: 1 },
  backImage: { flex: 1, width: '100%', height: '100%' },
  registrationBase: {
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  registration: {
    backgroundColor: colors.surfaceRaised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.glassBorder,
  },
  docHead: { flexDirection: 'row', alignItems: 'center' },
  badge: {
    width: 28,
    height: 28,
    borderRadius: radii.sm,
    backgroundColor: colors.primaryTint,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  docTitle: { ...typography.label, flex: 1 },
  subject: { ...typography.caption, marginTop: spacing.sm },
  plate: { ...typography.heading, marginTop: spacing.xs, letterSpacing: 1 },
  expiry: { ...typography.label, marginTop: spacing.sm },
  easyExpiry: { fontSize: 17 },
  hint: { ...typography.caption, color: OVERLAY_TEXT, marginTop: spacing.xs, backgroundColor: OVERLAY_BG, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.sm, overflow: 'hidden', alignSelf: 'flex-start' },
  back: { flex: 1, justifyContent: 'center' },
  watermark: { position: 'absolute', right: -20, bottom: -30, opacity: 0.6 },
  backTitle: { ...typography.label },
  backLine: { ...typography.caption, marginTop: spacing.xs, lineHeight: 18 },
  backCaption: { ...typography.caption, color: colors.textMuted, marginTop: spacing.sm },
});
