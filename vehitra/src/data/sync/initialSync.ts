export type InitialSyncState = 'empty' | 'backup' | 'restore' | 'review_required';

export function classifyInitialSync(localRecordCount: number, cloudRecordCount: number): InitialSyncState {
  if (!Number.isInteger(localRecordCount) || localRecordCount < 0) {
    throw new RangeError('localRecordCount must be a non-negative integer');
  }
  if (!Number.isInteger(cloudRecordCount) || cloudRecordCount < 0) {
    throw new RangeError('cloudRecordCount must be a non-negative integer');
  }
  if (localRecordCount > 0 && cloudRecordCount > 0) return 'review_required';
  if (localRecordCount > 0) return 'backup';
  if (cloudRecordCount > 0) return 'restore';
  return 'empty';
}
