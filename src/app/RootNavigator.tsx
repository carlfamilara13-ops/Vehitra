import React from 'react';
import { StyleSheet, View } from 'react-native';
import { DarkTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createBottomTabNavigator, type BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DashboardScreen from '../features/dashboard/DashboardScreen';
import RecordScreen from '../features/record/RecordScreen';
import RidesScreen from '../features/rides/RidesScreen';
import PartsScreen from '../features/parts/PartsScreen';
import SettingsScreen from '../features/settings/SettingsScreen';
import DiagnosticsScreen from '../features/settings/DiagnosticsScreen';
import GarageScreen from '../features/garage/GarageScreen';
import VehicleFormScreen from '../features/garage/VehicleFormScreen';
import VehicleLibraryScreen from '../features/garage/VehicleLibraryScreen';
import RideDetailScreen from '../features/rides/RideDetailScreen';
import EquipmentScreen from '../features/garage/EquipmentScreen';
import DeadlinesScreen from '../features/deadlines/DeadlinesScreen';
import AccountScreen from '../features/settings/AccountScreen';
import { PrefsProvider } from './prefs';
import { colors } from '../ui/theme';
import GlassTabBarBackground from '../ui/GlassTabBarBackground';
import {
  TAB_BAR_BOTTOM_GAP,
  TAB_BAR_HEIGHT,
  TAB_BAR_RADIUS,
  TAB_BAR_SIDE_INSET,
} from '../ui/tabBarLayout';

export type RootTabParamList = {
  Dashboard: undefined;
  Record: undefined;
  Rides: undefined;
  Parts: undefined;
  Settings: undefined;
  // Reachable from Dashboard/Settings; its tab button is hidden.
  Diagnostics: undefined;
  Garage: undefined;
  // Vehicle library (type → brand → model). The add flow starts here.
  VehicleLibrary: undefined;
  // Reachable from the Garage/library; `id` is omitted when adding. The catalog fields prefill
  // the form when the vehicle was chosen through the library.
  VehicleForm:
    | {
        id?: string;
        catalogModelSlug?: string;
        presetType?: string;
        presetBrand?: string;
        presetModel?: string;
      }
        | undefined;
  // Ride detail (stats, route sketch, speed dial). Opened from the Rides list.
  RideDetail: { id: string } | undefined;
  // Per-vehicle equipment (accessories + battery check-in). Opened from Garage; `vehicleId`
  // falls back to the active vehicle when omitted.
  Equipment: { vehicleId?: string } | undefined;
  // Expiry/renewal reminders (registration, licence, insurance, inspection, custom).
  Deadlines: undefined;
  // Email sign-in + manual "Sync now" (v1 cloud sync scope).
  Account: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

// Hidden routes are still real tabs. `tabBarButton: null` only empties their content; the item
// wrapper keeps `flex: 1`, so each hidden tab still reserves an equal slot in the bar and pushes
// the visible tabs to the left. `display: 'none'` takes the slot out of the layout entirely.
const hiddenTabOptions: BottomTabNavigationOptions = {
  tabBarButton: () => null,
  tabBarItemStyle: { display: 'none' },
};

const navTheme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    notification: colors.primary,
  },
};

// The five destinations the bar actually shows. Record sits in the middle and is the app's one
// primary action; the other four are equal-weight destinations.
type VisibleTab = 'Dashboard' | 'Rides' | 'Record' | 'Parts' | 'Settings';

// Filled glyphs for the focused tab, outlines for the rest. Both are rendered and cross-faded
// by the navigator, so the swap reads as a transition rather than a jump.
const TAB_ICONS: Record<
  VisibleTab,
  { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap }
> = {
  Dashboard: { active: 'speedometer', inactive: 'speedometer-outline' },
  Rides: { active: 'list', inactive: 'list-outline' },
  Record: { active: 'ellipse', inactive: 'ellipse' },
  Parts: { active: 'build', inactive: 'build-outline' },
  Settings: { active: 'settings', inactive: 'settings-outline' },
};

// The bar is capped at a fixed height by the navigator (49dp by default) instead of being sized
// to its contents, so anything larger than a plain glyph needs an explicit height. This is the
// icon block plus its label plus padding; the safe-area inset goes on top because a custom
// height replaces the navigator's own inset arithmetic rather than extending it.
const TAB_BAR_CONTENT_HEIGHT = 56;

// Record is the primary action, so it gets a filled button rather than a line glyph. Focus reads
// as a fill change (tinted → solid) as well as a colour change, so the active state does not
// depend on hue alone. It keeps its visible label, which is what the screen reader reads.
function RecordButton({ focused }: { focused: boolean }) {
  return (
    <View style={[s.record, focused ? s.recordOn : s.recordOff]}>
      <Ionicons name="ellipse" size={11} color={focused ? '#FFFFFF' : colors.primaryBright} />
    </View>
  );
}

const tabBarIcon =
  (name: VisibleTab): BottomTabNavigationOptions['tabBarIcon'] =>
  ({ focused, color, size }) =>
    name === 'Record' ? (
      <RecordButton focused={focused} />
    ) : (
      <Ionicons
        name={focused ? TAB_ICONS[name].active : TAB_ICONS[name].inactive}
        size={size}
        color={color}
      />
    );

export default function RootNavigator() {
  const insets = useSafeAreaInsets();

  return (
    <PrefsProvider>
      <NavigationContainer theme={navTheme}>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primaryBright,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: {
            position: 'absolute',
            height: TAB_BAR_CONTENT_HEIGHT,
            bottom: insets.bottom + TAB_BAR_BOTTOM_GAP,
            left: TAB_BAR_SIDE_INSET,
            right: TAB_BAR_SIDE_INSET,
            backgroundColor: 'transparent',
            borderTopWidth: 0,
            borderWidth: 0,
            elevation: 0,
            shadowColor: 'transparent',
            shadowOpacity: 0,
            shadowOffset: { width: 0, height: 0 },
            shadowRadius: 0,
          },
          tabBarBackground: () => <GlassTabBarBackground />,
          // Centres each icon/label pair in the bar. It must not carry a `color`: a colour set
          // here is applied after the active and inactive tints, so it would pin every label to
          // one shade and quietly disable both tints.
          tabBarItemStyle: { justifyContent: 'center' },
          tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
          sceneStyle: { backgroundColor: colors.background },
        }}
      >
        <Tab.Screen
          name="Dashboard"
          component={DashboardScreen}
          options={{ tabBarIcon: tabBarIcon('Dashboard') }}
        />
        <Tab.Screen
          name="Rides"
          component={RidesScreen}
          options={{ tabBarIcon: tabBarIcon('Rides') }}
        />
        <Tab.Screen
          name="Record"
          component={RecordScreen}
          options={{ tabBarIcon: tabBarIcon('Record') }}
        />
        <Tab.Screen
          name="Parts"
          component={PartsScreen}
          options={{ tabBarIcon: tabBarIcon('Parts') }}
        />
        <Tab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ tabBarIcon: tabBarIcon('Settings') }}
        />
        <Tab.Screen name="Diagnostics" component={DiagnosticsScreen} options={hiddenTabOptions} />
        <Tab.Screen name="Garage" component={GarageScreen} options={hiddenTabOptions} />
        <Tab.Screen name="VehicleLibrary" component={VehicleLibraryScreen} options={hiddenTabOptions} />
        <Tab.Screen name="VehicleForm" component={VehicleFormScreen} options={hiddenTabOptions} />
        <Tab.Screen name="RideDetail" component={RideDetailScreen} options={hiddenTabOptions} />
        <Tab.Screen name="Equipment" component={EquipmentScreen} options={hiddenTabOptions} />
        <Tab.Screen name="Deadlines" component={DeadlinesScreen} options={hiddenTabOptions} />
        <Tab.Screen name="Account" component={AccountScreen} options={hiddenTabOptions} />
      </Tab.Navigator>
      </NavigationContainer>
    </PrefsProvider>
  );
}

const s = StyleSheet.create({
  record: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordOn: { backgroundColor: colors.primary },
  recordOff: {
    backgroundColor: colors.primaryTint,
    borderColor: colors.primary,
    borderWidth: 1,
  },
});
