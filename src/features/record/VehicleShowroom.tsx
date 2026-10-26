import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import type { VehicleRow } from '../../data/local/vehicleStore';
import { vehicleDisplayName } from '../../data/local/vehicleStore';
import GlassSurface from '../../ui/GlassSurface';
import { colors, motion, radii, spacing, typography } from '../../ui/theme';
import { pageForOffset, selectedVehicleIndex, vehicleTypeIcon } from './garageView';
import { SHOWROOM_BACKGROUND, showroomVehicleImage } from './showroomAssets';
import { usePrefs } from '../../app/prefs';

type Props = {
  vehicles: readonly VehicleRow[];
  /** The shared active vehicle — the page the showroom opens on and reports back. */
  selectedId: string | null;
  /** Fired when a swipe settles on a new page; the caller persists the selection. */
  onSelect: (vehicle: VehicleRow) => void;
};

// The showroom: one full-width page per registered vehicle, snapped by the native pager.
// No extra carousel package — a paging ScrollView with a scroll-driven scale gives the
// "next vehicle eases into the centre" read using only core Animated.
//
// Each page is a stage: the supplied showroom backdrop fills it, and the vehicle artwork sits
// on top inside a fixed, invisible frame. The frame is a layout container only — no panel, no
// border, no background of its own — so the backdrop stays visible through and around a
// transparent vehicle. The artwork itself comes from `showroomAssets`, the single place the
// temporary demo files are named; real per-vehicle photos replace that map without touching
// the carousel.
export default function VehicleShowroom({ vehicles, selectedId, onSelect }: Props) {
  const easy = usePrefs().uiMode === 'easy';
  const { width } = useWindowDimensions();
  const scrollX = useRef(new Animated.Value(0)).current;
  const listRef = useRef<ScrollView>(null);
  const selectedIndex = selectedVehicleIndex(vehicles, selectedId);

  // Programmatic jumps only when the page would actually change (first layout, or a selection
  // made elsewhere — e.g. the Garage screen). A swipe-driven selection already sits on its own
  // page, so this stays a no-op during normal paging and cannot fight the gesture.
  const jumpTo = useCallback(
    (index: number) => {
      listRef.current?.scrollTo({ x: index * width, animated: false });
      scrollX.setValue(index * width);
    },
    [width, scrollX],
  );

  useEffect(() => {
    jumpTo(selectedIndex);
    // `vehicles.length` and the selected index cover every reason the target page changes;
    // re-running mid-swipe is harmless because the effect lands on the settled page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex, vehicles.length, width]);

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const index = pageForOffset(e.nativeEvent.contentOffset.x, width, vehicles.length);
      const vehicle = vehicles[index];
      if (vehicle && vehicle.id !== selectedId) onSelect(vehicle);
    },
    [vehicles, width, selectedId, onSelect],
  );

  return (
    <View style={s.root}>
      <Animated.ScrollView
        ref={listRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: true },
        )}
        scrollEventThrottle={16}
        onMomentumScrollEnd={onMomentumEnd}
        // Every page is a full-width, self-contained stage: no nested tap targets compete with
        // the horizontal gesture, and the card below owns all the buttons.
        contentContainerStyle={vehicles.length === 1 ? s.singlePage : undefined}
        accessibilityLabel={`Vehicle showroom, ${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'}`}
      >
        {vehicles.map((vehicle, i) => (
          <VehiclePage
            key={vehicle.id}
            vehicle={vehicle}
            index={i}
            width={width}
            scrollX={scrollX}
            easy={easy}
          />
        ))}
      </Animated.ScrollView>

      <PageIndicator count={vehicles.length} activeIndex={selectedIndex} />
    </View>
  );
}

function VehiclePage({
  vehicle,
  index,
  width,
  scrollX,
  easy,
}: {
  vehicle: VehicleRow;
  index: number;
  width: number;
  scrollX: Animated.Value;
  easy: boolean;
}) {
  // Restrained focus pull: the centred vehicle sits at full size, neighbours ease down and
  // back — driven entirely by scroll position, so it tracks the finger with no extra state.
  const inputRange = [(index - 1) * width, index * width, (index + 1) * width];
  const scale = scrollX.interpolate({
    inputRange,
    outputRange: [0.92, 1, 0.92],
    extrapolate: 'clamp',
  });
  const opacity = scrollX.interpolate({
    inputRange,
    outputRange: [0.45, 1, 0.45],
    extrapolate: 'clamp',
  });

  const artwork = showroomVehicleImage(vehicle.vehicle_type);
  const caption = [vehicle.brand, vehicle.model].filter(Boolean).join(' ') || vehicleDisplayName(vehicle);

  return (
    <Animated.View
      style={[s.page, { width, transform: [{ scale }], opacity }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${vehicleDisplayName(vehicle)}, vehicle ${index + 1}`}
    >
      <GlassSurface>
        {/* The showroom backdrop. `cover` fills the stage without distorting the photo, and the
            wrapper never takes a touch, so the horizontal swipe is untouched. */}
        <View
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Image
            source={SHOWROOM_BACKGROUND}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
          />
        </View>
        <Scrim />

        <View style={s.stageInner}>
          {/* The vehicle frame: a fixed, invisible layout box every vehicle occupies. The
              artwork keeps its own aspect ratio (`contain`), so nothing is cropped, stretched
              or distorted, and the backdrop shows through its transparent parts. */}
          <View style={s.vehicleFrame}>
            {artwork ? (
              <Image
                source={artwork}
                style={s.vehicleImage}
                resizeMode="contain"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
            ) : (
              // No artwork for this type: the existing type glyph stands in, in the same frame
              // so the stage keeps its dimensions.
              <FontAwesome5
                name={vehicleTypeIcon(vehicle.vehicle_type) as never}
                size={easy ? 104 : 88}
                color={colors.text}
                solid
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
            )}
          </View>
        </View>
      </GlassSurface>
    </Animated.View>
  );
}

// The readability layer over the backdrop: one even wash plus a stepped ramp towards the
// caption, so the type below the vehicle always clears contrast against the photo. React
// Native has no gradient primitive, so the ramp is a short stack of translucent bands.
const SCRIM_BANDS = [0.34, 0.24, 0.15, 0.08] as const;

function Scrim() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden>
      <View style={s.scrimBase} />
      {SCRIM_BANDS.map((alpha, i) => (
        <View
          key={i}
          style={[s.scrimBand, { bottom: i * SCRIM_BAND_HEIGHT, backgroundColor: `rgba(5, 7, 13, ${alpha})` }]}
        />
      ))}
    </View>
  );
}

const SCRIM_BAND_HEIGHT = 20;

// iOS carousel indicator: quiet dots with the active position as a brighter electric-blue pill
// that slides between real pages. Count and position always come from the vehicle list.
function PageIndicator({ count, activeIndex }: { count: number; activeIndex: number }) {
  const pillX = useRef(new Animated.Value(activeIndex)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  // Same defensive probe the rest of the app uses: the flag is not on every RN type surface,
  // and an unavailable probe simply means "animation allowed".
  useEffect(() => {
    let alive = true;
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

  useEffect(() => {
    if (reduceMotion) {
      pillX.setValue(activeIndex);
      return;
    }
    Animated.timing(pillX, {
      toValue: activeIndex,
      duration: motion.base,
      useNativeDriver: false,
    }).start();
  }, [activeIndex, pillX, reduceMotion]);

  if (count <= 1) return null;

  const translateX = pillX.interpolate({
    inputRange: [0, Math.max(1, count - 1)],
    outputRange: [0, (count - 1) * DOT_PITCH],
    extrapolate: 'clamp',
  });

  return (
    <View
      style={s.indicator}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`Vehicle ${activeIndex + 1} of ${count}`}
      accessibilityValue={{ min: 1, max: count, now: activeIndex + 1 }}
    >
      <Animated.View style={[s.pill, { transform: [{ translateX }] }]} pointerEvents="none" />
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={[s.dot, i === activeIndex && s.dotHidden]} />
      ))}
    </View>
  );
}

// One dot's footprint in the row: 6dp dot + 5dp margin on each side.
const DOT_PITCH = 16;

// The vehicle frame's height. Every vehicle gets the same one, whatever the artwork's own
// aspect ratio, so the carousel pages stay the same size and the vehicle never changes scale
// from one page to the next.
const VEHICLE_FRAME_HEIGHT = 181;

const s = StyleSheet.create({
  root: { marginBottom: spacing.md },
  page: { paddingHorizontal: spacing.xs },
  singlePage: { paddingHorizontal: spacing.xs },
  // The stage sizes to its content: the inner block owns the padding, so the backdrop can fill
  // the card edge to edge behind the rounded corners the glass shell provides.
  stageInner: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxl,
  },
  vehicleFrame: {
    width: '100%',
    maxWidth: 1000,
    height: VEHICLE_FRAME_HEIGHT,
    // Breathing room so protruding parts — mirrors, bars, wheels — never touch the frame edge.
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleImage: {
    width: '150%',
    height: '150%',
    // `contain`, never `cover`: the vehicle keeps its own proportions and the showroom
    // backdrop stays visible through the transparent parts of the artwork.
    resizeMode: 'contain',
  },
  scrimBase: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0, 64, 255, 0)' },
  scrimBand: { position: 'absolute', left: 0, right: 0, height: SCRIM_BAND_HEIGHT },
  stageType: { ...typography.heading, fontSize: 16, textAlign: 'center', marginTop: spacing.sm },
  stagePlate: { ...typography.caption, textAlign: 'center', marginTop: spacing.xs, letterSpacing: 1.5 },
  indicator: {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    marginTop: spacing.md,
    height: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginHorizontal: 5,
    backgroundColor: colors.textMuted,
    opacity: 0.5,
  },
  // The active dot is hidden beneath the sliding pill; keeping it invisible (rather than
  // absent) means the pill never overlaps a second blue dot at the page boundary.
  dotHidden: { opacity: 0 },
  // Pill is 16dp over a 6dp dot: left 0 puts its centre on the dot centre (dot cell is 16dp
  // wide — 5 + 6 + 5 — so both centres land at 8dp inside cell i after translateX = i * 16).
  pill: {
    position: 'absolute',
    left: 0,
    width: 16,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primaryBright,
  },
});
