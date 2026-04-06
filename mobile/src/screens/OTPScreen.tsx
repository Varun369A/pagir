/**
 * PAGIR 2 — OTP Verification Screen
 *
 * Handles two flows:
 *   standard  — verifyOtp thunk → stores pagirId → Home
 *   email-only — apiClient.verifyOtpByEmail → stores pagirId → Home
 *
 * Features:
 *   - 6-box OTP input with auto-advance
 *   - 60s resend countdown
 *   - Recovery badge for email-only mode
 *   - Dark theme
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useDispatch, useSelector } from 'react-redux'
import type { RootStackParamList } from '../navigation/AppNavigator'
import { verifyOtp } from '../store/authSlice'
import type { RootState, AppDispatch } from '../store'
import { apiClient } from '../store/apiClient'
import { identityManager } from '../services/IdentityManager'
import { Colors, Spacing, Radius, Typography } from '../theme'

type Props = NativeStackScreenProps<RootStackParamList, 'OTP'>

const OTP_LENGTH = 6
const RESEND_SECONDS = 60

export default function OTPScreen({ navigation, route }: Props) {
  const { phoneNumber, email, isNewUser, displayName, isEmailOnly } = route.params
  const dispatch = useDispatch<AppDispatch>()
  const { loading, error } = useSelector((s: RootState) => s.auth)

  const [digits, setDigits]         = useState<string[]>(Array(OTP_LENGTH).fill(''))
  const [countdown, setCountdown]   = useState(RESEND_SECONDS)
  const [resending, setResending]   = useState(false)
  const [emailVerifying, setEmailVerifying] = useState(false)
  const [emailError, setEmailError] = useState<string | null>(null)

  const refs = useRef<Array<TextInput | null>>(Array(OTP_LENGTH).fill(null))
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    startCountdown()
    return () => { if (countdownRef.current) clearInterval(countdownRef.current) }
  }, [])

  function startCountdown() {
    setCountdown(RESEND_SECONDS)
    if (countdownRef.current) clearInterval(countdownRef.current)
    countdownRef.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { clearInterval(countdownRef.current!); return 0 }
        return c - 1
      })
    }, 1000)
  }

  const otp = digits.join('')
  const isComplete = otp.length === OTP_LENGTH

  // ─── Input handling ─────────────────────────────────────────────────────────

  function handleDigit(idx: number, val: string) {
    const ch = val.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[idx] = ch
    setDigits(next)
    if (ch && idx < OTP_LENGTH - 1) refs.current[idx + 1]?.focus()
    if (next.join('').length === OTP_LENGTH) {
      // Auto-submit
      handleVerify(next.join(''))
    }
  }

  function handleKeyPress(idx: number, key: string) {
    if (key === 'Backspace' && !digits[idx] && idx > 0) {
      const next = [...digits]
      next[idx - 1] = ''
      setDigits(next)
      refs.current[idx - 1]?.focus()
    }
  }

  // ─── Verify ─────────────────────────────────────────────────────────────────

  const handleVerify = useCallback(async (code = otp) => {
    if (code.length !== OTP_LENGTH) return
    if (loading || emailVerifying) return

    if (isEmailOnly) {
      setEmailVerifying(true)
      setEmailError(null)
      try {
        const result = await apiClient.verifyOtpByEmail(email, code)
        if (result.pagirId) {
          await identityManager.storePagirId(result.pagirId)
          await AsyncStorage.setItem('pagir2:registered_id', result.pagirId).catch(() => {})
        }
        navigation.reset({ index: 0, routes: [{ name: 'Home' }] })
      } catch (err: any) {
        setEmailError(err?.message ?? 'Invalid code. Please try again.')
      } finally {
        setEmailVerifying(false)
      }
      return
    }

    // Standard verify
    const result = await dispatch(verifyOtp({
      phoneNumber,
      otp: code,
      displayName,
      platform: Platform.OS as 'android' | 'ios',
    }))

    if (verifyOtp.fulfilled.match(result)) {
      const serverId = (result.payload as any)?.pagirId
      if (serverId) {
        await identityManager.storePagirId(serverId)
      }
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] })
    }
  }, [otp, loading, emailVerifying, isEmailOnly, email, phoneNumber, displayName, dispatch, navigation])

  // ─── Resend ─────────────────────────────────────────────────────────────────

  const handleResend = useCallback(async () => {
    if (countdown > 0 || resending) return

    setResending(true)
    try {
      if (isEmailOnly) {
        await apiClient.requestOtpByEmail(email)
      } else {
        await apiClient.requestOtp(phoneNumber, email, Platform.OS as 'android' | 'ios')
      }
      setDigits(Array(OTP_LENGTH).fill(''))
      refs.current[0]?.focus()
      startCountdown()
      Alert.alert('Code resent', 'A new verification code has been sent.')
    } catch (err: any) {
      Alert.alert('Failed to resend', err?.message ?? 'Please try again.')
    } finally {
      setResending(false)
    }
  }, [countdown, resending, isEmailOnly, email, phoneNumber])

  const displayedError = isEmailOnly ? emailError : error
  const isVerifying    = isEmailOnly ? emailVerifying : loading

  return (
    <KeyboardAvoidingView style={S.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={S.scroll} keyboardShouldPersistTaps="handled">

        {/* Back */}
        <TouchableOpacity style={S.back} onPress={() => navigation.goBack()}>
          <Text style={S.backText}>← Back</Text>
        </TouchableOpacity>

        {/* Header */}
        <View style={S.header}>
          <View style={S.logoMark}><Text style={S.logoText}>P</Text></View>
          <Text style={S.title}>Enter verification code</Text>
          <Text style={S.subtitle}>
            {isEmailOnly
              ? `Code sent to ${email}`
              : `Code sent to ${email}`}
          </Text>
          {isEmailOnly && (
            <View style={S.recoveryBadge}>
              <Text style={S.recoveryBadgeText}>Email recovery mode</Text>
            </View>
          )}
        </View>

        {/* OTP boxes */}
        <View style={S.otpRow}>
          {Array.from({ length: OTP_LENGTH }).map((_, i) => (
            <TextInput
              key={i}
              ref={r => { refs.current[i] = r }}
              style={[S.otpBox, digits[i] ? S.otpBoxFilled : null]}
              value={digits[i]}
              onChangeText={v => handleDigit(i, v)}
              onKeyPress={({ nativeEvent }) => handleKeyPress(i, nativeEvent.key)}
              keyboardType="number-pad"
              maxLength={1}
              textAlign="center"
              selectTextOnFocus
            />
          ))}
        </View>

        {/* Error */}
        {displayedError && (
          <View style={S.errorBox}><Text style={S.errorText}>{displayedError}</Text></View>
        )}

        {/* Verify button */}
        <TouchableOpacity
          style={[S.btn, (!isComplete || isVerifying) && S.btnOff]}
          onPress={() => handleVerify()} disabled={!isComplete || isVerifying}
        >
          {isVerifying
            ? <ActivityIndicator color={Colors.textInverse} />
            : <Text style={S.btnText}>Verify</Text>
          }
        </TouchableOpacity>

        {/* Resend */}
        <TouchableOpacity
          style={[S.resendBtn, (countdown > 0 || resending) && S.resendBtnOff]}
          onPress={handleResend}
          disabled={countdown > 0 || resending}
        >
          {resending
            ? <ActivityIndicator size="small" color={Colors.primary} />
            : <Text style={[S.resendText, countdown > 0 && S.resendTextDim]}>
                {countdown > 0 ? `Resend code in ${countdown}s` : 'Resend code'}
              </Text>
          }
        </TouchableOpacity>

        {/* Destination hint */}
        <View style={S.deliveryNote}>
          <Text style={S.deliveryText}>
            Code valid for 10 minutes. Check your spam folder if not received.
          </Text>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  scroll:    { flexGrow: 1, paddingHorizontal: Spacing.xl, paddingTop: 20, paddingBottom: 40 },

  back:     { marginBottom: 32 },
  backText: { fontSize: 16, color: Colors.primary, fontWeight: '600' },

  header:   { alignItems: 'center', marginBottom: 40 },
  logoMark: { width: 72, height: 72, borderRadius: 20, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  logoText: { fontSize: 36, fontWeight: '700', color: Colors.primary },
  title:    { ...Typography['3xl'], color: Colors.textPrimary, marginBottom: 8, textAlign: 'center' },
  subtitle: { ...Typography.body, textAlign: 'center', lineHeight: 20 },

  recoveryBadge: { marginTop: 12, backgroundColor: Colors.primaryDeep, borderRadius: Radius.sm, paddingHorizontal: Spacing.base, paddingVertical: 6, borderWidth: 1, borderColor: Colors.primary },
  recoveryBadgeText: { fontSize: 12, color: Colors.primary, fontWeight: '600' },

  otpRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 32 },
  otpBox: {
    width: 48, height: 60, borderRadius: Radius.md, borderWidth: 1.5,
    borderColor: Colors.border, backgroundColor: Colors.surface,
    fontSize: 24, fontWeight: '700', color: Colors.textPrimary,
    textAlign: 'center',
  },
  otpBoxFilled: { borderColor: Colors.primary },

  errorBox:   { backgroundColor: Colors.dangerBg, borderRadius: Radius.sm, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: Colors.danger },
  errorText:  { color: Colors.danger, fontSize: 14 },

  btn:     { height: 54, backgroundColor: Colors.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  btnOff:  { backgroundColor: Colors.primaryDeep },
  btnText: { color: Colors.textInverse, fontSize: 16, fontWeight: '700' },

  resendBtn:     { alignItems: 'center', paddingVertical: 12 },
  resendBtnOff:  {},
  resendText:    { fontSize: 15, color: Colors.primary, fontWeight: '600' },
  resendTextDim: { color: Colors.textMuted },

  deliveryNote: { marginTop: 24, padding: Spacing.base, backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border },
  deliveryText: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 18 },
})
