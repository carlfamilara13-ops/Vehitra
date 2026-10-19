import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import Screen from '../../ui/Screen';
import { colors, radii, spacing, typography } from '../../ui/theme';
import type { RootTabParamList } from '../../app/RootNavigator';
import { getSupabase, hasSupabaseConfig } from '../../data/remote/client';
import { getDb } from '../../data/local/db';
import { createSupabaseSyncRemote } from '../../data/sync/supabaseRemote';
import { runSync } from '../../data/sync/syncEngine';
import type { SyncReport } from '../../data/sync/types';

type Props = BottomTabScreenProps<RootTabParamList, 'Account'>;

// Account & sync (v1): email sign-in against Supabase and a manual "Sync now". The session
// persists across restarts (client storage), and every claim here is scoped to what the app
// actually does — manual sync, last-write-wins, vehicles + reminders only.

export default function AccountScreen(_props: Props) {
  const configAvailable = hasSupabaseConfig();

  const [checking, setChecking] = useState(configAvailable);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [report, setReport] = useState<SyncReport | null>(null);

  const refreshSession = useCallback(async () => {
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
      const { data, error } = await getSupabase().auth.signUp({ email: addr, password });
      if (error) {
        setFormError(error.message);
        return;
      }
      if (!data.session) {
        // Email confirmation is on in the cloud project: no session until the link is clicked.
        setNotice('Account created. Check your email to confirm your address, then sign in.');
        setPassword('');
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

  const syncNow = useCallback(async () => {
    setSyncing(true);
    setFormError(null);
    try {
      const db = await getDb();
      const result = await runSync(db, createSupabaseSyncRemote());
      setReport(result);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
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
      ) : signedInAs ? (
        <>
          <View style={s.card}>
            <Text style={s.cardTitle}>Signed in</Text>
            <Text style={s.cardBody}>{signedInAs}</Text>

            <TouchableOpacity
              style={[s.btnPrimary, syncing && s.btnDisabled]}
              onPress={() => void syncNow()}
              disabled={syncing}
              accessibilityRole="button"
            >
              <Text style={s.btnPrimaryTxt}>{syncing ? 'Syncing…' : 'Sync now'}</Text>
            </TouchableOpacity>

            {report && <ReportCard report={report} />}

            <TouchableOpacity style={s.btnGhost} onPress={() => void signOut()} disabled={busy} accessibilityRole="button">
              <Text style={s.btnGhostTxt}>Sign out</Text>
            </TouchableOpacity>
          </View>

          <View style={s.card}>
            <Text style={s.cardTitle}>What syncing does</Text>
            <Text style={s.cardBody}>
              • Sync runs only when you tap Sync now — there is no background sync in v1.{'\n'}
              • Vehicles and reminders sync. Rides, odometer readings, accessories, battery
              check-ins and settings stay on this device.{'\n'}
              • If both sides changed, the newer edit wins (last write wins by edit time).{'\n'}
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
          : 'The sync did not finish; nothing was lost — local rows stay pending for the next try.';
    return (
      <View style={s.reportBox}>
        <Text style={s.reportTitle}>Sync did not complete</Text>
        <Text style={s.reportLine}>{reasonText}</Text>
        {report.errors.slice(0, 3).map((e, i) => (
          <Text key={i} style={s.reportLine}>
            {e}
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
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  btnPrimaryTxt: { ...typography.body, color: '#FFFFFF', fontWeight: '700' },
  btnGhost: { alignItems: 'center', paddingVertical: spacing.sm + 2, marginTop: spacing.xs },
  btnGhostTxt: { ...typography.body, color: colors.primary, fontWeight: '600' },
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
  footnote: { ...typography.caption, textAlign: 'center', marginTop: spacing.md },
});
