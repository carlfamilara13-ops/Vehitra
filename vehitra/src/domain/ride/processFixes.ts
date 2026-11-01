import { haversineM } from '../../lib/geo';
import type { DomainEvent, Fix, ProcessConfig, ProcessResult, RideState, StoredFix } from './types';

export function newRideState(startedAt: number): RideState {
  return {
    startedAt,
    lastTs: null,
    lastLat: null,
    lastLon: null,
    lastRawLat: null,
    lastRawLon: null,
    pointCount: 0,
    distanceM: 0,
    rawDistanceM: 0,
    maxGapS: 0,
    maxDelayMs: 0,
    lateBatches: 0,
    untrackedGapS: 0,
    untrackedGapM: 0,
    maxSpeedMs: 0,
    firstUsableTs: null,
    lastUsableTs: null,
    lastUsableLat: null,
    lastUsableLon: null,
  };
}

export function isUsable(f: Pick<Fix, 'accuracy'>, cfg: Pick<ProcessConfig, 'maxAccuracyM'>): boolean {
  return f.accuracy !== null && f.accuracy <= cfg.maxAccuracyM;
}

// Turns a batch of GPS fixes into updated ride totals. Pure: same input, same output.
//  - sorts the batch chronologically; drops cached fixes from before the ride started and fixes not newer
//    than the last accepted one (a batch that arrives LATE and older than stored data is dropped, not merged)
//  - a fix is "usable" when its accuracy is known and good; only usable fixes define distance, tracked time and route
//  - a stretch longer than `untrackedGapS` without a usable fix is "untracked": its distance is NOT added
//  - filtered distance ignores standstill jitter
export function processFixes(
  prev: RideState,
  fixes: Fix[],
  nowMs: number,
  cfg: ProcessConfig,
): ProcessResult {
  const s: RideState = { ...prev };
  const accepted: StoredFix[] = [];
  const events: DomainEvent[] = [];
  let stale = 0;
  let notNewer = 0;
  let oldestStale = Infinity;
  let lastTs = s.lastTs;

  const sorted = [...fixes].sort((a, b) => a.timestamp - b.timestamp); // stable
  if (sorted.some((f, i) => f !== fixes[i])) {
    events.push({ type: 'unsorted_batch', detail: `n=${fixes.length}` });
  }

  for (const f of sorted) {
    if (f.timestamp < s.startedAt - cfg.staleFixToleranceMs) {
      stale += 1;
      oldestStale = Math.min(oldestStale, f.timestamp);
      continue;
    }
    if (lastTs !== null && f.timestamp <= lastTs) {
      notNewer += 1;
      continue;
    }

    s.pointCount += 1;
    accepted.push({ ...f, seq: s.pointCount });
    const prevTs = lastTs;
    lastTs = f.timestamp;

    // Delivery gap between ANY two accepted fixes (diagnostic: is Android delivering?).
    const deliveryGapS = prevTs !== null ? (f.timestamp - prevTs) / 1000 : 0;
    if (prevTs !== null) {
      s.maxGapS = Math.max(s.maxGapS, deliveryGapS);
      if (deliveryGapS > cfg.gapLogThresholdS) {
        events.push({
          type: 'gap',
          detail: `gap=${deliveryGapS.toFixed(0)}s ended_at=${new Date(f.timestamp).toISOString()} acc=${f.accuracy ?? 'n/a'}`,
        });
      }
    }

    // Raw distance (diagnostics only): every consecutive fix, except across a long delivery gap.
    if (s.lastRawLat !== null && s.lastRawLon !== null && deliveryGapS <= cfg.untrackedGapS) {
      s.rawDistanceM += haversineM(s.lastRawLat, s.lastRawLon, f.lat, f.lon);
    }
    s.lastRawLat = f.lat;
    s.lastRawLon = f.lon;

    if (!isUsable(f, cfg)) continue; // stored, but never used for distance, tracked time or route

    if (f.speed !== null && f.speed >= 0) s.maxSpeedMs = Math.max(s.maxSpeedMs, f.speed);
    if (s.firstUsableTs === null) s.firstUsableTs = f.timestamp;

    let untracked = false;
    if (s.lastUsableTs !== null) {
      const gapS = (f.timestamp - s.lastUsableTs) / 1000;
      if (gapS > cfg.untrackedGapS) {
        untracked = true;
        s.untrackedGapS += gapS;
        if (s.lastUsableLat !== null && s.lastUsableLon !== null) {
          s.untrackedGapM += haversineM(s.lastUsableLat, s.lastUsableLon, f.lat, f.lon);
        }
        events.push({ type: 'untracked_gap', detail: `gap=${gapS.toFixed(0)}s` });
      }
    }
    s.lastUsableTs = f.timestamp;
    s.lastUsableLat = f.lat;
    s.lastUsableLon = f.lon;

    if (untracked || s.lastLat === null || s.lastLon === null) {
      // Start fresh: no distance is added across an untracked gap.
      s.lastLat = f.lat;
      s.lastLon = f.lon;
      continue;
    }

    // Filtered distance.
    const d = haversineM(s.lastLat, s.lastLon, f.lat, f.lon);
    const speed = f.speed ?? 0;
    const standstill = speed >= 0 && speed < cfg.standstillSpeedMs;
    if (d < cfg.minMoveM) continue;
    if (standstill && d < (f.accuracy ?? 0)) continue;
    s.distanceM += d;
    s.lastLat = f.lat;
    s.lastLon = f.lon;
  }
  s.lastTs = lastTs;

  if (stale > 0) {
    events.push({
      type: 'stale_fix_dropped',
      detail: `dropped=${stale} oldest_age_s=${Math.round((s.startedAt - oldestStale) / 1000)}`,
    });
  }
  if (notNewer > 0) {
    events.push({ type: 'old_fix_dropped', detail: `dropped=${notNewer}` });
  }

  if (accepted.length > 0) {
    const delay = Math.max(0, nowMs - accepted[accepted.length - 1].timestamp);
    s.maxDelayMs = Math.max(s.maxDelayMs, delay);
    if (delay > cfg.lateBatchMs) s.lateBatches += 1;
    if (delay > cfg.lateBatchLogMs) {
      events.push({ type: 'late_batch', detail: `delay_ms=${delay} n=${accepted.length}` });
    }
  }
  return { state: s, accepted, events };
}
