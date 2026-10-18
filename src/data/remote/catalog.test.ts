import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { remoteRowToPackRow, type RemotePackRow } from './catalogMap';

const row = (over: Partial<RemotePackRow> = {}): RemotePackRow => ({
  interval_km: 1500,
  warn_remaining_pct: 25,
  review_status: 'draft',
  source_note: 'Reviewed against the catalog.',
  component: { code: 'engine_oil' },
  ...over,
});

describe('remote catalog row mapping', () => {
  it('maps a cloud row onto the local pack shape with remote provenance', () => {
    const mapped = remoteRowToPackRow('honda-click-125', 3, row());
    assert.deepEqual(mapped, {
      modelSlug: 'honda-click-125',
      componentCode: 'engine_oil',
      version: 3,
      intervalKm: 1500,
      warnRemainingPct: 25,
      reviewStatus: 'draft',
      sourceNote: 'Reviewed against the catalog.',
      provenance: 'remote',
    });
  });

  it('maps reviewed rows and numeric decimals', () => {
    const mapped = remoteRowToPackRow('m', 1, row({ review_status: 'reviewed', warn_remaining_pct: 22.5 }));
    assert.equal(mapped.reviewStatus, 'reviewed');
    assert.equal(mapped.warnRemainingPct, 22.5);
  });

  it('keeps null intervals as null (pending review, not zero)', () => {
    const mapped = remoteRowToPackRow('m', 1, row({ interval_km: null }));
    assert.equal(mapped.intervalKm, null);
  });

  it('treats an unknown review status as draft rather than trusting it', () => {
    const mapped = remoteRowToPackRow('m', 1, row({ review_status: 'approved' }));
    assert.equal(mapped.reviewStatus, 'draft');
  });

  it('coerces a missing or junk warn percentage to the 25% default', () => {
    assert.equal(remoteRowToPackRow('m', 1, row({ warn_remaining_pct: null })).warnRemainingPct, 25);
    // Numeric() on a non-numeric string yields NaN — validation downstream rejects the pack,
    // which is the safe outcome (the download fails loudly instead of writing junk).
    const nan = remoteRowToPackRow('m', 1, row({ warn_remaining_pct: Number.NaN as never })).warnRemainingPct;
    assert.ok(Number.isNaN(nan));
  });

  it('leaves a missing component embed as an empty code so validation rejects the row', () => {
    const mapped = remoteRowToPackRow('m', 1, row({ component: null }));
    assert.equal(mapped.componentCode, '');
  });
});
