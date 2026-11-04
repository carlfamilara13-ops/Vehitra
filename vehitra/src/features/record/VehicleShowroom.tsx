
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';

import type { VehicleRow } from '../../data/local/vehicleStore';
import { vehicleDisplayName } from '../../data/local/vehicleStore';
import { colors, spacing } from '../../ui/theme';
import { selectedVehicleIndex, vehicleTypeIcon } from './garageView';
import { showroomVehicleImage } from './showroomAssets';
import { usePrefs } from '../../app/prefs';
import { getDb } from '../../data/local/db';
import { getCatalogModelImage } from '../../data/local/catalogStore';

type Props = {
  vehicles: readonly VehicleRow[];
  selectedId: string | null;
  onSelect: (vehicle: VehicleRow) => void;
  onPressVehicle: () => void;
};

const SIDE_SCALE = 0.70;
const SIDE_OPACITY = 0.42;
const SIDE_BLUR = 18;

const VEHICLE_FRAME_HEIGHT = 235;

export default function VehicleShowroom({
  vehicles,
  selectedId,
  onSelect,
  onPressVehicle,
}: Props) {
  const easy = usePrefs().uiMode === 'easy';

  const [containerWidth, setContainerWidth] = useState(0);
  const [catalogImages, setCatalogImages] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;

    void (async () => {
      try {
        const db = await getDb();

        const entries = await Promise.all(
          vehicles.map(async (vehicle) => {
            if (!vehicle.catalog_model_slug) {
              return [vehicle.id, null] as const;
            }

            const image = await getCatalogModelImage(
              db,
              vehicle.catalog_model_slug,
            );

            return [vehicle.id, image.localUri] as const;
          }),
        );

        if (live) {
          setCatalogImages(
            Object.fromEntries(
              entries.filter(
                (entry): entry is readonly [string, string] =>
                  Boolean(entry[1]),
              ),
            ),
          );
        }
      } catch {
        if (live) setCatalogImages({});
      }
    })();

    return () => {
      live = false;
    };
  }, [vehicles]);

  const itemWidth = containerWidth * 0.78;

  const scrollX = useRef(new Animated.Value(0)).current;
  const listRef = useRef<ScrollView>(null);

  const selectedIndex = selectedVehicleIndex(vehicles, selectedId);
  const hasMultiple = vehicles.length > 1;

  const loopVehicles = useMemo(
    () => (hasMultiple ? [...vehicles, ...vehicles, ...vehicles] : [...vehicles]),
    [vehicles, hasMultiple],
  );

  const middleIndex = hasMultiple
    ? vehicles.length + selectedIndex
    : 0;

  const jumpTo = useCallback(
    (index: number) => {
      if (containerWidth <= 0 || itemWidth <= 0) return;

      const offset = index * itemWidth;

      listRef.current?.scrollTo({
        x: offset,
        animated: false,
      });

      scrollX.setValue(offset);
    },
    [containerWidth, itemWidth, scrollX],
  );

  useEffect(() => {
    if (!vehicles.length || containerWidth <= 0) return;

    jumpTo(middleIndex);
  }, [
    middleIndex,
    vehicles.length,
    containerWidth,
    jumpTo,
  ]);

  const handleMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!hasMultiple || itemWidth <= 0) return;

      const offset = event.nativeEvent.contentOffset.x;
      const virtualIndex = Math.round(offset / itemWidth);

      const realIndex =
        ((virtualIndex % vehicles.length) + vehicles.length) %
        vehicles.length;

      const vehicle = vehicles[realIndex];

      if (vehicle && vehicle.id !== selectedId) {
        onSelect(vehicle);
      }

      const centeredIndex = vehicles.length + realIndex;
      const centeredOffset = centeredIndex * itemWidth;

      requestAnimationFrame(() => {
        listRef.current?.scrollTo({
          x: centeredOffset,
          animated: false,
        });

        scrollX.setValue(centeredOffset);
      });
    },
    [
      hasMultiple,
      itemWidth,
      vehicles,
      selectedId,
      onSelect,
      scrollX,
    ],
  );

  const handleScroll = Animated.event(
    [{ nativeEvent: { contentOffset: { x: scrollX } } }],
    { useNativeDriver: true },
  );

  return (
    <View
      style={styles.root}
      onLayout={(event) => {
        const measuredWidth = event.nativeEvent.layout.width;

        setContainerWidth((currentWidth) =>
          currentWidth === measuredWidth
            ? currentWidth
            : measuredWidth,
        );
      }}
    >
      {vehicles.length > 0 && containerWidth > 0 && (
        <Animated.ScrollView
          ref={listRef}
          horizontal
          scrollEnabled={hasMultiple}
          showsHorizontalScrollIndicator={false}
          snapToInterval={itemWidth}
          snapToAlignment="start"
          decelerationRate="fast"
          bounces={false}
          disableIntervalMomentum
          contentContainerStyle={{
            paddingHorizontal: (containerWidth - itemWidth) / 2,
          }}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          onMomentumScrollEnd={handleMomentumEnd}
          accessibilityLabel={`Vehicle showroom, ${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'}`}
        >
          {loopVehicles.map((vehicle, index) => (
            <VehicleItem
              key={`${vehicle.id}-${index}`}
              vehicle={vehicle}
              index={index}
              itemWidth={itemWidth}
              scrollX={scrollX}
              easy={easy}
              catalogImageUri={catalogImages[vehicle.id] ?? null}
              isCenter={index === middleIndex}
              onPress={onPressVehicle}
            />
          ))}
        </Animated.ScrollView>
      )}
    </View>
  );
}

function VehicleItem({
  vehicle,
  index,
  itemWidth,
  scrollX,
  easy,
  catalogImageUri,
  isCenter,
  onPress,
}: {
  vehicle: VehicleRow;
  index: number;
  itemWidth: number;
  scrollX: Animated.Value;
  easy: boolean;
  catalogImageUri: string | null;
  isCenter: boolean;
  onPress: () => void;
}) {
  const inputRange = [
    (index - 1) * itemWidth,
    index * itemWidth,
    (index + 1) * itemWidth,
  ];

  const scale = scrollX.interpolate({
    inputRange,
    outputRange: [SIDE_SCALE, 1, SIDE_SCALE],
    extrapolate: 'clamp',
  });

  const opacity = scrollX.interpolate({
    inputRange,
    outputRange: [SIDE_OPACITY, 1, SIDE_OPACITY],
    extrapolate: 'clamp',
  });

  const artwork = showroomVehicleImage(vehicle.vehicle_type);

  const content = (
    <Animated.View
      style={[
        styles.vehicleItem,
        {
          width: itemWidth,
          opacity,
          transform: [{ scale }],
        },
      ]}
    >
      <View style={styles.vehicleFrame}>
        {catalogImageUri ? (
          <Image
            source={{ uri: catalogImageUri }}
            style={styles.catalogVehicleImage}
            resizeMode="contain"
          />
        ) : artwork ? (
          <Image
            source={artwork}
            style={styles.vehicleImage}
            resizeMode="contain"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        ) : (
          <FontAwesome5
            name={vehicleTypeIcon(vehicle.vehicle_type) as never}
            size={easy ? 104 : 88}
            color={colors.text}
            solid
          />
        )}
      </View>
    </Animated.View>
  );

  return (
    <View style={{ width: itemWidth }}>
      {isCenter ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={`Open garage for ${vehicleDisplayName(vehicle)}`}
        >
          {content}
        </Pressable>
      ) : (
        <View pointerEvents="none">
          {content}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: '100%',
    marginBottom: spacing.md,
    overflow: 'visible',
  },

  vehicleItem: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  vehicleFrame: {
    width: '100%',
    height: VEHICLE_FRAME_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
  },

  // Uploaded catalog images fit inside the existing showroom frame.
  catalogVehicleImage: {
    width: '120%',
    height: '120%',
  },

  // Existing built-in artwork keeps its original sizing.
  vehicleImage: {
    width: '175%',
    height: '175%',
  },
});
