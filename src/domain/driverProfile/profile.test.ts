import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDriverProfileView,
  normalizeDriverProfileInput,
  validateDriverProfileInput,
  type DriverProfileInput,
} from './profile';

const NOW = new Date(2026, 9, 22, 12, 0, 0).getTime();

const input = (overrides: Partial<DriverProfileInput> = {}): DriverProfileInput => ({
  fullName: 'Maria Santos',
  nationality: '',
  sex: '',
  dateOfBirth: '',
  weightKg: '',
  heightM: '',
  address: '',
  licenseNumber: '',
  expirationDate: '',
  agencyCode: '',
  bloodType: '',
  eyeColor: '',
  licenseCodes: '',
  conditions: '',
  portraitUri: null,
  ...overrides,
});

describe('driver profile validation', () => {
  it('requires only a name; every other field may stay blank', () => {
    assert.deepEqual(validateDriverProfileInput(input(), NOW), []);
    assert.deepEqual(validateDriverProfileInput(input({ fullName: '   ' }), NOW), [
      'Enter a name for the profile.',
    ]);
  });

  it('accepts names and addresses without imposing a pattern', () => {
    const problems = validateDriverProfileInput(
      input({
        fullName: "Jean-Luc O'Neill 李",
        address: 'Unit 12-B, 45 Mabini St., Brgy. Poblacion, Makati City, Metro Manila 1210',
      }),
      NOW,
    );
    assert.deepEqual(problems, []);
  });

  it('rejects impossible and future dates when they are provided', () => {
    assert.match(
      validateDriverProfileInput(input({ dateOfBirth: '2026-02-30' }), NOW)[0] ?? '',
      /real date/,
    );
    assert.match(
      validateDriverProfileInput(input({ dateOfBirth: '2027-01-01' }), NOW)[0] ?? '',
      /future/,
    );
    assert.match(
      validateDriverProfileInput(input({ expirationDate: 'soon' }), NOW)[0] ?? '',
      /real date/,
    );
    assert.deepEqual(validateDriverProfileInput(input({ expirationDate: '2020-01-01' }), NOW), []);
  });

  it('rejects non-positive or implausible weights and heights', () => {
    assert.equal(validateDriverProfileInput(input({ weightKg: '0' }), NOW).length, 1);
    assert.equal(validateDriverProfileInput(input({ weightKg: 'abc' }), NOW).length, 1);
    assert.equal(validateDriverProfileInput(input({ heightM: '1,75' }), NOW).length, 0);
    assert.equal(validateDriverProfileInput(input({ heightM: '4' }), NOW).length, 1);
  });

  it('enforces practical length limits without rejecting valid long addresses', () => {
    assert.equal(validateDriverProfileInput(input({ fullName: 'A'.repeat(121) }), NOW).length, 1);
    assert.equal(validateDriverProfileInput(input({ address: 'A'.repeat(400) }), NOW).length, 0);
    assert.equal(validateDriverProfileInput(input({ address: 'A'.repeat(401) }), NOW).length, 1);
  });
});

describe('driver profile normalization', () => {
  it('trims text, drops blank optional values and parses numbers', () => {
    const profile = normalizeDriverProfileInput(
      input({
        fullName: '  Maria Santos ',
        nationality: ' Filipino ',
        weightKg: '65',
        heightM: '1,75',
        address: '   ',
        dateOfBirth: '1990-05-12',
        portraitUri: ' file:///portrait.jpg ',
      }),
    );
    assert.equal(profile.full_name, 'Maria Santos');
    assert.equal(profile.nationality, 'Filipino');
    assert.equal(profile.weight_kg, 65);
    assert.equal(profile.height_m, 1.75);
    assert.equal(profile.address, null);
    assert.equal(profile.date_of_birth, '1990-05-12');
    assert.equal(profile.portrait_uri, 'file:///portrait.jpg');
  });
});

describe('driver profile display view', () => {
  it('uses prompts and "Not set" rather than sample data on first use', () => {
    const view = buildDriverProfileView(null);
    assert.equal(view.name, 'Your name');
    assert.equal(view.initials, '?');
    assert.equal(view.subtitle, 'Add your personal details');
    assert.equal(view.address, 'Not set');
    assert.equal(view.physical, 'Not set');
    assert.equal(view.expirationDate, 'Not set');
    assert.equal(view.portraitUri, null);
    assert.equal(view.isComplete, false);
  });

  it('formats saved values for the card', () => {
    const view = buildDriverProfileView({
      full_name: 'Maria Santos',
      nationality: 'Filipino',
      sex: 'Female',
      date_of_birth: '1990-05-12',
      weight_kg: 65,
      height_m: 1.75,
      address: 'Makati City',
      license_number: 'N01-23-456789',
      expiration_date: '2030-05-12',
      agency_code: 'NCR',
      blood_type: 'O+',
      eye_color: 'Brown',
      license_codes: 'A, B',
      conditions: 'Corrective lenses',
      portrait_uri: 'file:///portrait.jpg',
    });
    assert.equal(view.name, 'Maria Santos');
    assert.equal(view.initials, 'MS');
    assert.equal(view.subtitle, 'Filipino · Female · 1990-05-12');
    assert.equal(view.physical, '65 kg · 1.75 m');
    assert.equal(view.licenseNumber, 'N01-23-456789');
    assert.equal(view.conditions, 'Corrective lenses');
    assert.equal(view.isComplete, true);
  });
});
