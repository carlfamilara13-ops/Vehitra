// Runtime capability probe for the native blur view.
//
// `expo-blur` is a native module: it only works when the running binary was built with it. A
// custom dev client built before the package was added (or an older build still installed on a
// tester's device) resolves the JavaScript but has no `ExpoBlurView` view manager, and mounting
// the blur view then throws `IllegalViewOperationException: Can't find ViewManager
// 'ViewManagerAdapter_ExpoBlur_ExpoBlurView'`.
//
// The probe deliberately does not import anything from `react-native`, including the internal
// `PaperUIManager`. Under the New Architecture that module pulls in the legacy `UIManager`
// TurboModule at module-evaluation time, and a bridgeless binary has no such module, so simply
// requiring it throws `TurboModuleRegistry.getEnforcing(...): 'UIManager' could not be found`
// (a failure a try/catch around the call cannot intercept).
//
// Instead it asks the Expo runtime, which is what registers and mounts these views in the first
// place. `globalThis.expo.getViewConfig(moduleName, viewName)` returns a config exactly when the
// running binary contains the native module, and null when it does not.

export function isNativeBlurViewAvailable(): boolean {
  try {
    const expo = (
      globalThis as {
        expo?: { getViewConfig?: (moduleName: string, viewName?: string) => unknown };
      }
    ).expo;
    if (!expo || typeof expo.getViewConfig !== 'function') return false;

    // Same module/view names expo-blur's `requireNativeViewManager('ExpoBlur', 'ExpoBlurView')`
    // uses. Where the platform has no per-view config the call returns null and the opaque
    // fallback is taken, which is always the safe result for a decorative effect.
    return expo.getViewConfig('ExpoBlur', 'ExpoBlurView') != null;
  } catch {
    return false;
  }
}
