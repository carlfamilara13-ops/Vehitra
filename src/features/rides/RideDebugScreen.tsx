import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, SafeAreaView, ScrollView, Share, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '../../ui/neu/NeuText';
import { getDb } from '../../data/local/db';
import { getActiveRideId, listRides, logEvent, type RideRow } from '../../data/local/ridesStore';
import { buildReport } from './report';
import { ensurePermissions } from './tracking/permissions';
import { runStartFlow } from './tracking/startFlow';
import { resumeIfInterrupted, retryTracking, startRide, stopRide } from './tracking/tracker';

// Temporary developer screen for verifying ride tracking on a real phone.
// The real Record / Rides screens replace it in later steps.
type EventRow = { id: number; ts: number; type: string; detail: string | null };
type Blocked = { message: string; canAskAgain: boolean };

const km = (m: number) => (m / 1000).toFixed(2);
const mmss = (s: number) => `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;

export default function RideDebugScreen() {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [rides, setRides] = useState<RideRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const db = await getDb();
    setActiveId(await getActiveRideId(db));
    setRides(await listRides(db, 8));
    setEvents(await db.getAllAsync<EventRow>('SELECT id, ts, type, detail FROM events ORDER BY id DESC LIMIT 20'));
  }, []);

  useEffect(() => {
    resumeIfInterrupted()
      .then(refresh)
      .catch((e) => setMsg(String(e)));
  }, [refresh]);

  useEffect(() => {
    const t = setInterval(() => refresh().catch(() => undefined), 1000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (s) => {
      logEvent(await getDb(), 'app_state', s);
    });
    return () => sub.remove();
  }, []);

  // Start is blocked (with an explanation and a retry path) unless foreground AND background location are granted.
  const onStart = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const out = await runStartFlow({ ensurePermissions, startRide: () => startRide() });
      if (out.status === 'started') {
        setBlocked(null);
        setWarnings(out.warnings);
        setMsg('');
      } else if (out.status === 'blocked') {
        setBlocked({ message: out.message, canAskAgain: out.canAskAgain });
        setMsg('');
      } else {
        setMsg(out.message);
      }
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const onStop = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await stopRide('finished'); // an interrupted ride is saved as 'recovered' automatically
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const onRetryTracking = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await retryTracking();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const active = rides.find((r) => r.id === activeId);

  return (
    <SafeAreaView style={s.root}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text style={s.h1}>Vehitra ride tracking (dev screen)</Text>

        {blocked && (
          <View style={s.warn}>
            <Text style={s.txt}>{blocked.message}</Text>
            {!blocked.canAskAgain && (
              <Text style={s.dim}>
                Android will not show the permission prompt again. Open the app settings, choose Location, then
                "Allow all the time", and come back.
              </Text>
            )}
            <View style={s.row}>
              <TouchableOpacity style={s.btnSm} onPress={onStart} disabled={busy}>
                <Text style={s.btnTxt}>Try again</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.btnSm} onPress={() => Linking.openSettings()}>
                <Text style={s.btnTxt}>Open app settings</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        {warnings.map((w) => (
          <Text key={w} style={s.dim}>{w}</Text>
        ))}

        {activeId ? (
          <TouchableOpacity style={[s.btn, { backgroundColor: '#C62828', opacity: busy ? 0.5 : 1 }]} onPress={onStop} disabled={busy}>
            <Text style={s.btnTxt}>STOP RIDE</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[s.btn, { opacity: busy ? 0.5 : 1 }]} onPress={onStart} disabled={busy}>
            <Text style={s.btnTxt}>START RIDE</Text>
          </TouchableOpacity>
        )}

        {active && active.interrupted === 1 && (
          // Persisted in the database: it survives app restarts and cannot be dismissed away.
          <View style={s.warn}>
            {active.recovery_state === 'verifying' && (
              <Text style={s.txt}>
                Tracking was interrupted ({mmss(active.interruption_s)} without points). Waiting for a fresh GPS fix to
                confirm that recording has resumed...
              </Text>
            )}
            {active.recovery_state === 'confirmed' && (
              <Text style={s.txt}>
                Tracking was interrupted and a fresh GPS fix has been recorded since. The missing stretch is marked
                untracked. This ride will be saved as "recovered" and flagged for review.
              </Text>
            )}
            {active.recovery_state === 'failed' && (
              <>
                <Text style={s.txt}>
                  Tracking did NOT resume: no new points are being recorded. Retry tracking, or finish this ride.
                </Text>
                <View style={s.row}>
                  <TouchableOpacity style={s.btnSm} onPress={onRetryTracking} disabled={busy}>
                    <Text style={s.btnTxt}>Retry tracking</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.btnSm} onPress={onStop} disabled={busy}>
                    <Text style={s.btnTxt}>Finish ride</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        )}

        {active && (
          <View style={s.card}>
            <Text style={s.txt}>points {active.point_count} · max gap {active.max_gap_s.toFixed(1)} s</Text>
            <Text style={s.txt}>filtered {km(active.distance_m)} km · raw {km(active.raw_distance_m)} km</Text>
            <Text style={s.txt}>untracked {mmss(active.untracked_gap_s)} ({Math.round(active.untracked_gap_m)} m not counted)</Text>
          </View>
        )}

        <View style={s.row}>
          <TouchableOpacity style={s.btnSm} onPress={() => Linking.openSettings()}>
            <Text style={s.btnTxt}>App settings</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.btnSm} onPress={async () => Share.share({ message: await buildReport() })}>
            <Text style={s.btnTxt}>Share report</Text>
          </TouchableOpacity>
        </View>
        {!!msg && <Text style={s.dim}>{msg}</Text>}

        <Text style={s.h2}>Rides</Text>
        {rides.map((r) => (
          <View key={r.id} style={s.card}>
            <Text style={s.txt}>
              {new Date(r.started_at).toLocaleString()} · {r.status}{r.needs_review ? ' · needs review' : ''}
            </Text>
            <Text style={s.dim}>
              {r.point_count} pts · filtered {km(r.distance_m)} km · raw {km(r.raw_distance_m)} km · max gap {r.max_gap_s.toFixed(1)} s
              {r.duration_s != null ? ` · ride ${mmss(r.duration_s)}` : ''}
              {r.tracked_s != null ? ` · tracked ${mmss(r.tracked_s)}` : ''}
              {r.status !== 'recording' ? ` · avg ${r.avg_speed_ms != null ? (r.avg_speed_ms * 3.6).toFixed(1) + ' km/h' : '-'}` : ''}
              {r.untracked_gap_s > 0 ? ` · untracked ${mmss(r.untracked_gap_s)}` : ''}
              {r.interrupted ? ` · interrupted x${r.interruption_count}` : ''}
              {r.integrity_issue ? ` · integrity: ${r.integrity_issue}` : ''}
            </Text>
          </View>
        ))}

        <Text style={s.h2}>Event log (latest first)</Text>
        {events.map((e) => (
          <Text key={e.id} style={s.log}>
            {new Date(e.ts).toLocaleTimeString()} {e.type} {e.detail ?? ''}
          </Text>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070D' },
  h1: { color: '#fff', fontSize: 20, fontWeight: '700' },
  h2: { color: '#fff', fontSize: 16, fontWeight: '600', marginTop: 18, marginBottom: 6 },
  txt: { color: '#E8EEFF', fontSize: 14 },
  dim: { color: '#8A96B5', fontSize: 12, marginVertical: 4 },
  log: { color: '#8A96B5', fontSize: 11, fontFamily: 'monospace' },
  btn: { backgroundColor: '#1E6BFF', padding: 18, borderRadius: 12, alignItems: 'center', marginVertical: 12 },
  btnSm: { backgroundColor: '#1E6BFF', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, marginRight: 8, marginTop: 8 },
  btnTxt: { color: '#fff', fontWeight: '700' },
  row: { flexDirection: 'row' },
  card: { backgroundColor: '#0B0F1A', padding: 12, borderRadius: 10, marginVertical: 4 },
  warn: { backgroundColor: '#3A2A00', padding: 12, borderRadius: 10, marginVertical: 8 },
});
