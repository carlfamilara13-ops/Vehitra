
export const TAB_BAR_CONFIG = {
  height: 55,

  // Navbar horizontal spacing
  horizontalInset: 15,

  bottomOffset: 12,
  cornerRadius: 32,

  // Tab icon sizing and positioning
  iconSize: 25,
  iconContainerWidth: 44,
  iconContainerHeight: 40,
  iconTranslateY: 7,

  // Center Record button
  recordButtonSize: 52,
  recordButtonOffset: -10,

  // Shadow configuration
  shadowOpacity: 0.16,
  shadowRadius: 12,
  shadowOffsetY: 6,
} as const;

export function tabBarBottomClearance(bottomInset: number): number {
  return (
    TAB_BAR_CONFIG.height +
    TAB_BAR_CONFIG.bottomOffset +
    bottomInset
  );
}
