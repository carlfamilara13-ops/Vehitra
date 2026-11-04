
import {
  normalizeDriverProfileInput,
  validateDriverProfileInput,
  type DriverProfile,
  type DriverProfileInput,
} from '../../domain/driverProfile/profile';
import { serialize } from './serialize';
import type { Db } from './types';

// Personal driver profile (schema v14). One row shared by the dashboard card and the edit form.
// Stored only in the local SQLite database; this table is deliberately excluded from sync.

export class DriverProfileValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(errors[0] ?? 'Invalid driver profile');
    this.name = 'DriverProfileValidationError';
  }
}

export type DriverProfileRow = DriverProfile & {
  id: number;
  created_at: number;
  updated_at: number;
};

const PROFILE_ID = 1;

function readProfile(db: Db): Promise<DriverProfileRow | null> {
  return db.getFirstAsync<DriverProfileRow>(
    'SELECT * FROM driver_profile WHERE id = ?',
    PROFILE_ID,
  );
}

/** Returns null on first use; an absent profile is a valid state, not an error. */
export function getDriverProfile(db: Db): Promise<DriverProfileRow | null> {
  return readProfile(db);
}

export function saveDriverProfile(
  db: Db,
  input: DriverProfileInput,
  now = Date.now(),
): Promise<DriverProfileRow> {
  return serialize(async () => {
    const errors = validateDriverProfileInput(input, now);
    if (errors.length) {
      throw new DriverProfileValidationError(errors);
    }

    const profile = normalizeDriverProfileInput(input);
    const existing = await readProfile(db);

    if (existing) {
      await db.runAsync(
        `UPDATE driver_profile
            SET full_name = ?, nationality = ?, sex = ?, date_of_birth = ?, weight_kg = ?,
                height_m = ?, address = ?, license_number = ?, expiration_date = ?, agency_code = ?,
                blood_type = ?, eye_color = ?, license_codes = ?, conditions = ?, portrait_uri = ?,
                back_photo_uri = ?, dl_code = ?, serial_number = ?, updated_at = ?
          WHERE id = ?`,
        profile.full_name,
        profile.nationality,
        profile.sex,
        profile.date_of_birth,
        profile.weight_kg,
        profile.height_m,
        profile.address,
        profile.license_number,
        profile.expiration_date,
        profile.agency_code,
        profile.blood_type,
        profile.eye_color,
        profile.license_codes,
        profile.conditions,
        profile.portrait_uri,
        profile.back_photo_uri,
        profile.dl_code ?? null,
        profile.serial_number ?? null,
        now,
        PROFILE_ID,
      );
    } else {
      await db.runAsync(
        `INSERT INTO driver_profile
           (id, full_name, nationality, sex, date_of_birth, weight_kg, height_m, address,
            license_number, expiration_date, agency_code, blood_type, eye_color, license_codes,
            conditions, portrait_uri, back_photo_uri, dl_code, serial_number, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        PROFILE_ID,
        profile.full_name,
        profile.nationality,
        profile.sex,
        profile.date_of_birth,
        profile.weight_kg,
        profile.height_m,
        profile.address,
        profile.license_number,
        profile.expiration_date,
        profile.agency_code,
        profile.blood_type,
        profile.eye_color,
        profile.license_codes,
        profile.conditions,
        profile.portrait_uri,
        profile.back_photo_uri,
        profile.dl_code ?? null,
        profile.serial_number ?? null,
        now,
        now,
      );
    }

    const saved = await readProfile(db);

    if (!saved) {
      throw new DriverProfileValidationError([
        'Could not save the driver profile.',
      ]);
    }

    return saved;
  });
}

