
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  ImageBackground,
  StyleSheet,
  TouchableOpacity,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type TextStyle,
} from 'react-native';
import { Text } from '../../ui/neu/NeuText';
import {
  buildDriverProfileView,
  type DriverProfile,
  type DriverProfileView,
} from '../../domain/driverProfile/profile';
import type { WalletDoc } from '../../domain/dashboard/wallet';
import { motion, radii, spacing } from '../../ui/theme';
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
};

const BASE_WIDTH = 320;

export default function DriverProfileCard({ doc, profile }: Props) {
  const window = useWindowDimensions();
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const flip = useRef(new Animated.Value(0)).current;
  const [back, setBack] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;

    const info = AccessibilityInfo as unknown as {
      isReduceMotionEnabled?: () => Promise<boolean>;
      addEventListener?: (
        event: string,
        handler: (value: boolean) => void,
      ) => { remove: () => void };
    };

    info.isReduceMotionEnabled?.()
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
    setMeasuredWidth((current) =>
      Math.abs(current - next) > 0.5 ? next : current,
    );
  }, []);

  const frontRotate = flip.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  const backRotate = flip.interpolate({
    inputRange: [0, 1],
    outputRange: ['180deg', '360deg'],
  });

  const shadowScale = flip.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 0.12, 1],
  });

  const shadowOpacity = flip.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.85, 0.08, 0.85],
  });

  const width =
    measuredWidth > 0
      ? measuredWidth
      : Math.max(240, window.width - spacing.lg * 2);

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
        accessibilityHint={
          back
            ? 'Shows the front of the profile card'
            : 'Shows the back of the profile card'
        }
        accessibilityState={{ expanded: back }}
        style={[s.flipWrap, { height }]}
      >
        <Animated.View
          pointerEvents="none"
          style={[
            s.dynamicShadow,
            {
              opacity: shadowOpacity,
              transform: [{ scaleX: shadowScale }],
            },
          ]}
        />

        <Animated.View
          style={[
            s.face,
            s.front,
            {
              transform: [
                { perspective: 1000 },
                { rotateY: frontRotate },
              ],
            },
          ]}
          pointerEvents={back ? 'none' : 'auto'}
          accessibilityElementsHidden={back}
          importantForAccessibility={back ? 'no-hide-descendants' : 'auto'}
        >
          <View style={s.faceClip}>
            <ProfileFrontTemplate
              view={view}
              profile={profile}
              unit={unit}
            />
          </View>
        </Animated.View>

        <Animated.View
          style={[
            s.face,
            s.back,
            {
              transform: [
                { perspective: 1000 },
                { rotateY: backRotate },
              ],
            },
          ]}
          pointerEvents={back ? 'auto' : 'none'}
          accessibilityElementsHidden={!back}
          importantForAccessibility={back ? 'auto' : 'no-hide-descendants'}
        >
          <View style={s.faceClip}>
            <ProfileBackTemplate
              view={view}
              profile={profile}
              unit={unit}
            />
          </View>
        </Animated.View>
      </TouchableOpacity>
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
    width:
      config.width != null
        ? (`${config.width}%` as any)
        : undefined,
    fontSize: fs(config.fontSize),
    lineHeight: config.lineHeight
      ? config.lineHeight * unit * 0.78
      : undefined,
    color: config.color || '#000000',
    fontWeight: config.fontWeight as any,
    textAlign: config.textAlign || 'left',
    letterSpacing:
      config.letterSpacing != null
        ? config.letterSpacing * unit
        : undefined,
    backgroundColor: 'transparent',
  };

  return (
    <Text
      style={style}
      numberOfLines={config.numberOfLines || 1}
      ellipsizeMode="tail"
    >
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
  const weight =
    profile?.weight_kg != null ? String(profile.weight_kg) : '';
  const height =
    profile?.height_m != null ? String(profile.height_m) : '';
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
      <ImageBackground
        source={LICENSE_FRONT}
        style={s.templateImage}
        resizeMode="cover"
      >
        {fullName ? (
          <OverlayText text={fullName} config={layout.fields.fullName} unit={unit} />
        ) : null}

        {nationality ? (
          <OverlayText text={nationality} config={layout.fields.nationality} unit={unit} />
        ) : null}

        {sex ? (
          <OverlayText text={sex} config={layout.fields.sex} unit={unit} />
        ) : null}

        {dateOfBirth ? (
          <OverlayText text={dateOfBirth} config={layout.fields.dateOfBirth} unit={unit} />
        ) : null}

        {weight ? (
          <OverlayText text={weight} config={layout.fields.weight} unit={unit} />
        ) : null}

        {height ? (
          <OverlayText text={height} config={layout.fields.height} unit={unit} />
        ) : null}

        {address ? (
          <OverlayText text={address} config={layout.fields.address} unit={unit} />
        ) : null}

        {licenseNumber ? (
          <OverlayText text={licenseNumber} config={layout.fields.licenseNumber} unit={unit} />
        ) : null}

        {expirationDate ? (
          <OverlayText text={expirationDate} config={layout.fields.expirationDate} unit={unit} />
        ) : null}

        {agencyCode ? (
          <OverlayText text={agencyCode} config={layout.fields.agencyCode} unit={unit} />
        ) : null}

        {bloodType ? (
          <OverlayText text={bloodType} config={layout.fields.bloodType} unit={unit} />
        ) : null}

        {eyeColor ? (
          <OverlayText text={eyeColor} config={layout.fields.eyeColor} unit={unit} />
        ) : null}

        {licenseCodes ? (
          <OverlayText text={licenseCodes} config={layout.fields.licenseCodes} unit={unit} />
        ) : null}

        {conditions ? (
          <OverlayText text={conditions} config={layout.fields.conditions} unit={unit} />
        ) : null}

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
              accessibilityLabel={
                view.isComplete
                  ? 'Portrait of ' + view.name
                  : 'Profile portrait'
              }
            />
          </View>
        ) : null}
      </ImageBackground>
    </View>
  );
}

function ProfileBackTemplate({
  profile,
  unit,
}: {
  view: DriverProfileView;
  profile: DriverProfile | null;
  unit: number;
}) {
  const [photoFailed, setPhotoFailed] = useState(false);

  const backPhotoUri =
    (profile as (DriverProfile & { back_photo_uri?: string | null }) | null)
      ?.back_photo_uri ?? null;

  const dlCode = profile?.dl_code?.trim() || '';
  const serialNumber = profile?.serial_number?.trim() || '';
  const licenseCodes = profile?.license_codes?.trim() || '';
  const address = profile?.address?.trim() || '';
  const conditions = profile?.conditions?.trim() || '';
  const licenseNumber = profile?.license_number?.trim() || '';
  const agencyCode = profile?.agency_code?.trim() || '';
  const expirationDate = profile?.expiration_date?.trim() || '';

  const layout = licenseCardLayout.back;
  const photoCfg = layout.photo;

  useEffect(() => {
    setPhotoFailed(false);
  }, [backPhotoUri]);

  return (
    <View style={s.templateContainer}>
      <ImageBackground
        source={LICENSE_BACK}
        style={s.templateImage}
        resizeMode="cover"
      >
        {backPhotoUri && !photoFailed ? (
          <View
            style={[
              s.backPhotoOverlay,
              {
                left: `${photoCfg.left}%` as any,
                top: `${photoCfg.top}%` as any,
                width: `${photoCfg.width}%` as any,
                height: `${photoCfg.height}%` as any,
                borderRadius: photoCfg.borderRadius || 0,
              },
            ]}
          >
            <Image
              source={{ uri: backPhotoUri }}
              style={s.backPhotoImage}
              resizeMode="cover"
              onError={() => setPhotoFailed(true)}
              accessibilityLabel="Back-side license photo"
            />
          </View>
        ) : null}

        {dlCode ? (
          <OverlayText
            text={dlCode}
            config={layout.fields.dlCode}
            unit={unit}
          />
        ) : null}

        {serialNumber ? (
          <OverlayText
            text={serialNumber}
            config={layout.fields.serialNumber}
            unit={unit}
          />
        ) : null} 

      </ImageBackground>
    </View>
  );
}

const s = StyleSheet.create({
  root: {},

  flipWrap: {
    width: '100%',
  },

  face: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: radii.lg,
    backfaceVisibility: 'hidden',
  },

  dynamicShadow: {
    position: 'absolute',
    left: '2%',
    right: '2%',
    top: '18%',
    bottom: -2,
    borderRadius: radii.lg,
    backgroundColor: 'rgba(0, 0, 0, 0.08)',
    shadowColor: '#000000',
    shadowOffset: {
      width: 0,
      height: 7,
    },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 5,
  },

  faceClip: {
    flex: 1,
    width: '100%',
    height: '100%',
    borderRadius: radii.lg,
    overflow: 'hidden',
  },

  front: {
    backgroundColor: 'transparent',
  },

  back: {
    backgroundColor: 'transparent',
  },

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

  portraitOverlay: {
    position: 'absolute',
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },

  portraitImg: {
    width: '100%',
    height: '100%',
  },

  backPhotoOverlay: {
    position: 'absolute',
    overflow: 'hidden',
    backgroundColor: 'rgba(0, 0, 0, 0.06)',
  },

  backPhotoImage: {
    width: '100%',
    height: '100%',
  },
});
