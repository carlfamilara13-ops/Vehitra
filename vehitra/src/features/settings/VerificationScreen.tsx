import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { View, TouchableOpacity } from '../../ui/neu/NeuAuto';
import { Text } from '../../ui/neu/NeuText';
import Screen from '../../ui/Screen';
import { colors, radii, spacing, typography } from '../../ui/theme';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { RootTabParamList } from '../../app/RootNavigator';
import { verifyEmailOtp } from '../../data/remote/client';

type Props = BottomTabScreenProps<RootTabParamList, 'Verification'>;

type VerificationState = 'loading' | 'success' | 'expired' | 'already_used' | 'invalid' | 'error';

function classifyError(message: string | undefined): VerificationState {
  if (!message) return 'error';
  const m = message.toLowerCase();
  if (m.includes('expired') || m.includes('otp expired')) return 'expired';
  if (
    m.includes('already confirmed') ||
    m.includes('already been used') ||
    m.includes('email link is invalid or has already been used')
  ) return 'already_used';
  if (m.includes('invalid') || m.includes('token')) return 'invalid';
  return 'error';
}

function classifyUrlError(error: string): VerificationState {
  const e = error.toLowerCase();
  if (e.includes('expired') || e.includes('otp_expired')) return 'expired';
  if (e.includes('already') || e.includes('used')) return 'already_used';
  if (e.includes('access_denied') || e.includes('invalid')) return 'invalid';
  return 'error';
}

export default function VerificationScreen({ route, navigation }: Props) {
  const params = route.params;

  const [state, setState] = useState<VerificationState>('loading');
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  // Prevent double-processing if the component re-mounts with the same token_hash.
  const processedHash = useRef<string | null>(null);

  useEffect(() => {
    // Error was already classified by the URL parser — no network call needed.
    if ('error' in params) {
      const classified = classifyUrlError(params.error);
      setState(classified);
      if (classified === 'error') setErrorDetail(params.error_description);
      return;
    }

    const { token_hash } = params;
    if (processedHash.current === token_hash) return;
    processedHash.current = token_hash;

    void (async () => {
      const { ok, error } = await verifyEmailOtp(token_hash);
      if (ok) {
        setState('success');
      } else {
        const classified = classifyError(error);
        setState(classified);
        if (classified === 'error') setErrorDetail(error ?? 'Unknown error');
      }
    })();
  }, [params]);

  const goToAccount = () => navigation.navigate('Account');

  return (
    <Screen title="Email verification" subtitle="Confirming your address">
      <View style={s.card}>
        {state === 'loading' && (
          <>
            <ActivityIndicator color={colors.primary} style={s.spinner} />
            <Text style={s.body}>Verifying your email address…</Text>
          </>
        )}

        {state === 'success' && (
          <>
            <Text style={s.heading}>Email confirmed</Text>
            <Text style={s.body}>Your address has been verified. You can now sign in.</Text>
            <TouchableOpacity style={s.btn} onPress={goToAccount} accessibilityRole="button">
              <Text style={s.btnTxt}>Go to sign in</Text>
            </TouchableOpacity>
          </>
        )}

        {state === 'expired' && (
          <>
            <Text style={s.heading}>Link expired</Text>
            <Text style={s.body}>
              This confirmation link has expired. Request a new one from the sign-in screen.
            </Text>
            <TouchableOpacity style={s.btn} onPress={goToAccount} accessibilityRole="button">
              <Text style={s.btnTxt}>Back to sign in</Text>
            </TouchableOpacity>
          </>
        )}

        {state === 'already_used' && (
          <>
            <Text style={s.heading}>Already confirmed</Text>
            <Text style={s.body}>
              This link has already been used. Your email is confirmed — go ahead and sign in.
            </Text>
            <TouchableOpacity style={s.btn} onPress={goToAccount} accessibilityRole="button">
              <Text style={s.btnTxt}>Go to sign in</Text>
            </TouchableOpacity>
          </>
        )}

        {state === 'invalid' && (
          <>
            <Text style={s.heading}>Invalid link</Text>
            <Text style={s.body}>
              This confirmation link is not valid. Try requesting a new one from the sign-in screen.
            </Text>
            <TouchableOpacity style={s.btn} onPress={goToAccount} accessibilityRole="button">
              <Text style={s.btnTxt}>Back to sign in</Text>
            </TouchableOpacity>
          </>
        )}

        {state === 'error' && (
          <>
            <Text style={s.heading}>Verification failed</Text>
            <Text style={s.body}>Something went wrong while confirming your email.</Text>
            {!!errorDetail && <Text style={s.errorDetail}>{errorDetail}</Text>}
            <TouchableOpacity style={s.btn} onPress={goToAccount} accessibilityRole="button">
              <Text style={s.btnTxt}>Back to sign in</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </Screen>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    alignItems: 'center',
  },
  spinner: { marginVertical: spacing.xl },
  heading: { ...typography.heading, marginBottom: spacing.sm, textAlign: 'center' },
  body: { ...typography.body, color: colors.textMuted, textAlign: 'center', lineHeight: 22 },
  errorDetail: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  btn: {
    backgroundColor: colors.primary,
    borderRadius: radii.sm,
    minHeight: 48,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
    alignSelf: 'stretch',
  },
  btnTxt: { ...typography.body, color: colors.primaryInk, fontWeight: '700' },
});
