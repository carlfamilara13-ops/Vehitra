import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  buildDriverProfileView,
  DRIVER_PROFILE_EMPTY_FIELD,
  type DriverProfile,
  type DriverProfileView,
} from '../../domain/driverProfile/profile';
import type { WalletDoc } from '../../domain/dashboard/wallet';
import { colors, fonts, motion, radii, spacing, typography } from '../../ui/theme';

type Props = {
  doc: WalletDoc;
  profile: DriverProfile | null;
  /** True when the local read failed; the card still renders with empty states. */
  profileUnavailable?: boolean;
  onEditProfile: () => void;
};

// Credit-card proportions keep the profile card landscape on every Android width. Everything
// inside scales from the measured width instead of from a fixed pixel height, so the content
// does not clip on small screens or look stranded on large ones.
const CARD_ASPECT_RATIO = 1.586;
const BASE_WIDTH = 320;

const CARD_BG = '#0C1728';
const CARD_BG_RAISED = '#12233D';
const CARD_BORDER = 'rgba(125, 165, 235, 0.26)';
const CARD_TEXT = colors.text;
const CARD_MUTED = '#9FB1CF';
const CARD_FAINT = '#6F84A8';
const CARD_ACCENT = colors.primaryBright;

export default function DriverProfileCard({ doc, profile, profileUnavailable, onEditProfile }: Props) {
  const window = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const flip = useRef(new Animated.Value(0)).current;
  const [back, setBack] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    // Same defensive probe used by the original wallet card: not every RN version exposes the
    // reduced-motion flag, and when it is unavailable the flip simply animates.
    const info = AccessibilityInfo as unknown as {
      isReduceMotionEnabled?: () => Promise<boolean>;
      addEventListener?: (event: string, handler: (value: boolean) => void) => { remove: () => void };
    };
    info
      .isReduceMotionEnabled?.()
      .then((value) => {
        if (alive) setReduceMotion(value);
      })
      .catch(() => {});
    const sub = info.addEventListener?.('reduceMotionChanged', (value) => {
      if (alive) setReduceMotion(value);
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

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setMeasuredWidth((current) => (Math.abs(current - next) > 0.5 ? next : current));
  }, []);

  const frontRotate = flip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  const backRotate = flip.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] });

  const width = measuredWidth > 0 ? measuredWidth : Math.max(240, window.width - spacing.lg * 2);
  const unit = width / BASE_WIDTH;
  const height = width / CARD_ASPECT_RATIO;
  const view = buildDriverProfileView(profile);
  const expiry = profile?.expiration_date ? view.expirationDate : doc.expiryText;

  return (
    <View style={s.root} onLayout={onLayout}>
      <TouchableOpacity
        onPress={toggle}
        activeOpacity={0.88}
        accessibilityRole="button"
        accessibilityLabel={`Personal driver profile${view.isComplete ? ` for ${view.name}` : ''}. ${expiry}.`}
        accessibilityHint={back ? 'Shows the front of the profile card' : 'Shows the back of the profile card'}
        accessibilityState={{ expanded: back }}
        style={[s.flipWrap, { height }]}
      >
        <Animated.View
          style={[s.face, s.front, { transform: [{ perspective: 1000 }, { rotateY: frontRotate }] }]}
          pointerEvents={back ? 'none' : 'auto'}
          accessibilityElementsHidden={back}
          importantForAccessibility={back ? 'no-hide-descendants' : 'auto'}
        >
          <ProfileFront view={view} expiry={expiry} unit={unit} unavailable={!!profileUnavailable} />
        </Animated.View>
        <Animated.View
          style={[s.face, s.back, { transform: [{ perspective: 1000 }, { rotateY: backRotate }] }]}
          pointerEvents={back ? 'auto' : 'none'}
          accessibilityElementsHidden={!back}
          importantForAccessibility={back ? 'auto' : 'no-hide-descendants'}
        >
          <ProfileBack view={view} expiry={expiry} unit={unit} />
        </Animated.View>
      </TouchableOpacity>

      <View style={s.actions}>
        <Text style={s.caption} numberOfLines={2}>
          {profileUnavailable
            ? 'Could not load the saved profile. Reopen this screen to retry.'
            : 'Personal digital record · stays on this device'}
        </Text>
        <TouchableOpacity
          onPress={onEditProfile}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={view.isComplete ? 'Edit driver profile' : 'Add driver profile'}
          accessibilityHint="Opens a form for the name, details and portrait shown on this card"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={s.editBtn}
        >
          <Ionicons name="create-outline" size={15} color={colors.primaryBright} />
          <Text style={s.editTxt}>{view.isComplete ? 'Edit profile' : 'Add profile'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ProfileFront({
  view,
  expiry,
  unit,
  unavailable,
}: {
  view: DriverProfileView;
  expiry: string;
  unit: number;
  unavailable: boolean;
}) {
  const fs = (size: number) => size * unit;
  const [portraitFailed, setPortraitFailed] = useState(false);
  useEffect(() => {
    setPortraitFailed(false);
  }, [view.portraitUri]);
  return (
    <View style={[s.frontInner, { padding: fs(13) }]}>
      <View
        pointerEvents="none"
        style={[
          s.decorCircle,
          { width: unit * 190, height: unit * 190, borderRadius: unit * 95, right: unit * -55, top: unit * -80 },
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          s.decorLine,
          { width: unit * 240, height: unit * 2, right: unit * -60, bottom: unit * 30 },
        ]}
      />

      <View style={s.topRow}>
        <View>
          <Text style={[s.wordmark, { fontSize: fs(11), letterSpacing: fs(2) }]}>VEHITRA</Text>
          <Text style={[s.kicker, { fontSize: fs(6.5), letterSpacing: fs(1.2) }]}>PERSONAL DRIVER RECORD</Text>
        </View>
        <View style={[s.badge, { paddingHorizontal: fs(5), paddingVertical: fs(3), borderRadius: fs(4) }]}>
          <Text style={[s.badgeTxt, { fontSize: fs(5.5), letterSpacing: fs(0.5) }]}>
            {unavailable ? 'PROFILE UNAVAILABLE' : 'NOT AN OFFICIAL LICENCE'}
          </Text>
        </View>
      </View>

      <View style={[s.bodyRow, { marginTop: fs(7) }]}>
        <View style={[s.bodyLeft, { paddingRight: fs(9) }]}>
          <Text
            style={[s.name, { fontSize: fs(17.5), lineHeight: fs(20) }]}
            numberOfLines={2}
            accessibilityLabel={`Name: ${view.name}`}
          >
            {view.name}
          </Text>
          <Text style={[s.subtitle, { fontSize: fs(7.2), marginTop: fs(2) }]} numberOfLines={1}>
            {view.subtitle}
          </Text>
          <Text style={[s.address, { fontSize: fs(7.2), lineHeight: fs(9.4), marginTop: fs(4) }]} numberOfLines={2}>
            {view.address}
          </Text>

          <View style={[s.bottomBlock, { marginTop: fs(7) }]}>
            <View style={s.fieldRow}>
              <MiniField label="LICENCE NO." value={view.licenseNumber} unit={unit} flex={1.15} />
              <MiniField label="EXPIRES" value={expiry} unit={unit} flex={1} />
              <MiniField label="AGENCY" value={view.agencyCode} unit={unit} flex={0.75} />
            </View>
            <View style={[s.fieldRow, { marginTop: fs(4) }]}>
              <MiniField label="BLOOD" value={view.bloodType} unit={unit} flex={0.7} />
              <MiniField label="EYES" value={view.eyeColor} unit={unit} flex={0.9} />
              <MiniField label="WEIGHT / HEIGHT" value={view.physical} unit={unit} flex={1.4} />
            </View>
          </View>
        </View>

        <View
          style={[
            s.portraitFrame,
            {
              width: fs(66),
              height: fs(88),
              borderRadius: fs(7),
              borderWidth: Math.max(1, fs(1)),
            },
          ]}
        >
          {view.portraitUri && !portraitFailed ? (
            <Image
              source={{ uri: view.portraitUri }}
              style={s.portraitImage}
              resizeMode="cover"
              onError={() => setPortraitFailed(true)}
              accessibilityLabel={view.isComplete ? `Portrait of ${view.name}` : 'Profile portrait'}
            />
          ) : (
            <View style={s.portraitEmpty}>
              <Ionicons name="person-outline" size={fs(22)} color={CARD_FAINT} />
              <Text style={[s.portraitHint, { fontSize: fs(5.8), marginTop: fs(3) }]}>
                {view.portraitUri ? 'PHOTO UNAVAILABLE' : 'ADD PHOTO'}
              </Text>
            </View>
          )}
        </View>
      </View>

      <View style={[s.cardFooter, { marginTop: 'auto', paddingTop: fs(5) }]}>
        <Text style={[s.footerTxt, { fontSize: fs(6.2) }]} numberOfLines={1}>
          {view.licenseCodes === DRIVER_PROFILE_EMPTY_FIELD
            ? 'PERSONAL DIGITAL RECORD'
            : `CODES ${view.licenseCodes}`}
        </Text>
        <Text style={[s.footerTxt, { fontSize: fs(6.2) }]}>TAP TO FLIP</Text>
      </View>
    </View>
  );
}

function ProfileBack({ view, expiry, unit }: { view: DriverProfileView; expiry: string; unit: number }) {
  const fs = (size: number) => size * unit;
  return (
    <View style={[s.backInner, { padding: fs(13) }]}>
      <View style={s.topRow}>
        <View>
          <Text style={[s.wordmark, { fontSize: fs(10), letterSpacing: fs(1.8) }]}>VEHITRA</Text>
          <Text style={[s.kicker, { fontSize: fs(6.2), letterSpacing: fs(1) }]}>PERSONAL DRIVER RECORD · BACK</Text>
        </View>
        <Text style={[s.name, { fontSize: fs(11), flexShrink: 1, textAlign: 'right' }]} numberOfLines={1}>
          {view.name}
        </Text>
      </View>

      <Text style={[s.disclaimer, { fontSize: fs(6.2), lineHeight: fs(8), marginTop: fs(5) }]}>
        This is a personal digital record kept on this device. It is not a government-issued
        licence and cannot replace an official driver licence.
      </Text>

      <View style={[s.backGrid, { marginTop: fs(6) }]}>
        <View style={s.backRow}>
          <MiniField label="ADDRESS" value={view.address} unit={unit} flex={1.7} lines={2} />
          <MiniField label="CONDITIONS / RESTRICTIONS" value={view.conditions} unit={unit} flex={1.3} lines={2} />
        </View>
        <View style={[s.backRow, { marginTop: fs(5) }]}>
          <MiniField label="LICENCE NO." value={view.licenseNumber} unit={unit} flex={1} />
          <MiniField label="EXPIRES" value={expiry} unit={unit} flex={1} />
          <MiniField label="AGENCY" value={view.agencyCode} unit={unit} flex={0.7} />
        </View>
        <View style={[s.backRow, { marginTop: fs(5) }]}>
          <MiniField label="DRIVER CODES" value={view.licenseCodes} unit={unit} flex={1.4} />
          <MiniField label="BLOOD / EYES" value={fieldPair(view.bloodType, view.eyeColor)} unit={unit} flex={1} />
          <MiniField label="WEIGHT / HEIGHT" value={view.physical} unit={unit} flex={1} />
        </View>
      </View>

      <View style={[s.cardFooter, { marginTop: 'auto', paddingTop: fs(5) }]}>
        <Text style={[s.footerTxt, { fontSize: fs(6.2) }]}>STORED ONLY ON THIS DEVICE</Text>
        <Text style={[s.footerTxt, { fontSize: fs(6.2) }]}>TAP TO FLIP</Text>
      </View>
    </View>
  );
}

function fieldPair(first: string, second: string): string {
  const firstEmpty = first === DRIVER_PROFILE_EMPTY_FIELD;
  const secondEmpty = second === DRIVER_PROFILE_EMPTY_FIELD;
  if (firstEmpty && secondEmpty) return DRIVER_PROFILE_EMPTY_FIELD;
  if (firstEmpty) return second;
  if (secondEmpty) return first;
  return `${first} / ${second}`;
}

function MiniField({
  label,
  value,
  unit,
  flex,
  lines = 1,
}: {
  label: string;
  value: string;
  unit: number;
  flex: number;
  lines?: number;
}) {
  const empty = value === DRIVER_PROFILE_EMPTY_FIELD;
  return (
    <View style={{ flex, minWidth: 0 }}>
      <Text
        style={[s.fieldLabel, { fontSize: 6 * unit, letterSpacing: 0.45 * unit }]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text
        style={[s.fieldValue, empty && s.fieldEmpty, { fontSize: 8.2 * unit, lineHeight: 9.8 * unit }]}
        numberOfLines={lines}
      >
        {value}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: {},
  flipWrap: { width: '100%' },
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
  front: { backgroundColor: CARD_BG, borderWidth: 1, borderColor: CARD_BORDER },
  back: { backgroundColor: CARD_BG_RAISED, borderWidth: 1, borderColor: CARD_BORDER },
  frontInner: { flex: 1 },
  backInner: { flex: 1 },
  decorCircle: {
    position: 'absolute',
    backgroundColor: 'rgba(77, 141, 255, 0.10)',
  },
  decorLine: {
    position: 'absolute',
    backgroundColor: 'rgba(77, 141, 255, 0.20)',
    transform: [{ rotate: '-18deg' }],
  },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm },
  wordmark: { fontFamily: fonts.display, color: CARD_TEXT },
  kicker: { fontFamily: fonts.display, color: CARD_MUTED, marginTop: 1 },
  badge: {
    borderWidth: 1,
    borderColor: 'rgba(159, 177, 207, 0.45)',
    backgroundColor: 'rgba(9, 19, 34, 0.65)',
    maxWidth: '52%',
  },
  badgeTxt: { fontFamily: fonts.display, color: CARD_MUTED, textAlign: 'center' },
  bodyRow: { flexDirection: 'row', flex: 1, minHeight: 0 },
  bodyLeft: { flex: 1, minWidth: 0 },
  name: { fontFamily: fonts.display, color: CARD_TEXT, letterSpacing: 0.2 },
  subtitle: { color: CARD_TEXT, fontWeight: '600' },
  address: { color: CARD_MUTED },
  bottomBlock: { justifyContent: 'flex-end' },
  fieldRow: { flexDirection: 'row', gap: 6 },
  fieldLabel: { fontFamily: fonts.display, color: CARD_FAINT, textTransform: 'uppercase' },
  fieldValue: { color: CARD_TEXT, fontWeight: '600' },
  fieldEmpty: { color: CARD_FAINT, fontWeight: '400' },
  portraitFrame: {
    borderColor: 'rgba(159, 177, 207, 0.45)',
    backgroundColor: 'rgba(9, 19, 34, 0.7)',
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  portraitImage: { width: '100%', height: '100%' },
  portraitEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 4 },
  portraitHint: { fontFamily: fonts.display, color: CARD_FAINT, letterSpacing: 0.8 },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(159, 177, 207, 0.22)',
  },
  footerTxt: { fontFamily: fonts.display, color: CARD_FAINT, letterSpacing: 0.6, flexShrink: 1 },
  disclaimer: { color: CARD_MUTED },
  backGrid: { flex: 1 },
  backRow: { flexDirection: 'row', gap: 7 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  caption: { ...typography.caption, flex: 1 },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.primaryBright,
  },
  editTxt: { ...typography.label, color: colors.primaryBright },
});
