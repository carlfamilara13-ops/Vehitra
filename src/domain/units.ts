// Pure unit conversion and display formatting. Every stored distance in Vehitra is metres or
// kilometres; imperial is a display-only concern. Keeping conversion here (and only here) means
// ledgers, intervals and odometers never change with the user's preference.

export type Units = 'metric' | 'imperial';

const MS_PER_KM = 1000;
const KM_PER_MILE = 1.609344;

// At most one decimal, no trailing ".0" — shared by km and mi displays.
function oneDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function distanceUnit(units: Units): string {
  return units === 'imperial' ? 'mi' : 'km';
}

export function speedUnit(units: Units): string {
  return units === 'imperial' ? 'mph' : 'km/h';
}

// Metres -> distance text in the user's unit (e.g. "12.3 km" / "7.6 mi").
export function formatDistanceM(meters: number, units: Units, opts?: { decimals?: 0 | 1 | 2 }): string {
  if (!Number.isFinite(meters)) return '—';
  const abs = Math.abs(meters);
  if (units === 'imperial') return `${oneDecimal(abs / KM_PER_MILE / MS_PER_KM)} mi`;
  if (opts?.decimals === 0) return `${Math.round(abs / MS_PER_KM)} km`;
  if (opts?.decimals === 2) return `${(abs / MS_PER_KM).toFixed(2)} km`;
  return `${oneDecimal(abs / MS_PER_KM)} km`;
}

// kilometres (as stored on odometers/intervals) -> distance text.
export function formatDistanceKm(km: number, units: Units): string {
  if (!Number.isFinite(km)) return '—';
  return formatDistanceM(km * MS_PER_KM, units);
}

// metres/second -> speed text (e.g. "54.0 km/h" / "33.6 mph"). Imperial converts through the
// same km->mi factor so both units always agree.
export function formatSpeedMs(metersPerSecond: number | null | undefined, units: Units): string {
  if (metersPerSecond == null || !Number.isFinite(metersPerSecond)) return '—';
  const kmh = metersPerSecond * 3.6;
  const value = units === 'imperial' ? kmh / KM_PER_MILE : kmh;
  return `${oneDecimal(value)} ${speedUnit(units)}`;
}

// Input-side label: forms always accept kilometres; this only clarifies the label.
export function odometerInputLabel(units: Units): string {
  return units === 'imperial' ? 'Odometer (km — stored as km)' : 'Odometer (km)';
}
