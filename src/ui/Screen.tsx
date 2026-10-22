import React from 'react';
import { ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, typography } from './theme';
import { usePrefs } from '../app/prefs';

type Props = {
  /** Optional: a screen that draws its own header (the Dashboard wordmark) passes no title. */
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  scroll?: boolean;
  children?: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  // Taps on controls inside the scroll view. Defaults to the React Native default ('never'); a
  // screen with inline forms passes 'handled' so buttons work while the keyboard is open.
  keyboardShouldPersistTaps?: 'never' | 'always' | 'handled';
};

// Common screen frame: safe-area aware, dark background and a consistent header.
export default function Screen({ title, subtitle, right, scroll = true, children, contentStyle, keyboardShouldPersistTaps }: Props) {
  // Easy mode enlarges the shared frame text on every screen (the Dashboard adds its own
  // metric sizing on top). Read from prefs here so no screen has to remember to opt in.
  const easy = usePrefs().uiMode === 'easy';
  const inner = (
    <>
      {!!(title || right) && (
        <View style={s.header}>
          <View style={s.headerText}>
            {!!title && <Text style={[typography.title, easy && s.easyTitle]}>{title}</Text>}
            {!!subtitle && <Text style={[s.subtitle, easy && s.easySubtitle]}>{subtitle}</Text>}
          </View>
          {right}
        </View>
      )}
      {children}
    </>
  );

  return (
    <SafeAreaView style={s.root} edges={['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={[s.content, contentStyle]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        >
          {inner}
        </ScrollView>
      ) : (
        <View style={[s.content, s.flex, contentStyle]}>{inner}</View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  headerText: { flex: 1 },
  subtitle: { ...typography.caption, marginTop: spacing.xs },
  easyTitle: { fontSize: 28 },
  easySubtitle: { fontSize: 14 },
});
