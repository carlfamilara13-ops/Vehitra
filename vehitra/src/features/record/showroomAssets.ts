import type { ImageSourcePropType } from 'react-native';

// ---------------------------------------------------------------------------------------
// Showroom artwork registry (TEMPORARY   Stage 2 demo art)
//
// This is the ONE place the Record tab's showroom imagery is referenced. Everything else
// (the carousel page, the image frame) asks this module for a picture and never names a file,
// so swapping the temporary artwork for real per-vehicle photos later is a one-file change:
//
//   1. Drop the real images under `assets/showroom/` (or anywhere Metro can resolve them).
//   2. Point the entry for that vehicle type at the new file.
//   3. When vehicles gain their own image column, resolve the source per vehicle id here
//      instead of per vehicle type   the frame and the carousel do not need to change.
//
// The supplied art is temporary placeholder material for this stage:
//   - `showroom-bg.jpg`     the showroom backdrop, drawn behind the vehicle.
//   - `motorcycle.png`      the foreground vehicle. It is a transparent PNG (RGBA), so the
//                           showroom backdrop stays visible through and around the machine.
//   - `motorcycle-alt.webp`   the same bike as a square WebP, kept as the drop-in alternative
//                           for `motorcycle.png` (swap the two `require` calls below).
//
// Nothing here is generated or substituted: these are the supplied files, copied as-is.
// ---------------------------------------------------------------------------------------

/** The showroom backdrop drawn behind the vehicle on every carousel page. */
export const SHOWROOM_BACKGROUND: ImageSourcePropType = require('../../../assets/showroom/showroom-bg.jpg');

/** The foreground vehicle art used in this stage wherever a type has no picture of its own. */
const DEMO_VEHICLE_IMAGE: ImageSourcePropType = require('../../../assets/showroom/motorcycle.png');

/**
 * Per-vehicle-type art. A `null` entry means "this type deliberately shows the type glyph
 * instead of a picture". A type that is not listed falls back to the shared demo art, so the
 * temporary stage still reads as a showroom for every vehicle.
 */
const VEHICLE_IMAGES_BY_TYPE: Readonly<Record<string, ImageSourcePropType | null>> = {
  motorcycle: DEMO_VEHICLE_IMAGE,
  // car: null,   // no picture for this type   the type glyph is used instead
};

/**
 * The art for one vehicle, or null when that type deliberately has no picture and the caller
 * should fall back to the type glyph. Never throws and never invents an image: an unmapped
 * type simply gets the shared demo art.
 */
export function showroomVehicleImage(vehicleType: string): ImageSourcePropType | null {
  // `hasOwnProperty` rather than `in`: an inherited key (`constructor`, `toString`) is not a
  // vehicle type and must not be answered with an inherited value.
  if (Object.prototype.hasOwnProperty.call(VEHICLE_IMAGES_BY_TYPE, vehicleType)) {
    return VEHICLE_IMAGES_BY_TYPE[vehicleType] ?? null;
  }
  return DEMO_VEHICLE_IMAGE;
}
