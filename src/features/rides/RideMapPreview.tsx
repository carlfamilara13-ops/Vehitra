import React, { useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  useColorScheme,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Camera, GeoJSONSource, Layer, Map } from '@maplibre/maplibre-react-native';
import type { Feature, FeatureCollection, LineString, Point, Position } from 'geojson';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, Path } from 'react-native-svg';
import type { LatLon } from '../../domain/ride/polyline';
import { projectRoute, type RouteSketch, type SketchedPoint } from '../../domain/ride/sketch';
import { colors, spacing, typography } from '../../ui/theme';

const OPENFREEMAP_STYLES = {
  dark: 'https://tiles.openfreemap.org/styles/dark',
  light: 'https://tiles.openfreemap.org/styles/liberty',
} as const;

type RouteKind = 'route' | 'start' | 'end';
type RouteFeature = Feature<LineString | Point, { kind: RouteKind }>;
type RouteData = {
  shape: FeatureCollection<LineString | Point, { kind: RouteKind }>;
  bounds: [number, number, number, number];
};

function makeRouteData(segments: readonly LatLon[][]): RouteData | null {
  const usable = segments
    .map((segment) => segment.filter((point) =>
      Number.isFinite(point.lat) && Number.isFinite(point.lon) &&
      Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180,
    ))
    .filter((segment) => segment.length > 1);
  if (usable.length === 0) return null;

  const coordinates: Position[] = usable.flatMap((segment) =>
    segment.map((point) => [point.lon, point.lat] as Position),
  );
  const lons = coordinates.map((point) => point[0] as number);
  const lats = coordinates.map((point) => point[1] as number);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const lonPad = Math.max((maxLon - minLon) * 0.16, 0.0012);
  const latPad = Math.max((maxLat - minLat) * 0.16, 0.0012);

  const features: RouteFeature[] = usable.map((segment) => ({
    type: 'Feature',
    properties: { kind: 'route' },
    geometry: {
      type: 'LineString',
      coordinates: segment.map((point) => [point.lon, point.lat] as Position),
    },
  }));
  const first = usable[0][0];
  const lastSegment = usable[usable.length - 1];
  const last = lastSegment[lastSegment.length - 1];
  features.push(
    {
      type: 'Feature',
      properties: { kind: 'start' },
      geometry: { type: 'Point', coordinates: [first.lon, first.lat] },
    },
    {
      type: 'Feature',
      properties: { kind: 'end' },
      geometry: { type: 'Point', coordinates: [last.lon, last.lat] },
    },
  );

  return {
    shape: { type: 'FeatureCollection', features },
    bounds: [minLon - lonPad, minLat - latPad, maxLon + lonPad, maxLat + latPad],
  };
}

function toPath(points: SketchedPoint[]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  return 'M ' + first.x.toFixed(1) + ' ' + first.y.toFixed(1) + ' ' +
    rest.map((p) => 'L ' + p.x.toFixed(1) + ' ' + p.y.toFixed(1)).join(' ');
}

export default function RideMapPreview({
  segments,
  containerStyle,
  emptyLabel = 'Route preview unavailable',
}: {
  segments: readonly LatLon[][];
  containerStyle?: StyleProp<ViewStyle>;
  emptyLabel?: string;
}) {
  const scheme = useColorScheme();
  // Let the OS appearance signal select a provider-maintained style. Default to Vehitra's dark
  // surface when the platform has no explicit appearance preference.
  const mapStyle = scheme === 'light' ? OPENFREEMAP_STYLES.light : OPENFREEMAP_STYLES.dark;
  const mapColors = scheme === 'light'
    ? { route: '#1459DB', start: '#087D59', end: '#C5284A', outline: '#F3F6FC', tint: '#18233D' }
    : { route: '#60EFFF', start: '#4DFFC4', end: '#FF7F98', outline: '#0A0A1A', tint: '#E9F1FF' };
  const route = useMemo(() => makeRouteData(segments), [segments]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) => current.width === width && current.height === height ? current : { width, height });
  };

  const sketch: RouteSketch | null = useMemo(() => {
    if (!route || size.width <= 0 || size.height <= 0) return null;
    return projectRoute(segments, { width: size.width, height: size.height, padding: 12 });
  }, [route, segments, size]);

  if (!route) {
    return (
      <View style={[styles.empty, containerStyle]}>
        <Ionicons name="map-outline" size={20} color={colors.textMuted} />
        <Text style={styles.emptyText}>{emptyLabel}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, containerStyle]} onLayout={onLayout}>
      <Map
        key={mapStyle}
        style={StyleSheet.absoluteFill}
        mapStyle={mapStyle}
        attribution
        attributionPosition={{ bottom: 4, right: 4 }}
        tintColor={mapColors.tint}
        logo
        logoPosition={{ bottom: 4, left: 4 }}
        compass={false}
        dragPan={false}
        touchZoom={false}
        doubleTapZoom={false}
        touchRotate={false}
        touchPitch={false}
        pointerEvents="none"
        onWillStartLoadingMap={() => { setMapReady(false); setMapFailed(false); }}
        onDidFinishLoadingMap={() => { setMapReady(true); setMapFailed(false); }}
        onDidFailLoadingMap={() => { setMapReady(false); setMapFailed(true); }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Camera
          initialViewState={{
            bounds: route.bounds,
            padding: { top: 18, right: 18, bottom: 18, left: 18 },
          }}
        />
        <GeoJSONSource id="ride-route-preview" data={route.shape}>
          <Layer
            type="line"
            id="ride-route-line"
            filter={['==', ['get', 'kind'], 'route']}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            paint={{
              'line-color': mapColors.route,
              'line-width': 3.5,
              'line-opacity': 0.96,
            }}
          />
          <Layer
            type="circle"
            id="ride-route-start"
            filter={['==', ['get', 'kind'], 'start']}
            paint={{
              'circle-radius': 4,
              'circle-color': mapColors.start,
              'circle-stroke-color': mapColors.outline,
              'circle-stroke-width': 1.5,
            }}
          />
          <Layer
            type="circle"
            id="ride-route-end"
            filter={['==', ['get', 'kind'], 'end']}
            paint={{
              'circle-radius': 4,
              'circle-color': mapColors.end,
              'circle-stroke-color': mapColors.outline,
              'circle-stroke-width': 1.5,
            }}
          />
        </GeoJSONSource>
      </Map>

      {!mapReady && sketch && !sketch.isEmpty && size.width > 0 && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Svg width={size.width} height={size.height}>
            {sketch.segments.map((segment, index) => (
              <Path
                key={index}
                d={toPath(segment)}
                stroke={colors.primaryBright}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ))}
            <Circle cx={sketch.segments[0][0].x} cy={sketch.segments[0][0].y} r={3.5} fill={colors.success} />
            <Circle
              cx={sketch.segments[sketch.segments.length - 1].slice(-1)[0].x}
              cy={sketch.segments[sketch.segments.length - 1].slice(-1)[0].y}
              r={3.5}
              fill={colors.danger}
            />
          </Svg>
          <Text style={styles.note}>
            {mapFailed ? 'Offline map · route shape only' : 'Loading map…'}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, width: '100%', overflow: 'hidden', backgroundColor: colors.surface },
  empty: {
    minHeight: 64,
    width: '100%',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  emptyText: { ...typography.caption, textAlign: 'center' },
  note: {
    position: 'absolute',
    bottom: spacing.xs,
    left: spacing.sm,
    color: colors.text,
    backgroundColor: 'rgba(10, 10, 26, 0.72)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    fontSize: 10,
  },
});
