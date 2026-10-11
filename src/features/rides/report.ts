import { Platform } from 'react-native';
import { PROCESS, TRACKING } from '../../config/tracking';
import { getDb } from '../../data/local/db';

// One text blob to paste back when diagnosing GPS behaviour on a phone.
export async function buildReport(): Promise<string> {
  const db = await getDb();
  const rides = await db.getAllAsync<Record<string, number | string | null>>(
    `SELECT id, started_at, ended_at, status, point_count, distance_m, raw_distance_m, max_gap_s, max_delay_ms,
            late_batches, untracked_gap_s, untracked_gap_m, max_speed_ms, duration_s, tracked_s, avg_speed_ms, needs_review,
            interrupted, interruption_count, interruption_s, recovery_state, integrity_issue,
            (SELECT COUNT(*) FROM points p WHERE p.ride_id = rides.id) AS rows_in_db
       FROM rides ORDER BY started_at DESC LIMIT 10`);
  const events = await db.getAllAsync<{ ts: number; type: string; detail: string | null }>(
    'SELECT ts, type, detail FROM events ORDER BY id DESC LIMIT 300');
  const c = (Platform as unknown as { constants?: Record<string, unknown> }).constants ?? {};
  return JSON.stringify(
    {
      device: { os: Platform.OS, androidRelease: c.Release, apiLevel: Platform.Version, brand: c.Brand, model: c.Model },
      config: { TRACKING, PROCESS },
      rides: rides.map((r) => ({
        ...r,
        started_at: new Date(r.started_at as number).toISOString(),
        ended_at: r.ended_at ? new Date(r.ended_at as number).toISOString() : null,
        distance_km: +((r.distance_m as number) / 1000).toFixed(3),
        raw_distance_km: +((r.raw_distance_m as number) / 1000).toFixed(3),
      })),
      events: events.map((e) => `${new Date(e.ts).toISOString()} ${e.type} ${e.detail ?? ''}`),
    },
    null,
    1,
  );
}
