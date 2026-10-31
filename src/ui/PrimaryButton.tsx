import React from 'react';
import NeuButton from './neu/NeuButton';

type Props = {
  label: string;
  onPress: () => void;
  /** Solid is the one primary action on a surface (accent); quiet is the secondary text action. */
  variant?: 'solid' | 'quiet';
  accessibilityHint?: string;
};

// Same props as before so every existing call site keeps working; now rendered by the shared
// neumorphic button (raised at rest, inset when pressed, 48dp / 52dp in Easy Mode).
export default function PrimaryButton({ label, onPress, variant = 'solid', accessibilityHint }: Props) {
  return (
    <NeuButton
      label={label}
      onPress={onPress}
      variant={variant === 'solid' ? 'accent' : 'quiet'}
      block={variant === 'solid'}
      accessibilityHint={accessibilityHint}
    />
  );
}
