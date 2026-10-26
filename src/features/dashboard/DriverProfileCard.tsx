import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  ImageBackground,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type ViewStyle,
  type TextStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  buildDriverProfileView,
  type DriverProfile,
  type DriverProfileView,
} from '../../domain/driverProfile/profile';
import type { WalletDoc } from '../../domain/dashboard/wallet';
import { colors, motion, radii, spacing, typography } from '../../ui/theme';
import {
  LICENSE_BACK,
  LICENSE_FRONT,
  CARD_ASPECT_RATIO,
  licenseCardLayout,
  type TextOverlayConfig,
} from './licenseCardLayout';

type Props = {
  doc: WalletDoc;
  profile: DriverProfile | null;
  profileUnavailable?: boolean;
  onEditProfile: () => void;
};

const BASE_WIDTH = 320;

export default function DriverProfileCard({ doc, profile, profileUnavailable, onEditProfile }: Props) {
  const window = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const flip = useRef(new Animated.Value(0)).current;
  const [back, setBack] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
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

  return (
    <View style={s.root} onLayout={onLayout}>
      <TouchableOpacity
        onPress={toggle}
        activeOpacity={0.88}
        accessibilityRole="button"
        accessibilityLabel={`Personal driver profile${view.isComplete ? ` for ${view.name}` : ''}.`}
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
          <ProfileFrontTemplate view={view} profile={profile} unit={unit} />
        </Animated.View>
        <Animated.View
          style={[s.face, s.back, { transform: [{ perspective: 1000 }, { rotateY: backRotate }] }]}
          pointerEvents={back ? 'auto' : 'none'}
          accessibilityElementsHidden={!back}
          importantForAccessibility={back ? 'auto' : 'no-hide-descendants'}
        >
          <ProfileBackTemplate view={view} profile={profile} unit={unit} />
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

function OverlayText({
  text,
  config,
  unit,
}: {
  text: string;
  config: TextOverlayConfig;
  unit: number;
}) {
  if (!text) return null;
  const fs = (base?: number) => (base || 12) * unit * 0.78;
  const style: TextStyle = {
    position: 'absolute',
    left: `${config.left}%` as any,
    top: `${config.top}%` as any,
    width: config.width != null ? (`${config.width}%` as any) : undefined,
    fontSize: fs(config.fontSize),
    lineHeight: config.lineHeight ? config.lineHeight * unit * 0.78 : undefined,
    color: config.color || '#000000',
    fontWeight: config.fontWeight as any,
    textAlign: config.textAlign || 'left',
    letterSpacing: config.letterSpacing != null ? config.letterSpacing * unit : undefined,
    backgroundColor: 'transparent',
  };
  return (
    <Text style={style} numberOfLines={config.numberOfLines || 1} ellipsizeMode="tail">
      {text}
    </Text>
  );
}

function ProfileFrontTemplate({
  view,
  profile,
  unit,
}: {
  view: DriverProfileView;
  profile: DriverProfile | null;
  unit: number;
}) {
  const [portraitFailed, setPortraitFailed] = useState(false);
  useEffect(() => {
    setPortraitFailed(false);
  }, [view.portraitUri]);

  const layout = licenseCardLayout.front;
  const fullName = profile?.full_name?.trim() || '';
  const nationality = profile?.nationality?.trim() || '';
  const sex = profile?.sex?.trim() || '';
  const dateOfBirth = profile?.date_of_birth?.trim() || '';
  const weight = profile?.weight_kg != null ? String(profile.weight_kg) : '';
  const height = profile?.height_m  != null ? String(profile.height_m)  : '';
  const address = profile?.address?.trim() || '';
  const licenseNumber = profile?.license_number?.trim() || '';
  const expirationDate = profile?.expiration_date?.trim() || '';
  const agencyCode = profile?.agency_code?.trim() || '';
  const bloodType = profile?.blood_type?.trim() || '';
  const eyeColor = profile?.eye_color?.trim() || '';
  const licenseCodes = profile?.license_codes?.trim() || '';
  const conditions = profile?.conditions?.trim() || '';

  const portraitCfg = layout.portrait;

  return (
    <View style={s.templateContainer}>
      <ImageBackground source={LICENSE_FRONT} style={s.templateImage} resizeMode="cover">
        {fullName ? <OverlayText text={fullName} config={layout.fields.fullName} unit={unit} /> : null}
        {nationality ? <OverlayText text={nationality} config={layout.fields.nationality} unit={unit} /> : null}
        {sex ? <OverlayText text={sex} config={layout.fields.sex} unit={unit} /> : null}
        {dateOfBirth ? <OverlayText text={dateOfBirth} config={layout.fields.dateOfBirth} unit={unit} /> : null}
        {weight ? <OverlayText text={weight} config={layout.fields.weight} unit={unit} /> : null}
        {height ? <OverlayText text={height} config={layout.fields.height} unit={unit} /> : null}
        {address ? <OverlayText text={address} config={layout.fields.address} unit={unit} /> : null}
        {licenseNumber ? <OverlayText text={licenseNumber} config={layout.fields.licenseNumber} unit={unit} /> : null}
        {expirationDate ? <OverlayText text={expirationDate} config={layout.fields.expirationDate} unit={unit} /> : null}
        {agencyCode ? <OverlayText text={agencyCode} config={layout.fields.agencyCode} unit={unit} /> : null}
        {bloodType ? <OverlayText text={bloodType} config={layout.fields.bloodType} unit={unit} /> : null}
        {eyeColor ? <OverlayText text={eyeColor} config={layout.fields.eyeColor} unit={unit} /> : null}
        {licenseCodes ? <OverlayText text={licenseCodes} config={layout.fields.licenseCodes} unit={unit} /> : null}
        {conditions ? <OverlayText text={conditions} config={layout.fields.conditions} unit={unit} /> : null}

        {view.portraitUri && !portraitFailed ? (
          <View
            style={[
              s.portraitOverlay,
              {
                left: `${portraitCfg.left}%` as any,
                top: `${portraitCfg.top}%` as any,
                width: `${portraitCfg.width}%` as any,
                height: `${portraitCfg.height}%` as any,
                borderRadius: portraitCfg.borderRadius || 0,
              },
            ]}
          >
            <Image
              source={{ uri: view.portraitUri }}
              style={s.portraitImg}
              resizeMode="cover"
              onError={() => setPortraitFailed(true)}
              accessibilityLabel={view.isComplete ? 'Portrait of ' + view.name : 'Profile portrait'}
            />
          </View>
        ) : null}
      </ImageBackground>
    </View>
  );
}

function ProfileBackTemplate({
  view,
  profile,
  unit,
}: {
  view: DriverProfileView;
  profile: DriverProfile | null;
  unit: number;
}) {
  const layout = licenseCardLayout.back;
  const address = profile?.address?.trim() || '';
  const licenseNumber = profile?.license_number?.trim() || '';
  const expirationDate = profile?.expiration_date?.trim() || '';
  const agencyCode = profile?.agency_code?.trim() || '';
  const licenseCodes = profile?.license_codes?.trim() || '';
  const conditions = profile?.conditions?.trim() || '';

  return (
    <View style={s.templateContainer}>
      <ImageBackground source={LICENSE_BACK} style={s.templateImage} resizeMode="cover">
        {address ? <OverlayText text={address} config={layout.fields.address} unit={unit} /> : null}
        {licenseNumber ? <OverlayText text={licenseNumber} config={layout.fields.licenseNumber} unit={unit} /> : null}
        {expirationDate ? <OverlayText text={expirationDate} config={layout.fields.expirationDate} unit={unit} /> : null}
        {agencyCode ? <OverlayText text={agencyCode} config={layout.fields.agencyCode} unit={unit} /> : null}
        {licenseCodes ? <OverlayText text={licenseCodes} config={layout.fields.licenseCodes} unit={unit} /> : null}
        {conditions ? <OverlayText text={conditions} config={layout.fields.conditions} unit={unit} /> : null}
      </ImageBackground>
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
    elevation: 2,
  },
  front: { backgroundColor: '#ffffff' },
  back: { backgroundColor: '#ffffff' },
  templateContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  templateImage: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  overlayText: {
    position: 'absolute',
    backgroundColor: 'transparent',
  },
  portraitOverlay: {
    position: 'absolute',
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  portraitImg: {
    width: '100%',
    height: '100%',
  },
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
