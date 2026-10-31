import React, { useMemo } from 'react';
<<<<<<< HEAD
import { StyleSheet, View } from 'react-native';
=======
import { StyleSheet, View, useColorScheme } from 'react-native';
>>>>>>> 085d579c1634fc5cd9a597346cae31cf95b819b5
import { DarkTheme, DefaultTheme, NavigationContainer, type Theme } from '@react-navigation/native';
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
import NeuTabBarBackground from '../ui/neu/NeuTabBarBackground';
import { useNeu } from '../ui/neu/useNeu';
import { usePrefs } from './prefs';
import AccentGradient from '../ui/neu/AccentGradient';
import {
  TAB_BAR_BOTTOM_GAP,
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

// A compact floating icon dock with a 48dp interaction target for each destination.
const TAB_BAR_CONTENT_HEIGHT = 56;

// Record is the primary action, so it gets a filled button rather than a line glyph. Focus reads
// as a fill change (tinted → solid) as well as a colour change, so the active state does not
// depend on hue alone. It keeps its visible label, which is what the screen reader reads.
function RecordButton({ focused }: { focused: boolean }) {
  const n = useNeu();
  // Raised accent circle (the reference's accent button role). Focus adds a dark ring glyph
  // change (filled vs outlined) so state does not rely on colour alone.
  return (
    <View style={[s.record, n.surface('raisedSubtle'), { backgroundColor: n.c.accent }]}>
      <Ionicons name={focused ? 'radio-button-on' : 'radio-button-off'} size={18} color={n.c.onAccent} />
    </View>
  );
}

function TabGlyph({ name, focused, color, size }: { name: VisibleTab; focused: boolean; color: string; size: number }) {
  const n = useNeu();
  const icon = focused ? TAB_ICONS[name as Exclude<VisibleTab, 'Record'>].active : TAB_ICONS[name as Exclude<VisibleTab, 'Record'>].inactive;
  // Active tab sits in an inset dish with an accent glyph; inactive tabs are plain.
  return focused ? (
    <View style={[s.dish, s.activeDish, { backgroundColor: 'transparent' }]}>
      <AccentGradient radius={16} />
      <Ionicons name={icon} size={size} color={n.c.onAccent} />
    </View>
  ) : (
    <View style={s.dish}>
      <Ionicons name={icon} size={size} color={color} />
    </View>
  );
}

const tabBarIcon =
  (name: VisibleTab): BottomTabNavigationOptions['tabBarIcon'] =>
  ({ focused, color, size }) =>
    name === 'Record' ? <RecordButton focused={focused} /> : <TabGlyph name={name} focused={focused} color={color as string} size={size} />;

export default function RootNavigator() {
  const insets = useSafeAreaInsets();
<<<<<<< HEAD
  const { appearance } = usePrefs();
  const n = useNeu();
  const baseNavigationTheme = appearance === 'light' ? DefaultTheme : DarkTheme;
=======
  const colorScheme = useColorScheme();
  const baseNavigationTheme = colorScheme === 'light' ? DefaultTheme : DarkTheme;
>>>>>>> 085d579c1634fc5cd9a597346cae31cf95b819b5
  const navTheme = useMemo<Theme>(() => ({
    ...baseNavigationTheme,
    colors: {
      ...baseNavigationTheme.colors,
<<<<<<< HEAD
      primary: n.c.accent,
      background: n.c.bg,
      card: n.c.surface,
      text: n.c.text,
      border: n.c.shadowDark,
      notification: n.c.accent,
    },
  }), [baseNavigationTheme, n]);
=======
      primary: colorScheme === 'light' ? '#1E6BFF' : '#1E6BFF',
      background: colorScheme === 'light' ? '#F3F6FC' : '#0A0A1A',
      card: colorScheme === 'light' ? '#FFFFFF' : '#11152A',
      text: colorScheme === 'light' ? '#18233D' : '#E9F1FF',
      border: colorScheme === 'light' ? '#D7DFEE' : '#252C4A',
      notification: colorScheme === 'light' ? '#1E6BFF' : '#1E6BFF',
    },
  }), [baseNavigationTheme, colorScheme]);
>>>>>>> 085d579c1634fc5cd9a597346cae31cf95b819b5

  return (
      <NavigationContainer theme={navTheme}>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
<<<<<<< HEAD
          tabBarActiveTintColor: n.c.accentText,
          tabBarInactiveTintColor: n.c.textMuted,
=======
          tabBarActiveTintColor: colorScheme === 'light' ? '#1459DB' : '#60EFFF',
          tabBarInactiveTintColor: colorScheme === 'light' ? '#596983' : '#93A0BF',
>>>>>>> 085d579c1634fc5cd9a597346cae31cf95b819b5
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
          tabBarShowLabel: false,
          tabBarBackground: () => <NeuTabBarBackground />,
          // Icon-only navigation keeps the bottom dock quiet and leaves screen readers with
          // the tab names supplied by the navigator.
          tabBarItemStyle: { justifyContent: 'center' },
          sceneStyle: { backgroundColor: n.c.bg },
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
  );
}

const s = StyleSheet.create({
  record: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dish: { width: 40, height: 32, alignItems: 'center', justifyContent: 'center' },
  activeDish: { borderRadius: 16 },
});
