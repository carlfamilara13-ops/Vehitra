// Personal driver profile: the values shown on the dashboard's driver card.
//
// This is deliberately separate from the `deadlines` licence reminder. A deadline only records
// an expiry date; the profile holds the details the driver chose to keep on the card. Nothing
// here is an official credential, and every field except the name is optional. Validation only
// rejects values the app could not display meaningfully (an impossible date, a non-positive
// weight) — names, addresses and other free text are never pattern-matched.

import { parseDateOnly } from '../reminders/dates';

export type DriverProfile = {
  full_name: string;
  nationality: string | null;
  sex: string | null;
  date_of_birth: string | null;
  weight_kg: number | null;
  height_m: number | null;
  address: string | null;
  license_number: string | null;
  expiration_date: string | null;
  agency_code: string | null;
  blood_type: string | null;
  eye_color: string | null;
  license_codes: string | null;
  conditions: string | null;
  portrait_uri: string | null;
  dl_code?: string | null;
  serial_number?: string | null;
};

export type DriverProfileInput = {
  fullName: string;
  nationality: string;
  sex: string;
  dateOfBirth: string;
  weightKg: string;
  heightM: string;
  address: string;
  licenseNumber: string;
  expirationDate: string;
  agencyCode: string;
  bloodType: string;
  eyeColor: string;
  licenseCodes: string;
  conditions: string;
  portraitUri: string | null;
  dlCode?: string;
  serialNumber?: string;
};

const MAX = {
  name: 120,
  nationality: 60,
  sex: 40,
  address: 400,
  licenseNumber: 50,
  agencyCode: 40,
  bloodType: 8,
  eyeColor: 30,
  licenseCodes: 120,
  conditions: 400,
  dlCode: 40,
  serialNumber: 60,
} as const;

const EMPTY_FIELD = 'Not set';

function trimmedOrNull(raw: string): string | null {
  const value = raw.trim();
  return value.length ? value : null;
}

function parsePositiveNumber(raw: string): number | null {
  const value = raw.trim().replace(',', '.');
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function checkOptionalDate(errors: string[], raw: string, label: string): void {
  const value = raw.trim();
  if (!value) return;
  if (parseDateOnly(value) == null) errors.push(`${label} must be a real date in YYYY-MM-DD format.`);
}

/** Validates the edit form. Errors are written for the user, not for developers. */
export function validateDriverProfileInput(input: DriverProfileInput, now = Date.now()): string[] {
  const errors: string[] = [];
  const name = input.fullName.trim();
  if (!name) errors.push('Enter a name for the profile.');
  if (name.length > MAX.name) errors.push(`Name must be ${MAX.name} characters or fewer.`);

  const textLimits: [keyof typeof MAX, string, string][] = [
    ['nationality', input.nationality, 'Nationality'],
    ['sex', input.sex, 'Sex'],
    ['address', input.address, 'Address'],
    ['licenseNumber', input.licenseNumber, 'Licence number'],
    ['agencyCode', input.agencyCode, 'Agency code'],
    ['bloodType', input.bloodType, 'Blood type'],
    ['eyeColor', input.eyeColor, 'Eye colour'],
    ['licenseCodes', input.licenseCodes, 'Driver codes'],
    ['conditions', input.conditions, 'Conditions or restrictions'],
    ['dlCode', input.dlCode ?? '', 'DL code'],
    ['serialNumber', input.serialNumber ?? '', 'Serial number'],
  ];
  for (const [limitKey, raw, label] of textLimits) {
    if (raw.trim().length > MAX[limitKey]) {
      errors.push(`${label} must be ${MAX[limitKey]} characters or fewer.`);
    }
  }

  checkOptionalDate(errors, input.dateOfBirth, 'Date of birth');
  const birth = input.dateOfBirth.trim();
  const birthMs = birth ? parseDateOnly(birth) : null;
  if (birthMs != null) {
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);
    if (birthMs > endOfToday.getTime()) errors.push('Date of birth cannot be in the future.');
  }
  checkOptionalDate(errors, input.expirationDate, 'Expiration date');

  const weightText = input.weightKg.trim();
  if (weightText) {
    const weight = parsePositiveNumber(weightText);
    if (weight == null || weight > 500) {
      errors.push('Weight must be a number greater than 0 kg (500 kg or less).');
    }
  }

  const heightText = input.heightM.trim();
  if (heightText) {
    const height = parsePositiveNumber(heightText);
    if (height == null || height > 3) {
      errors.push('Height must be a number greater than 0 m (3 m or less).');
    }
  }

  return errors;
}

/** Converts the form's strings into the stored shape. Call only after validation passes. */
export function normalizeDriverProfileInput(input: DriverProfileInput): DriverProfile {
  const weight = parsePositiveNumber(input.weightKg);
  const height = parsePositiveNumber(input.heightM);
  const portrait = input.portraitUri?.trim();
  return {
    full_name: input.fullName.trim(),
    nationality: trimmedOrNull(input.nationality),
    sex: trimmedOrNull(input.sex),
    date_of_birth: trimmedOrNull(input.dateOfBirth),
    weight_kg: weight,
    height_m: height,
    address: trimmedOrNull(input.address),
    license_number: trimmedOrNull(input.licenseNumber),
    expiration_date: trimmedOrNull(input.expirationDate),
    agency_code: trimmedOrNull(input.agencyCode),
    blood_type: trimmedOrNull(input.bloodType),
    eye_color: trimmedOrNull(input.eyeColor),
    license_codes: trimmedOrNull(input.licenseCodes),
    conditions: trimmedOrNull(input.conditions),
    portrait_uri: portrait && portrait.length ? portrait : null,
    dl_code: trimmedOrNull(input.dlCode ?? ''),
    serial_number: trimmedOrNull(input.serialNumber ?? ''),
  };
}

export type DriverProfileView = {
  /** Name, or a prompt when the profile has not been filled in yet. */
  name: string;
  initials: string;
  subtitle: string;
  address: string;
  licenseNumber: string;
  expirationDate: string;
  agencyCode: string;
  bloodType: string;
  eyeColor: string;
  physical: string;
  licenseCodes: string;
  conditions: string;
  portraitUri: string | null;
  isComplete: boolean;
  dlCode?: string;
  serialNumber?: string;
};

function display(raw: string | null | undefined): string {
  const value = raw?.trim();
  return value ? value : EMPTY_FIELD;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return `${first}${last}`.toUpperCase() || '?';
}

/**
 * Ready-to-render values with explicit empty states. The card uses this so a blank profile says
 * "Not set" instead of showing sample data or silently hiding the field.
 */
export function buildDriverProfileView(profile: DriverProfile | null): DriverProfileView {
  const realName = profile?.full_name?.trim() ?? '';
  const subtitleParts = [profile?.nationality, profile?.sex, profile?.date_of_birth]
    .map((value) => value?.trim())
    .filter((value): value is string => !!value);
  const physicalParts = [
    profile?.weight_kg != null ? `${profile.weight_kg} kg` : null,
    profile?.height_m != null ? `${profile.height_m} m` : null,
  ].filter((value): value is string => !!value);

  return {
    name: realName || 'Your name',
    initials: realName ? initialsOf(realName) : '?',
    subtitle: subtitleParts.length ? subtitleParts.join(' · ') : 'Add your personal details',
    address: display(profile?.address),
    licenseNumber: display(profile?.license_number),
    expirationDate: display(profile?.expiration_date),
    agencyCode: display(profile?.agency_code),
    bloodType: display(profile?.blood_type),
    eyeColor: display(profile?.eye_color),
    physical: physicalParts.length ? physicalParts.join(' · ') : EMPTY_FIELD,
    licenseCodes: display(profile?.license_codes),
    conditions: display(profile?.conditions),
    portraitUri: profile?.portrait_uri ?? null,
    isComplete: !!realName,
    dlCode: display(profile?.dl_code),
    serialNumber: display(profile?.serial_number),
  };
}

export { EMPTY_FIELD as DRIVER_PROFILE_EMPTY_FIELD };
