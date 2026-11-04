// Timeline (ms) for the app-opening intro. Kept free of React Native imports so it is easy to test.
export const INTRO = {
  appear: 300, // logo + glow fade in
  pulse: 420, // soft beat
  zoom: 650, // zoom until the V fills the screen
  fade: 380, // overlay dissolves (starts partway through the zoom)
  fadeStartsAt: 1000, // ms from start
  zoomScale: 11,
  reducedMotionTotal: 600,
} as const;

export const INTRO_TOTAL_MS = INTRO.fadeStartsAt + INTRO.fade; // ~1.4s

// The intro plays once per cold start. A module-level flag survives re-renders and
// navigation, and the module is only re-evaluated when the JS runtime restarts, so
// returning from background does not replay it.
let played = false;
export function shouldPlayIntro(): boolean {
  return !played;
}
export function markIntroPlayed(): void {
  played = true;
}
