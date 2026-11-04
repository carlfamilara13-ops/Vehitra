
import React, { useEffect, useRef, useMemo } from 'react';
import { Linking, StyleSheet, View, Pressable } from 'react-native';
import type { BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  type NavigationContainerRef,
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
import VerificationScreen from '../features/settings/VerificationScreen';

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
  Verification: { token_hash: string } | { error: string; error_description: string };
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

type ParsedCallback =
  | { kind: 'token_hash'; token_hash: string }
  | { kind: 'error'; error: string; description: string };

/**
 * Parse a vehitra://login-callback deep link.
 *
 * Supabase delivers the callback parameters in the query string:
 *   vehitra://login-callback?token_hash=<hash>&type=signup
 *
 * Error cases (e.g. expired link tapped in browser) arrive as:
 *   vehitra://login-callback?error=access_denied&error_description=...
 *
 * Both query-string and fragment forms are checked so the parser is
 * resilient to any future Supabase redirect behaviour change.
 */
function parseCallbackUrl(url: string): ParsedCallback | null {
  try {
    const parsed = new URL(url);
    // Check query string first, then fragment (fragment is never sent by the
    // standard Supabase email template but guard against it anyway).
    const sources = [parsed.searchParams];
    if (parsed.hash) {
      try {
        sources.push(new URLSearchParams(parsed.hash.slice(1)));
      } catch { /* ignore malformed fragment */ }
    }
    for (const params of sources) {
      const error = params.get('error');
      if (error) {
        return {
          kind: 'error',
          error,
          description: params.get('error_description') ?? error,
        };
      }
      const tokenHash = params.get('token_hash');
      const type = params.get('type');
      if (tokenHash && type === 'signup') {
        return { kind: 'token_hash', token_hash: tokenHash };
      }
    }
  } catch { /* malformed URL — ignore */ }
  return null;
}

export default function RootNavigator() {
  const insets = useSafeAreaInsets();
  const { appearance } = usePrefs();
  const n = useNeu();
  const navRef = useRef<NavigationContainerRef<RootTabParamList>>(null);

  // Handle deep links that open the app from a closed state (cold start).
  // Also subscribe to links received while the app is already running (foreground).
  useEffect(() => {
    const navigate = (url: string) => {
      const result = parseCallbackUrl(url);
      if (!result) return;
      const tryNavigate = () => {
        if (navRef.current?.isReady()) {
          if (result.kind === 'token_hash') {
            navRef.current.navigate('Verification', { token_hash: result.token_hash });
          } else {
            navRef.current.navigate('Verification', {
              error: result.error,
              error_description: result.description,
            });
          }
        } else {
          setTimeout(tryNavigate, 50);
        }
      };
      tryNavigate();
    };

    // Cold start: app was not running when the link was tapped.
    void Linking.getInitialURL().then((url) => {
      if (url) navigate(url);
    });

    // Foreground: app was already open when the link was tapped.
    const subscription = Linking.addEventListener('url', ({ url }) => navigate(url));
    return () => subscription.remove();
  }, []);

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
    <NavigationContainer theme={navTheme} ref={navRef}>
      <Tab.Navigator
        screenOptions={{
          headerShown: false,

          tabBarActiveTintColor: n.c.accentText,
          tabBarInactiveTintColor: n.c.textMuted,

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

        <Tab.Screen
          name="Verification"
          component={VerificationScreen}
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
