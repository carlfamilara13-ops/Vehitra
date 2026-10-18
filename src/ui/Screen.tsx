import React from 'react';
import { ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing, typography } from './theme';

type Props = {
  title: string;
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
  const inner = (
    <>
      <View style={s.header}>
        <View style={s.headerText}>
          <Text style={typography.title}>{title}</Text>
          {!!subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
        </View>
        {right}
      </View>
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
});
