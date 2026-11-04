import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { TouchableOpacity, View } from '../../ui/neu/NeuAuto';
import { Text, TextInput } from '../../ui/neu/NeuText';
import { useFocusEffect } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import Screen from '../../ui/Screen';
import { colors, radii, spacing, typography } from '../../ui/theme';
import type { RootTabParamList } from '../../app/RootNavigator';
import { getSupabase, hasSupabaseConfig, signUp, resendVerification } from '../../data/remote/client';
import { getDb } from '../../data/local/db';
import { getMeta, setMeta } from '../../data/local/metaStore';
import { listAllDeadlines } from '../../data/local/deadlineStore';
import type { VehicleRow } from '../../data/local/vehicleStore';
import {
  createSyncRecoverySnapshot,
  deleteSyncRecoverySnapshot,
  hasSyncRecoverySnapshot,
  restoreSyncRecoverySnapshot,
} from '../../data/local/syncRecovery';
import { createSupabaseSyncRemote } from '../../data/sync/supabaseRemote';
import { runSync } from '../../data/sync/syncEngine';
import { classifyInitialSync } from '../../data/sync/initialSync';
import { findPossibleDuplicateVehicles, findSyncConflicts } from '../../data/sync/syncReview';
import type { SyncReport, SyncResolution, SyncResolutions } from '../../data/sync/types';

type Props = BottomTabScreenProps<RootTabParamList, 'Account'>;

// Account & sync (v1): email sign-in against Supabase and a manual "Sync now". The session
// persists across restarts (client storage), and every claim here is scoped to what the app
// currently does: manual sync for vehicles and reminders, with explicit choices for conflicts.

export default function AccountScreen(_props: Props) {
  const configAvailable = hasSupabaseConfig();

  const [checking, setChecking] = useState(configAvailable);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resendBusy, setResendBusy] = useState(false);
  const [resendNotice, setResendNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [report, setReport] = useState<SyncReport | null>(null);

  const refreshSession = useCallback(async () => {
    try {
      setRecoveryAvailable(await hasSyncRecoverySnapshot());
    } catch {
      setRecoveryAvailable(false);
    }
    if (!hasSupabaseConfig()) {
      setChecking(false);
      return;
    }
    try {
      const { data } = await getSupabase().auth.getSession();
      const user = data.session?.user;
      setSignedInAs(user ? (user.email ?? user.id) : null);
    } catch {
      setSignedInAs(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refreshSession();
    }, [refreshSession]),
  );

  const signIn = useCallback(async () => {
    setFormError(null);
    setNotice(null);
    const addr = email.trim().toLowerCase();
    if (!addr.includes('@')) {
      setFormError('Enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setFormError('Password must be at least 6 characters.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await getSupabase().auth.signInWithPassword({ email: addr, password });
      if (error) {
        setFormError(error.message);
        return;
      }
      setPassword('');
      await refreshSession();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [email, password, refreshSession]);

  const createAccount = useCallback(async () => {
    setFormError(null);
    setNotice(null);
    const addr = email.trim().toLowerCase();
    if (!addr.includes('@')) {
      setFormError('Enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setFormError('Password must be at least 6 characters.');
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await signUp(addr, password);
      if (error) {
        setFormError(error.message);
        return;
      }
      if (!data.session) {
        // Email confirmation is required: no session until the link is clicked.
        setPassword('');
        setPendingEmail(addr);
      } else {
        setPassword('');
        await refreshSession();
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [email, password, refreshSession]);

  const resendEmail = useCallback(async () => {
    if (!pendingEmail) return;
    setResendBusy(true);
    setResendNotice(null);
    try {
      const { error } = await resendVerification(pendingEmail);
      if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes('rate') || msg.includes('limit') || msg.includes('too many')) {
          setResendNotice('Too many requests — please wait a minute before trying again.');
        } else {
          setResendNotice(error.message);
        }
      } else {
        setResendNotice('Confirmation email sent. Check your inbox.');
      }
    } catch (e) {
      setResendNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setResendBusy(false);
    }
  }, [pendingEmail]);

  const signOut = useCallback(async () => {
    setBusy(true);
    setReport(null);
    setNotice(null);
    setFormError(null);
    try {
      await getSupabase().auth.signOut();
    } catch {
      // The server round-trip fails offline; fall back to a local sign-out so the user is
      // never stuck signed in with no way out. (Local scope only clears this device's session.)
      try {
        await getSupabase().auth.signOut({ scope: 'local' });
      } catch {
        // refreshSession below still re-reads whatever session state remains.
      }
    } finally {
      await refreshSession();
      setBusy(false);
    }
  }, [refreshSession]);

  const completeSync = useCallback(async (
    db: Awaited<ReturnType<typeof getDb>>,
    remote: ReturnType<typeof createSupabaseSyncRemote>,
    userId: string | null,
    resolutions: SyncResolutions = {},
  ) => {
    setSyncing(true);
    setFormError(null);
    setNotice(null);
    try {
      if (userId && !(await hasSyncRecoverySnapshot())) {
        await createSyncRecoverySnapshot();
        setRecoveryAvailable(true);
      }
      const result = await runSync(db, remote, { resolutions });
      setReport(result);
      if (userId && result.ok && result.skipped.length === 0) {
        await setMeta(db, 'account_sync_initialized:' + userId, '1');
        await deleteSyncRecoverySnapshot();
        setRecoveryAvailable(false);
      } else if (userId) {
        setRecoveryAvailable(await hasSyncRecoverySnapshot());
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
      try {
        setRecoveryAvailable(await hasSyncRecoverySnapshot());
      } catch {
        setRecoveryAvailable(false);
      }
    } finally {
      setSyncing(false);
    }
  }, []);

  const syncNow = useCallback(async () => {
    setReviewing(true);
    setFormError(null);
    setNotice(null);
    try {
      const db = await getDb();
      const remote = createSupabaseSyncRemote();
      const userId = await remote.getUserId();
      if (!userId) {
        await completeSync(db, remote, null);
        return;
      }

      const syncKey = 'account_sync_initialized:' + userId;
      const initialized = await getMeta(db, syncKey);
      // Include personal tables outside the current cloud-sync scope so a populated local
      // history can never be mistaken for an empty device during first account setup.
      const localTables = [
        'vehicles', 'rides', 'deadlines', 'mileage_entries', 'service_events',
        'part_installs', 'accessories', 'battery_state', 'component_overrides',
        'vehicle_documents', 'driver_profile',
      ];
      let localCount = 0;
      for (const table of localTables) {
        const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM ' + table);
        localCount += row?.count ?? 0;
      }
      const [models, cloudVehicles, cloudDeadlines, localVehicles, localDeadlines] = await Promise.all([
        remote.listCatalogModels(),
        remote.listUserVehicles(),
        remote.listUserDeadlines(),
        db.getAllAsync<VehicleRow>('SELECT * FROM vehicles'),
        listAllDeadlines(db),
      ]);
      const cloudCount = cloudVehicles.length + cloudDeadlines.length;
      const firstSyncState = initialized === '1' || initialized === 'pending'
        ? null
        : classifyInitialSync(localCount, cloudCount);
      const conflicts = findSyncConflicts(localVehicles, cloudVehicles, models, localDeadlines, cloudDeadlines);
      const possibleDuplicates = findPossibleDuplicateVehicles(localVehicles, cloudVehicles, models);
      const resolutions: SyncResolutions = { vehicles: {}, deadlines: {} };

      // Review each shared ID whose cloud and device values differ. The sync engine checks
      // again against its own latest pull, so a change after this preview cannot bypass review.
      for (const conflict of conflicts) {
        let localSummary = 'Unavailable';
        let cloudSummary = 'Unavailable';
        if (conflict.table === 'vehicles') {
          const local = localVehicles.find((row) => row.id === conflict.id);
          const cloud = cloudVehicles.find((row) => row.id === conflict.id);
          if (local) {
            localSummary = [local.nickname || [local.brand, local.model].filter(Boolean).join(' ') || 'Vehicle', local.model_year, local.plate].filter(Boolean).join(' · ');
          }
          if (cloud) {
            cloudSummary = [cloud.nickname || models.find((model) => model.id === cloud.model_id)?.modelName || 'Vehicle', cloud.model_year, cloud.plate].filter(Boolean).join(' · ');
          }
        } else {
          const local = localDeadlines.find((row) => row.id === conflict.id);
          const cloud = cloudDeadlines.find((row) => row.id === conflict.id);
          if (local) localSummary = [local.label || local.kind, local.due_date].join(' · ');
          if (cloud) cloudSummary = [cloud.label || cloud.kind, cloud.due_date].join(' · ');
        }
        const choice: SyncResolution | null = await new Promise((resolve) => {
          Alert.alert(
            'Review ' + (conflict.table === 'vehicles' ? 'vehicle' : 'reminder'),
            'The device and account versions differ in ' + conflict.fields.join(', ') + '.\n\nOn this device: ' + localSummary + '\nIn your account: ' + cloudSummary + '\n\nChoose which version to keep for this shared record.',
            [
              { text: 'Cancel sync', style: 'cancel', onPress: () => resolve(null) },
              { text: 'Keep device', onPress: () => resolve('local') },
              { text: 'Use account', onPress: () => resolve('account') },
            ],
            { cancelable: true, onDismiss: () => resolve(null) },
          );
        });
        if (!choice) return;
        if (conflict.table === 'vehicles') resolutions.vehicles![conflict.id] = choice;
        else resolutions.deadlines![conflict.id] = choice;
      }

      if (possibleDuplicates.length > 0) {
        const pairs = possibleDuplicates.slice(0, 5)
          .map((pair) => '• ' + pair.localLabel + ' ↔ ' + pair.accountLabel).join('\n');
        const keepSeparate = await new Promise<boolean>((resolve) => {
          Alert.alert(
            'Possible same vehicles',
            'These pairs have the same plate, catalog model, and year, but separate record IDs. Vehitra will keep them as separate vehicles; names alone are never used to combine records.\n\n' + pairs + (possibleDuplicates.length > 5 ? '\n… and ' + (possibleDuplicates.length - 5) + ' more' : ''),
            [
              { text: 'Cancel sync', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Keep separate and continue', onPress: () => resolve(true) },
            ],
            { cancelable: true, onDismiss: () => resolve(false) },
          );
        });
        if (!keepSeparate) return;
      }

      if (firstSyncState === 'review_required') {
        const localSyncable = await db.getFirstAsync<{ count: number }>(
          'SELECT (SELECT COUNT(*) FROM vehicles) + (SELECT COUNT(*) FROM deadlines) AS count',
        );
        const accepted = await new Promise<boolean>((resolve) => {
          Alert.alert(
            'Review local and account records',
            'This device has ' + (localSyncable?.count ?? 0) + ' syncable records; your account has ' + cloudCount + '. Shared records above require a choice. Other vehicles with different IDs will stay separate. Rides, odometer history, maintenance, parts, and documents remain local in this sync version.',
            [
              { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Continue with reviewed choices', onPress: () => resolve(true) },
            ],
            { cancelable: true, onDismiss: () => resolve(false) },
          );
        });
        if (!accepted) return;
      }

      const finish = async () => {
        if (firstSyncState) await setMeta(db, syncKey, 'pending');
        await completeSync(db, remote, userId, resolutions);
      };

      if (firstSyncState === 'backup' || firstSyncState === 'restore' || firstSyncState === 'empty') {
        const localSyncable = await db.getFirstAsync<{ count: number }>(
          'SELECT (SELECT COUNT(*) FROM vehicles) + (SELECT COUNT(*) FROM deadlines) AS count',
        );
        const title = firstSyncState === 'backup'
          ? 'Back up this device?'
          : firstSyncState === 'restore'
            ? 'Restore from your account?'
            : 'Connect account storage?';
        const message = firstSyncState === 'backup'
          ? 'This device has ' + localCount + ' personal records. Continue to upload the ' +
            (localSyncable?.count ?? 0) + ' vehicles and reminders supported by this sync version? Other record types stay on this device. Nothing uploads unless you confirm.'
          : firstSyncState === 'restore'
            ? 'Your account has ' + cloudCount + ' vehicles and reminders. Continue to restore them to this device? Nothing changes in your account.'
            : 'There are no personal records to transfer yet. Connect this device to your account storage?';
        const accepted = await new Promise<boolean>((resolve) => {
          Alert.alert(title, message, [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            {
              text: firstSyncState === 'backup' ? 'Back up' : firstSyncState === 'restore' ? 'Restore' : 'Continue',
              onPress: () => resolve(true),
            },
          ], { cancelable: true, onDismiss: () => resolve(false) });
        });
        if (accepted) await finish();
      } else {
        await finish();
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setReviewing(false);
    }
  }, [completeSync]);

  const restoreRecovery = useCallback(() => {
    Alert.alert(
      'Restore the saved local copy?',
      'Vehitra will restore vehicles and reminders to their pre-sync state, while keeping rides, maintenance history, documents, and newer local edits. Restart the app afterward to reload the restored data.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore copy',
          onPress: () => void (async () => {
            setRecovering(true);
            setFormError(null);
            try {
              await restoreSyncRecoverySnapshot();
              setReport(null);
              setNotice('The saved local copy was restored. Restart Vehitra before continuing.');
            } catch (e) {
              setFormError(e instanceof Error ? e.message : String(e));
            } finally {
              setRecovering(false);
            }
          })(),
        },
      ],
    );
  }, []);

  if (!configAvailable) {
    return (
      <Screen title="Account & sync" subtitle="Sign in and data sync">
        <View style={s.card}>
          <Text style={s.cardTitle}>Cloud sync is not configured</Text>
          <Text style={s.cardBody}>
            This build has no Supabase project set. Add EXPO_PUBLIC_SUPABASE_URL and
            EXPO_PUBLIC_SUPABASE_ANON_KEY to the environment and restart the app to enable
            sign-in and sync. Everything else in Vehitra keeps working without them.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      title="Account & sync"
      subtitle="Sign in and data sync"
      keyboardShouldPersistTaps="handled"
    >
      {checking ? (
        <ActivityIndicator color={colors.primary} style={s.loading} />
      ) : pendingEmail ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>Check your email</Text>
          <Text style={s.cardBody}>
            A confirmation link was sent to{' '}
            <Text style={[s.cardBody, { color: colors.text }]}>{pendingEmail}</Text>.
            Tap the link in the email to activate your account, then come back to sign in.
          </Text>

          {!!resendNotice && (
            <Text style={[
              s.notice,
              resendNotice.toLowerCase().includes('too many') || resendNotice.toLowerCase().includes('wait')
                ? s.warning
                : resendNotice.toLowerCase().includes('sent')
                  ? s.notice
                  : s.error,
            ]}>
              {resendNotice}
            </Text>
          )}

          <TouchableOpacity
            style={[s.btnPrimary, resendBusy && s.btnDisabled]}
            onPress={() => void resendEmail()}
            disabled={resendBusy}
            accessibilityRole="button"
          >
            <Text style={s.btnPrimaryTxt}>{resendBusy ? 'Sending…' : 'Resend confirmation email'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={s.btnGhost}
            onPress={() => setPendingEmail(null)}
            accessibilityRole="button"
          >
            <Text style={s.btnGhostTxt}>Back to sign in</Text>
          </TouchableOpacity>
        </View>
      ) : signedInAs ? (
        <>
          <View style={s.card}>
            <Text style={s.cardTitle}>Signed in</Text>
            <Text style={s.cardBody}>{signedInAs}</Text>

            <TouchableOpacity
              style={[s.btnPrimary, (syncing || reviewing) && s.btnDisabled]}
              onPress={() => void syncNow()}
              disabled={syncing || reviewing}
              accessibilityRole="button"
            >
              <Text style={s.btnPrimaryTxt}>{syncing ? 'Syncing…' : reviewing ? 'Reviewing…' : 'Sync now'}</Text>
            </TouchableOpacity>

            {report && <ReportCard report={report} />}

            <TouchableOpacity style={s.btnGhost} onPress={() => void signOut()} disabled={busy} accessibilityRole="button">
              <Text style={s.btnGhostTxt}>Sign out</Text>
            </TouchableOpacity>
          </View>

          <View style={s.card}>
            <Text style={s.cardTitle}>What syncing does</Text>
            <Text style={s.cardBody}>
              • Sync runs only when you tap Sync now   there is no background sync in v1.{'\n'}
              • Vehicles and reminders sync. Rides, odometer history, maintenance, parts,
              documents, and settings stay on this device.{'\n'}
              • Conflicting shared records pause for a device or account choice. Possible
              duplicate vehicles require the same plate, catalog model, and year to be flagged.{'\n'}
              • Rows Vehitra cannot represent in the cloud are reported after each sync instead
              of being dropped.
            </Text>
          </View>

          {!!formError && <Text style={s.error}>{formError}</Text>}
        </>
      ) : (
        <View style={s.card}>
          <Text style={s.cardTitle}>Sign in</Text>
          <Text style={s.hint}>
            Your account links this device to your cloud copy. You can keep using Vehitra fully
            offline without one.
          </Text>

          <Text style={s.fieldLabel}>Email</Text>
          <TextInput
            style={s.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            accessibilityLabel="Email"
          />

          <Text style={s.fieldLabel}>Password</Text>
          <TextInput
            style={s.input}
            value={password}
            onChangeText={setPassword}
            placeholder="At least 6 characters"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="password"
            textContentType="password"
            accessibilityLabel="Password"
          />

          {!!formError && <Text style={s.error}>{formError}</Text>}
          {!!notice && <Text style={s.notice}>{notice}</Text>}

          <TouchableOpacity
            style={[s.btnPrimary, busy && s.btnDisabled]}
            onPress={() => void signIn()}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text style={s.btnPrimaryTxt}>{busy ? 'Working…' : 'Sign in'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.btnGhost}
            onPress={() => void createAccount()}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text style={s.btnGhostTxt}>Create account</Text>
          </TouchableOpacity>
        </View>
      )}

      {recoveryAvailable && (
        <View style={s.card}>
          <Text style={s.cardTitle}>Local recovery copy available</Text>
          <Text style={s.cardBody}>
            A SQLite recovery copy was kept in Vehitra's private app storage after an incomplete sync. It stays on this device and has not been uploaded.
          </Text>
          <TouchableOpacity
            style={[s.btnGhost, recovering && s.btnDisabled]}
            onPress={restoreRecovery}
            disabled={recovering}
            accessibilityRole="button"
          >
            <Text style={s.btnGhostTxt}>{recovering ? 'Restoring…' : 'Restore saved local copy'}</Text>
          </TouchableOpacity>
        </View>
      )}

      <Text style={s.footnote}>
        Vehitra never stores your password; sign-in uses the Supabase session for this device.
      </Text>
    </Screen>
  );
}

function ReportCard({ report }: { report: SyncReport }) {
  if (!report.ok) {
    const reasonText =
      report.reason === 'signed_out'
        ? 'Sign in first, then try again.'
        : report.reason === 'not_configured'
          ? 'Cloud sync is not configured.'
          : report.reason === 'review_required'
            ? 'Account data changed after review. Review the listed records and try again.'
            : 'The sync did not finish; local rows stay available for the next try.';
    return (
      <View style={s.reportBox}>
        <Text style={s.reportTitle}>Sync did not complete</Text>
        <Text style={s.reportLine}>{reasonText}</Text>
        {report.errors.slice(0, 3).map((e, i) => (
          <Text key={i} style={s.reportLine}>
            {e}
          </Text>
        ))}
        {report.conflicts.slice(0, 3).map((conflict) => (
          <Text key={conflict.table + ':' + conflict.id} style={s.reportLine}>
            {conflict.table}: {conflict.fields.join(', ')} changed on both sides
          </Text>
        ))}
      </View>
    );
  }
  return (
    <View style={s.reportBox}>
      <Text style={s.reportTitle}>Sync complete</Text>
      <Text style={s.reportLine}>
        Vehicles: {report.vehicles.pushed} sent, {report.vehicles.pulled} received
      </Text>
      <Text style={s.reportLine}>
        Reminders: {report.deadlines.pushed} sent, {report.deadlines.pulled} received
      </Text>
      {report.skipped.map((s2) => (
        <Text key={`${s2.table}:${s2.id}`} style={s.reportSkip}>
          • Not synced ({s2.table}): {s2.reason}
        </Text>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  loading: { marginTop: spacing.xl },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  cardTitle: { ...typography.heading, marginBottom: spacing.xs },
  cardBody: { ...typography.body, color: colors.textMuted, lineHeight: 21 },
  hint: { ...typography.caption, marginBottom: spacing.md },
  fieldLabel: {
    ...typography.label,
    color: colors.textMuted,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    ...typography.body,
  },
  error: { ...typography.caption, color: colors.danger, marginTop: spacing.sm },
  notice: { ...typography.caption, color: colors.success, marginTop: spacing.sm },
  btnPrimary: {
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
  },
  btnPrimaryTxt: { ...typography.body, color: colors.primaryInk, fontWeight: '700' },
  btnGhost: {
    alignItems: 'center',
    borderColor: colors.primaryBright,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  btnGhostTxt: { ...typography.body, color: colors.primaryBright, fontWeight: '600' },
  btnDisabled: { opacity: 0.6 },
  reportBox: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.sm,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  reportTitle: { ...typography.label, marginBottom: spacing.xs },
  reportLine: { ...typography.caption, marginTop: spacing.xs },
  reportSkip: { ...typography.caption, color: colors.warningText, marginTop: spacing.xs },
  warning: { ...typography.caption, color: colors.warningText, marginTop: spacing.sm },
  footnote: { ...typography.caption, textAlign: 'center', marginTop: spacing.md },
});
