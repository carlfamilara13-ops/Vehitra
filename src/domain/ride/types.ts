// Pure types for ride processing. No React/Expo/SQLite imports in src/domain.

export type Fix = {
  timestamp: number; // ms since epoch (from the GPS fix, not the delivery time)
  lat: number;
  lon: number;
  accuracy: number | null;
  speed: number | null; // m/s
  altitude: number | null;
  heading: number | null;
};

export type StoredFix = Fix & { seq: number };

export type RideState = {
  startedAt: number;
  lastTs: number | null; // timestamp of the last accepted fix
  lastLat: number | null; // anchor for the FILTERED distance
  lastLon: number | null;
  lastRawLat: number | null; // anchor for the RAW distance
  lastRawLon: number | null;
  pointCount: number;
  distanceM: number; // filtered: the GPS estimate used by the app
  rawDistanceM: number; // unfiltered, kept for diagnostics
  maxGapS: number;
  maxDelayMs: number;
  lateBatches: number;
  untrackedGapS: number;
  untrackedGapM: number; // straight-line distance across untracked gaps; NOT part of distanceM
  maxSpeedMs: number;
  // "Usable" fix = accuracy known and <= maxAccuracyM. Tracked time and untracked gaps are measured on usable fixes only.
  firstUsableTs: number | null;
  lastUsableTs: number | null;
  lastUsableLat: number | null;
  lastUsableLon: number | null;
};

export type ProcessConfig = {
  maxAccuracyM: number;
  minMoveM: number;
  standstillSpeedMs: number;
  staleFixToleranceMs: number;
  gapLogThresholdS: number;
  untrackedGapS: number;
  lateBatchMs: number;
  lateBatchLogMs: number;
};

export type DomainEvent = { type: string; detail: string };

export type ProcessResult = {
  state: RideState;
  accepted: StoredFix[];
  events: DomainEvent[];
};
