import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildWalletDocs, type WalletDocInput, type WalletVehicle } from './wallet';

// Reference "now": Tuesday 20 October 2026, local noon.
const NOW = new Date(2026, 9, 20, 12, 0, 0).getTime();

const row = (kind: string, due_date: string | null, overrides: Partial<WalletDocInput> = {}): WalletDocInput => ({
  kind,
  due_date,
  enabled: 1,
  deleted_at: null,
  ...overrides,
});

const vehicle: WalletVehicle = { name: 'Honda Click', plate: 'ABC 123' };

describe('buildWalletDocs   slots and order', () => {
  it('always returns exactly two slots in the required order: licence then registration', () => {
    const docs = buildWalletDocs([], null, NOW);
    assert.equal(docs.length, 2);
    assert.equal(docs[0].kind, 'license');
    assert.equal(docs[0].title, "Driver's licence");
    assert.equal(docs[1].kind, 'registration');
    assert.equal(docs[1].title, 'Vehicle registration');
  });

  it('reports both slots as not recorded when there are no reminder rows', () => {
    const docs = buildWalletDocs([], null, NOW);
    for (const d of docs) {
      assert.equal(d.dueDate, null);
      assert.equal(d.daysUntil, null);
      assert.equal(d.phase, 'none');
      assert.equal(d.expiryText, 'Not recorded yet');
    }
    assert.equal(docs[1].subject, null);
    assert.equal(docs[1].plate, null);
  });

  it('carries the vehicle name and plate onto the registration slot only', () => {
    const docs = buildWalletDocs([], vehicle, NOW);
    assert.equal(docs[0].subject, null);
    assert.equal(docs[0].plate, null);
    assert.equal(docs[1].subject, 'Honda Click');
    assert.equal(docs[1].plate, 'ABC 123');
  });
});

describe('buildWalletDocs   expiry text never invents a date', () => {
  it('renders an in-window due date as "Due in N days"', () => {
    const docs = buildWalletDocs([row('license', '2026-10-25')], null, NOW);
    assert.equal(docs[0].daysUntil, 5);
    assert.equal(docs[0].phase, 'due_soon');
    assert.equal(docs[0].expiryText, 'Due in 5 days');
  });

  it('renders a single day in the singular', () => {
    const docs = buildWalletDocs([row('license', '2026-10-21')], null, NOW);
    assert.equal(docs[0].expiryText, 'Due in 1 day');
  });

  it('renders today as "Due today"', () => {
    const docs = buildWalletDocs([row('registration', '2026-10-20')], vehicle, NOW);
    assert.equal(docs[1].expiryText, 'Due today');
  });

  it('renders a past date as expired, singular and plural', () => {
    const one = buildWalletDocs([row('license', '2026-10-19')], null, NOW);
    assert.equal(one[0].phase, 'overdue');
    assert.equal(one[0].expiryText, 'Expired 1 day ago');
    const many = buildWalletDocs([row('license', '2026-10-10')], null, NOW);
    assert.equal(many[0].expiryText, 'Expired 10 days ago');
  });

  it('renders a comfortably future date as "Valid until <date>"', () => {
    const docs = buildWalletDocs([row('license', '2027-03-01')], null, NOW);
    assert.equal(docs[0].phase, 'upcoming');
    assert.equal(docs[0].expiryText, 'Valid until 2027-03-01');
  });
});

describe('buildWalletDocs   row selection', () => {
  it('ignores disabled and soft-deleted rows', () => {
    const docs = buildWalletDocs(
      [
        row('license', '2026-10-21', { enabled: 0 }),
        row('license', '2026-10-22', { deleted_at: NOW }),
      ],
      null,
      NOW,
    );
    assert.equal(docs[0].dueDate, null);
    assert.equal(docs[0].expiryText, 'Not recorded yet');
  });

  it('prefers the latest due date when several rows share a kind', () => {
    const docs = buildWalletDocs(
      [
        row('license', '2026-10-21'),
        row('license', '2028-01-01'),
        row('license', '2027-05-05'),
      ],
      null,
      NOW,
    );
    assert.equal(docs[0].dueDate, '2028-01-01');
  });

  it('lets a dated row win over an undated one and vice versa', () => {
    const dated = buildWalletDocs([row('license', null), row('license', '2026-12-01')], null, NOW);
    assert.equal(dated[0].dueDate, '2026-12-01');
    const undatedOnly = buildWalletDocs([row('license', null)], null, NOW);
    assert.equal(undatedOnly[0].dueDate, null);
  });

  it('treats an unparseable stored date as not recorded', () => {
    const docs = buildWalletDocs([row('license', '2026-02-30')], null, NOW);
    assert.equal(docs[0].dueDate, null);
    assert.equal(docs[0].expiryText, 'Not recorded yet');
  });

  it('keeps licence and registration independent', () => {
    const docs = buildWalletDocs(
      [row('license', '2027-01-01'), row('registration', '2026-10-22')],
      vehicle,
      NOW,
    );
    assert.equal(docs[0].dueDate, '2027-01-01');
    assert.equal(docs[1].dueDate, '2026-10-22');
    assert.equal(docs[1].expiryText, 'Due in 2 days');
  });
});
