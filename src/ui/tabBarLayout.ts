// Geometry of the floating tab bar, in one place because two different things depend on it: the
// navigator positions the bar with these numbers, and every screen has to keep its content clear
// of them. The bar is absolutely positioned over the scenes (so content passes behind the glass
// instead of stopping at an opaque edge), which means nothing in the layout reserves room for it
// automatically.

// Height of the bar's own content. The safe-area inset is not part of it: the bar floats above
// the inset rather than being padded into it, so a custom height here no longer replaces the
// navigator's inset arithmetic the way the old edge-to-edge bar did.
export const TAB_BAR_HEIGHT = 56;

// Gap between the bar and the screen edge (sides and, after the inset, the bottom). This is what
// makes the bar float: without it the rounded surface would sit flush against the edge and read
// as an ordinary bottom border.
export const TAB_BAR_SIDE_INSET = 16;
export const TAB_BAR_BOTTOM_GAP = 8;

// Corner radius of the floating surface. Just under half the height, so the pill stays soft
// without becoming a full capsule.
export const TAB_BAR_RADIUS = 70;

// Bottom clearance a screen needs so its last row is not trapped behind the floating bar: the bar
// itself, the gap below it, and the home-indicator inset the bar hovers above.
export function tabBarBottomClearance(bottomInset: number): number {
  return TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_GAP + bottomInset;
}
