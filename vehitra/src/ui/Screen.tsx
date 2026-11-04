import React from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type ImageStyle,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Text } from './neu/NeuText';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, typography } from './theme';
import { usePrefs } from '../app/prefs';
import { useNeu } from './neu/useNeu';
import { tabBarBottomClearance } from './tabBarLayout';
import { KeyboardScrollContext, useKeyboardScroll } from './keyboardScroll';

type Props = {
  /** Optional: a screen that draws its own header (the Dashboard wordmark) passes no title. */
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  scroll?: boolean;
  /** Adds enough scrollable space to clear the floating bottom tab bar. */
  avoidTabBar?: boolean;
  /** Adjusts the scroll area when the software keyboard is open. */
  keyboardAware?: boolean;
  children?: React.ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  // Taps on controls inside the scroll view. Defaults to the React Native default ('never'); a
  // screen with inline forms passes 'handled' so buttons work while the keyboard is open.
  keyboardShouldPersistTaps?: 'never' | 'always' | 'handled';
  // Optional fixed full-screen artwork drawn behind the content. The image style is where a
  // caller sets its zoom and placement (scale / translateX / translateY) without touching layout.
  backgroundImage?: ImageSourcePropType;
  backgroundImageStyle?: StyleProp<ImageStyle>;
};

// Common screen frame: safe-area aware, dark background and a consistent header.
export default function Screen({
  title,
  subtitle,
  right,
  scroll = true,
  avoidTabBar = false,
  keyboardAware = true,
  children,
  contentStyle,
  keyboardShouldPersistTaps,
  backgroundImage,
  backgroundImageStyle,
}: Props) {
  // Easy mode enlarges the shared frame text on every screen (the Dashboard adds its own
  // metric sizing on top). Read from prefs here so no screen has to remember to opt in.
  const easy = usePrefs().uiMode === 'easy';
  const insets = useSafeAreaInsets();
  const n = useNeu();
  const bottomClearance = avoidTabBar
    ? tabBarBottomClearance(insets.bottom) + spacing.lg
    : undefined;

  // Keeps the focused input above the software keyboard on every screen.
  const keyboardScroll = useKeyboardScroll({ enabled: keyboardAware, margin: spacing.md });

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
    <SafeAreaView style={[s.root, { backgroundColor: n.c.bg }]} edges={['top', 'left', 'right']}>
      {backgroundImage ? (
        <Image
          source={backgroundImage}
          style={[StyleSheet.absoluteFill, s.bgImage, backgroundImageStyle]}
          resizeMode="cover"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}
      <KeyboardScrollContext.Provider value={keyboardScroll.onFocusInput}>
        <KeyboardAvoidingView
          style={s.flex}
          behavior={keyboardAware ? (Platform.OS === 'ios' ? 'padding' : 'height') : undefined}
          enabled={keyboardAware}
        >
          {scroll ? (
            <ScrollView
              ref={keyboardScroll.scrollRef}
              contentContainerStyle={[
                s.content,
                bottomClearance != null && { paddingBottom: bottomClearance },
                contentStyle,
              ]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps={keyboardShouldPersistTaps}
              onScroll={keyboardScroll.onScroll}
              scrollEventThrottle={16}
            >
              {inner}
            </ScrollView>
          ) : (
            <View
              style={[
                s.content,
                s.flex,
                bottomClearance != null && { paddingBottom: bottomClearance },
                contentStyle,
              ]}
            >
              {inner}
            </View>
          )}
        </KeyboardAvoidingView>
      </KeyboardScrollContext.Provider>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  bgImage: { zIndex: 0 },
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
