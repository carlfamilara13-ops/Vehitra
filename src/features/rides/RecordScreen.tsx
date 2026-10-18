import React, { useCallback, useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getDb } from '../../data/local/db';
import { getActiveRideId, getRide, type RideRow } from '../../data/local/ridesStore';
import { getActiveVehicle, vehicleDisplayName } from '../../data/local/vehicleStore';
import Screen from '../../ui/Screen';
import { colors, radii, spacing, typography } from '../../ui/theme';
import { ensurePermissions } from './tracking/permissions';
import { runStartFlow } from './tracking/startFlow';
import { resumeIfInterrupted, startRide, stopRide } from './tracking/tracker';

type Blocked = { message: string; canAskAgain: boolean };

const km = (m: number) => (m / 1000).toFixed(2);
const mmss = (s: number) => `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;

// User-facing ride recording. Reuses the existing tracking engine; the GPS internals
// themselves stay untouched and remain inspectable from Settings > Diagnostics.
export default function RecordScreen() {
  const [active, setActive] = useState<RideRow | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const db = await getDb();
    const id = await getActiveRideId(db);
    setActive(id ? await getRide(db, id) : null);
  }, []);

  useEffect(() => {
    resumeIfInterrupted()
      .then(refresh)
      .catch((e) => setMsg(String(e)));
  }, [refresh]);

  const activeId = active?.id ?? null;
  useEffect(() => {
    if (!activeId) return;
    const t = setInterval(() => refresh().catch(() => undefined), 1000);
    return () => clearInterval(t);
  }, [activeId, refresh]);

  const onStart = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const out = await runStartFlow({
        ensurePermissions,
        // Resolve the active vehicle once, immediately before recording starts (after any permission
        // prompt), so a selection changed while the prompt was open is respected. No selection -> null.
        // The vehicle's name is snapshotted onto the ride here and never recomputed afterwards.
        startRide: async () => {
          const db = await getDb();
          const vehicle = await getActiveVehicle(db);
          return startRide(vehicle?.id ?? null, vehicle ? vehicleDisplayName(vehicle) : null);
        },
      });
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
      await refresh().catch(() => undefined);
    }
  };

  const onStop = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await stopRide('finished');
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
      await refresh().catch(() => undefined);
    }
  };

  return (
    <Screen title="Record" subtitle="Ride tracking" scroll={!active}>
      {blocked && (
        <View style={s.warn}>
          <Text style={s.warnText}>{blocked.message}</Text>
          {!blocked.canAskAgain && (
            <Text style={s.warnHint}>
              Android will not show the permission prompt again. Allow location "all the time" in app settings, then
              return.
            </Text>
          )}
          <View style={s.row}>
            <TouchableOpacity style={s.btnGhost} onPress={onStart} disabled={busy} accessibilityRole="button">
              <Text style={s.btnGhostTxt}>Try again</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.btnGhost}
              onPress={() => Linking.openSettings()}
              disabled={busy}
              accessibilityRole="button"
            >
              <Text style={s.btnGhostTxt}>Open settings</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {warnings.map((w) => (
        <Text key={w} style={s.hint}>{w}</Text>
      ))}

      <View style={s.status}>
        <Text style={s.statusKicker}>{active ? 'RECORDING' : 'READY'}</Text>
        <Text style={s.statusTitle}>{active ? 'Ride in progress' : 'No active ride'}</Text>
        {active ? (
          <>
            <Text style={s.statusMeta}>
              {km(active.distance_m)} km · {active.point_count} points
            </Text>
            {active.interrupted === 1 && (
              <Text style={s.statusWarn}>
                Recording was interrupted ({mmss(active.interruption_s)} without points). Stopping now saves what was
                tracked.
              </Text>
            )}
          </>
        ) : (
          <Text style={s.statusMeta}>Start a ride to record your route in the background.</Text>
        )}
      </View>

      {active ? (
        <TouchableOpacity
          style={[s.btn, s.btnStop, busy && s.btnDisabled]}
          onPress={onStop}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={s.btnTxt}>STOP RIDE</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[s.btn, busy && s.btnDisabled]}
          onPress={onStart}
          disabled={busy}
          accessibilityRole="button"
        >
          <Text style={s.btnTxt}>START RIDE</Text>
        </TouchableOpacity>
      )}

      {!!msg && <Text style={s.hint}>{msg}</Text>}
      <Text style={s.footnote}>Recording continues with the screen off. Diagnostics live under Settings.</Text>
      {active && <View style={s.fill} />}
    </Screen>
  );
}

const s = StyleSheet.create({
  status: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  statusKicker: { ...typography.caption, color: colors.primary, fontWeight: '700', letterSpacing: 1.5 },
  statusTitle: { ...typography.heading, marginTop: spacing.xs },
  statusMeta: { ...typography.body, color: colors.textMuted, marginTop: spacing.sm },
  statusWarn: { ...typography.body, color: colors.warningText, marginTop: spacing.sm, lineHeight: 20 },
  btn: {
    backgroundColor: colors.primary,
    padding: spacing.lg,
    borderRadius: radii.md,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  btnStop: { backgroundColor: colors.danger },
  btnDisabled: { opacity: 0.5 },
  btnTxt: { color: colors.text, fontWeight: '700', fontSize: 15, letterSpacing: 0.5 },
  btnGhost: {
    borderColor: colors.primary,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginRight: spacing.sm,
    marginTop: spacing.sm,
  },
  btnGhostTxt: { color: colors.primary, fontWeight: '600' },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  warn: {
    backgroundColor: colors.warningSurface,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  warnText: { ...typography.body },
  warnHint: { ...typography.caption, marginTop: spacing.sm, lineHeight: 18 },
  hint: { ...typography.caption, marginVertical: spacing.xs },
  footnote: { ...typography.caption, marginTop: spacing.lg, textAlign: 'center' },
  fill: { flex: 1 },
});
