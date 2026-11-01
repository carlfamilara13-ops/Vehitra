
import React, { useMemo } from 'react';
import { StyleSheet, View, Pressable } from 'react-native';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  type Theme,
} from '@react-navigation/native';
import {
  createBottomTabNavigator,
  type BottomTabNavigationOptions,
} from '@react-navigation/bottom-tabs';
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

import {
  TabIcon,
  RecordRiderIcon,
} from '../ui/neu/TabBarIcons';

import { TAB_BAR_CONFIG } from '../ui/tabBarLayout';

export type RootTabParamList = {
  Dashboard: undefined;
  Record: undefined;
  Rides: undefined;
  Parts: undefined;
  Settings: undefined;

  Diagnostics: undefined;
  Garage: undefined;
  VehicleLibrary: undefined;

  VehicleForm:
    | {
        id?: string;
        catalogModelSlug?: string;
        presetType?: string;
        presetBrand?: string;
        presetModel?: string;
      }
    | undefined;

  RideDetail: { id: string } | undefined;
  Equipment: { vehicleId?: string } | undefined;
  Deadlines: undefined;
  Account: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

const hiddenTabOptions: BottomTabNavigationOptions = {
  tabBarButton: () => null,
  tabBarItemStyle: { display: 'none' },
};

type VisibleTab =
  | 'Dashboard'
  | 'Rides'
  | 'Record'
  | 'Parts'
  | 'Settings';

function RecordButton() {
  const n = useNeu();

  return (
    <View
      style={[
        s.record,
        n.surface('raisedSubtle'),
        {
          width: TAB_BAR_CONFIG.recordButtonSize,
          height: TAB_BAR_CONFIG.recordButtonSize,
          borderRadius: TAB_BAR_CONFIG.recordButtonSize / 2,
          backgroundColor: n.c.accent,
          transform: [
            { translateY: TAB_BAR_CONFIG.recordButtonOffset },
          ],
        },
      ]}
    >
      <RecordRiderIcon size={30} />
    </View>
  );
}

function TabGlyph({
  name,
  focused,
}: {
  name: Exclude<VisibleTab, 'Record'>;
  focused: boolean;
}) {
  return (
    <View
      style={[
        s.dish,
        {
          width: TAB_BAR_CONFIG.iconContainerWidth,
          height: TAB_BAR_CONFIG.iconContainerHeight,
          transform: [
            { translateY: TAB_BAR_CONFIG.iconTranslateY },
          ],
        },
      ]}
    >
      <TabIcon
        name={name}
        focused={focused}
        size={TAB_BAR_CONFIG.iconSize}
      />
    </View>
  );
}

const tabBarIcon =
  (name: VisibleTab): BottomTabNavigationOptions['tabBarIcon'] =>
  ({ focused }) =>
    name === 'Record' ? (
      <RecordButton />
    ) : (
      <TabGlyph name={name} focused={focused} />
    );

function CustomTabButton({
  children,
  onPress,
  onLongPress,
  accessibilityState,
  accessibilityLabel,
  testID,
  style,
}: BottomTabBarButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityState={accessibilityState}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={style}
      android_ripple={{ color: 'transparent' }}
    >
      {children}
    </Pressable>
  );
}

export default function RootNavigator() {
  const insets = useSafeAreaInsets();
  const { appearance } = usePrefs();
  const n = useNeu();

  const baseNavigationTheme =
    appearance === 'light' ? DefaultTheme : DarkTheme;

  const navTheme = useMemo<Theme>(
    () => ({
      ...baseNavigationTheme,
      colors: {
        ...baseNavigationTheme.colors,
        primary: n.c.accent,
        background: n.c.bg,
        card: n.c.surface,
        text: n.c.text,
        border: n.c.shadowDark,
        notification: n.c.accent,
      },
    }),
    [baseNavigationTheme, n]
  );

  return (
    <NavigationContainer theme={navTheme}>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,

          tabBarActiveTintColor: n.c.accentText,
          tabBarInactiveTintColor: n.c.textMuted,

          tabBarPressColor: 'transparent',
          tabBarPressOpacity: 1,

          tabBarButton: (props) => <CustomTabButton {...props} />,

          tabBarStyle: {
            position: 'absolute',
            height: TAB_BAR_CONFIG.height,
            bottom: insets.bottom + TAB_BAR_CONFIG.bottomOffset,

            // React Navigation's base style uses start/end, so use the same
            // logical edges here to override its full-width positioning.
            start: TAB_BAR_CONFIG.horizontalInset,
            end: TAB_BAR_CONFIG.horizontalInset,

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

          tabBarItemStyle: {
            justifyContent: 'center',
            alignItems: 'center',
          },

          sceneStyle: {
            backgroundColor: n.c.bg,
          },
        }}
      >
        <Tab.Screen
          name="Dashboard"
          component={DashboardScreen}
          options={{
            tabBarIcon: tabBarIcon('Dashboard'),
          }}
        />

        <Tab.Screen
          name="Rides"
          component={RidesScreen}
          options={{
            tabBarIcon: tabBarIcon('Rides'),
          }}
        />

        <Tab.Screen
          name="Record"
          component={RecordScreen}
          options={{
            tabBarIcon: tabBarIcon('Record'),
          }}
        />

        <Tab.Screen
          name="Parts"
          component={PartsScreen}
          options={{
            tabBarIcon: tabBarIcon('Parts'),
          }}
        />

        <Tab.Screen
          name="Settings"
          component={SettingsScreen}
          options={{
            tabBarIcon: tabBarIcon('Settings'),
          }}
        />

        {/* Hidden navigation screens */}
        <Tab.Screen
          name="Diagnostics"
          component={DiagnosticsScreen}
          options={hiddenTabOptions}
        />

        <Tab.Screen
          name="Garage"
          component={GarageScreen}
          options={hiddenTabOptions}
        />

        <Tab.Screen
          name="VehicleLibrary"
          component={VehicleLibraryScreen}
          options={hiddenTabOptions}
        />

        <Tab.Screen
          name="VehicleForm"
          component={VehicleFormScreen}
          options={hiddenTabOptions}
        />

        <Tab.Screen
          name="RideDetail"
          component={RideDetailScreen}
          options={hiddenTabOptions}
        />

        <Tab.Screen
          name="Equipment"
          component={EquipmentScreen}
          options={hiddenTabOptions}
        />

        <Tab.Screen
          name="Deadlines"
          component={DeadlinesScreen}
          options={hiddenTabOptions}
        />

        <Tab.Screen
          name="Account"
          component={AccountScreen}
          options={hiddenTabOptions}
        />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

const s = StyleSheet.create({
  record: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  dish: {
    width: TAB_BAR_CONFIG.iconContainerWidth,
    height: TAB_BAR_CONFIG.iconContainerHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
