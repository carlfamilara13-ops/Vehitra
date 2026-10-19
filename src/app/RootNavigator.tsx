import React from 'react';
import { DarkTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createBottomTabNavigator, type BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';
import DashboardScreen from '../features/dashboard/DashboardScreen';
import RecordScreen from '../features/rides/RecordScreen';
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
import { colors, typography } from '../ui/theme';

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

export default function RootNavigator() {
  return (
    <PrefsProvider>
      <NavigationContainer theme={navTheme}>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
          tabBarLabelStyle: { ...typography.caption, fontWeight: '600' },
          sceneStyle: { backgroundColor: colors.background },
        }}
      >
        <Tab.Screen name="Dashboard" component={DashboardScreen} />
        <Tab.Screen name="Rides" component={RidesScreen} />
        <Tab.Screen name="Record" component={RecordScreen} />
        <Tab.Screen name="Parts" component={PartsScreen} />
        <Tab.Screen name="Settings" component={SettingsScreen} />
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
