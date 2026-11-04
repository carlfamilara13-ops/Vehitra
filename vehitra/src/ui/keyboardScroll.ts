import React, { useCallback, useEffect, useRef } from 'react';
import {
  Keyboard,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
  type TextInput,
} from 'react-native';

// Screens and sheets register the focused input here so the frame can scroll it above the
// keyboard. Null outside a keyboard-aware frame.
export type KeyboardScrollHandler = (input: TextInput | null) => void;

export const KeyboardScrollContext = React.createContext<KeyboardScrollHandler | null>(null);

type Options = {
  enabled?: boolean;
  /** Space kept between the input and the keyboard edge. */
  margin?: number;
};

// Keeps the focused TextInput visible when the software keyboard opens. Pairs with
// KeyboardAvoidingView (iOS) or the Android resize window mode for the inset; this hook only
// scrolls the frame far enough for the input to clear the keyboard.
export function useKeyboardScroll({ enabled = true, margin = 16 }: Options = {}) {
  const scrollRef = useRef<ScrollView>(null);
  const scrollOffset = useRef(0);
  const focusedInput = useRef<TextInput | null>(null);
  const keyboardVisible = useRef(false);
  const keyboardTop = useRef<number | null>(null);
  const alignTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const alignFocusedInput = useCallback(() => {
    const input = focusedInput.current;
    const scroller = scrollRef.current;
    if (!input || !scroller) return;
    const top = keyboardTop.current ?? Keyboard.metrics()?.screenY;
    if (top == null) return;

    input.measureInWindow((_x, y, _width, height) => {
      const overshoot = y + height + margin - top;
      if (overshoot > 0) {
        scroller.scrollTo({ y: scrollOffset.current + overshoot, animated: true });
      }
    });
  }, [margin]);

  const scheduleAlign = useCallback(() => {
    if (alignTimer.current) clearTimeout(alignTimer.current);
    // The keyboard and the resized/padded viewport settle just after the show event.
    alignTimer.current = setTimeout(alignFocusedInput, 80);
  }, [alignFocusedInput]);

  useEffect(() => {
    if (!enabled) return;
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      keyboardVisible.current = true;
      keyboardTop.current = event.endCoordinates.screenY;
      scheduleAlign();
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      keyboardVisible.current = false;
      keyboardTop.current = null;
    });
    return () => {
      show.remove();
      hide.remove();
      if (alignTimer.current) clearTimeout(alignTimer.current);
    };
  }, [enabled, scheduleAlign]);

  const onFocusInput = useCallback(
    (input: TextInput | null) => {
      focusedInput.current = input;
      // Switching fields with the keyboard already open: didShow will not fire again.
      if (input && keyboardVisible.current) scheduleAlign();
    },
    [scheduleAlign],
  );

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollOffset.current = e.nativeEvent.contentOffset.y;
  }, []);

  return { scrollRef, onScroll, onFocusInput: enabled ? onFocusInput : null };
}
