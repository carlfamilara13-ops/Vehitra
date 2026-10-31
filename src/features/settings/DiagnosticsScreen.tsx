import React from 'react';
import { StyleSheet } from 'react-native';
import { TouchableOpacity, View } from '../../ui/neu/NeuAuto';
import { Text } from '../../ui/neu/NeuText';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import RideDebugScreen from '../rides/RideDebugScreen';
import { colors, radii, spacing, typography } from '../../ui/theme';
import type { RootTabParamList } from '../../app/RootNavigator';

type Props = BottomTabScreenProps<RootTabParamList, 'Diagnostics'>;

// Wraps the existing developer ride screen behind a header. The top inset is
// handled by this header, so the wrapped screen's own safe area is zeroed to
// avoid double padding. The GPS engine itself is untouched.
export default function DiagnosticsScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={s.root}>
      <View style={[s.bar, { paddingTop: insets.top + spacing.sm }]}>
        <TouchableOpacity
          style={s.back}
          onPress={() => navigation.navigate('Settings')}
          accessibilityRole="button"
          accessibilityLabel="Back to settings"
        >
          <Text style={s.backTxt}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={s.title}>Ride diagnostics</Text>
        <View style={s.spacer} />
      </View>
      <SafeAreaInsetsContext.Provider value={{ ...insets, top: 0 }}>
        <RideDebugScreen />
      </SafeAreaInsetsContext.Provider>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: {
    paddingVertical: spacing.xs,
    paddingRight: spacing.md,
    borderRadius: radii.sm,
    minWidth: 64,
  },
  backTxt: { ...typography.body, color: colors.primary, fontWeight: '600' },
  title: { ...typography.label, flex: 1, textAlign: 'center' },
  spacer: { minWidth: 64 },
});
