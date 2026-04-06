/**
 * PAGIR 2 — Login Screen
 *
 * Two modes:
 *   phone — standard: phone + email → OTP → Home
 *   email — recovery: email only → OTP (email-only flow) → Home
 *
 * Mode toggle is a segmented control at the top of the form.
 */

import React, { useCallback, useState } from 'react'
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView,
  Modal, Platform, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useDispatch, useSelector } from 'react-redux'
import type { RootStackParamList } from '../navigation/AppNavigator'
import { requestOtp } from '../store/authSlice'
import type { RootState, AppDispatch } from '../store'
import { apiClient } from '../store/apiClient'
import { Colors, Spacing, Radius, Typography } from '../theme'

type Props = NativeStackScreenProps<RootStackParamList, 'Login'>
type Mode  = 'phone' | 'email'

const COUNTRY_CODES: Record<string, string> = {
  IN: '+91', US: '+1', GB: '+44', AU: '+61', CA: '+1',
  DE: '+49', FR: '+33', JP: '+81', SG: '+65', AE: '+971',
  PK: '+92', BD: '+880', MY: '+60', ID: '+62', NG: '+234',
  BR: '+55', MX: '+52', ZA: '+27', EG: '+20', IT: '+39',
}

const COUNTRY_LIST = Object.entries({
  'India': 'IN', 'United States': 'US', 'United Kingdom': 'GB',
  'Australia': 'AU', 'Canada': 'CA', 'Germany': 'DE', 'France': 'FR',
  'Japan': 'JP', 'Singapore': 'SG', 'UAE': 'AE', 'Pakistan': 'PK',
  'Bangladesh': 'BD', 'Malaysia': 'MY', 'Indonesia': 'ID',
  'Nigeria': 'NG', 'Brazil': 'BR', 'Mexico': 'MX', 'South Africa': 'ZA',
  'Egypt': 'EG', 'Italy': 'IT',
}).map(([name, code]) => ({ name, code, dial: COUNTRY_CODES[code] ?? '+1' }))
  .sort((a, b) => a.name.localeCompare(b.name))

export default function LoginScreen({ navigation }: Props) {
  const dispatch = useDispatch<AppDispatch>()
  const { loading, error } = useSelector((s: RootState) => s.auth)

  const [mode, setMode]             = useState<Mode>('phone')
  const [phone, setPhone]           = useState('')
  const [dialCode, setDialCode]     = useState('+91')
  const [email, setEmail]           = useState('')
  const [showPicker, setShowPicker] = useState(false)
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailError, setEmailError]     = useState<string | null>(null)

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const isPhoneValid = phone.replace(/\D/g, '').length >= 7

  // Phone mode: need both phone and email
  const phoneFormValid = isPhoneValid && isValidEmail
  // Email mode: just email
  const emailFormValid = isValidEmail

  const handlePhoneContinue = useCallback(async () => {
    if (!phoneFormValid || loading) return

    const fullPhone = `${dialCode}${phone.replace(/\D/g, '')}`
    const result = await dispatch(requestOtp({
      phoneNumber: fullPhone,
      email: email.trim().toLowerCase(),
      platform: Platform.OS as 'android' | 'ios',
    }))

    if (requestOtp.fulfilled.match(result)) {
      navigation.navigate('OTP', {
        phoneNumber: fullPhone,
        email:       email.trim().toLowerCase(),
        isNewUser:   false,
      })
      return
    }

    const msg = ((result.error?.message ?? '') + (result.payload as string ?? '')).toLowerCase()
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('econnrefused')) {
      Alert.alert('No Connection', 'Cannot reach PAGIR servers. Check your internet connection.')
    }
  }, [phoneFormValid, loading, dialCode, phone, email, dispatch, navigation])

  const handleEmailContinue = useCallback(async () => {
    if (!emailFormValid || emailLoading) return

    setEmailLoading(true)
    setEmailError(null)
    try {
      await apiClient.requestOtpByEmail(email.trim().toLowerCase())
      navigation.navigate('OTP', {
        phoneNumber: '',
        email:       email.trim().toLowerCase(),
        isNewUser:   false,
        isEmailOnly: true,
      })
    } catch (err: any) {
      const msg = (err?.message ?? '').toLowerCase()
      if (msg.includes('not found') || msg.includes('no account')) {
        setEmailError('No account found for this email address.')
      } else if (msg.includes('network') || msg.includes('fetch')) {
        setEmailError('No connection. Check your internet and try again.')
      } else {
        setEmailError(err?.message ?? 'Failed to send code. Please try again.')
      }
    } finally {
      setEmailLoading(false)
    }
  }, [emailFormValid, emailLoading, email, navigation])

  return (
    <KeyboardAvoidingView style={S.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={S.scroll} keyboardShouldPersistTaps="handled">

        {/* Header */}
        <View style={S.header}>
          <View style={S.logoMark}><Text style={S.logoText}>P</Text></View>
          <Text style={S.title}>Sign in to PAGIR</Text>
          <Text style={S.subtitle}>Enter your phone number or use email recovery</Text>
        </View>

        {/* Mode toggle */}
        <View style={S.segmented}>
          <TouchableOpacity
            style={[S.segBtn, mode === 'phone' && S.segBtnActive]}
            onPress={() => { setMode('phone'); setEmailError(null) }}
          >
            <Text style={[S.segText, mode === 'phone' && S.segTextActive]}>Phone number</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[S.segBtn, mode === 'email' && S.segBtnActive]}
            onPress={() => { setMode('email'); setEmailError(null) }}
          >
            <Text style={[S.segText, mode === 'email' && S.segTextActive]}>Email recovery</Text>
          </TouchableOpacity>
        </View>

        {mode === 'phone' ? (
          <>
            {/* Phone */}
            <View style={S.field}>
              <Text style={S.label}>Phone number</Text>
              <View style={S.phoneRow}>
                <TouchableOpacity style={S.dialBtn} onPress={() => setShowPicker(true)}>
                  <Text style={S.dialText}>{dialCode} ▾</Text>
                </TouchableOpacity>
                <TextInput style={[S.input, S.phoneInput]} placeholder="Mobile number"
                  placeholderTextColor={Colors.textMuted} value={phone} onChangeText={setPhone}
                  keyboardType="phone-pad" maxLength={15} />
              </View>
            </View>

            {/* Email (for OTP delivery) */}
            <View style={S.field}>
              <Text style={S.label}>Email address</Text>
              <TextInput
                style={[S.input, email.length > 0 && !isValidEmail && S.inputErr]}
                placeholder="you@example.com" placeholderTextColor={Colors.textMuted}
                value={email} onChangeText={setEmail}
                autoCapitalize="none" keyboardType="email-address" maxLength={254} />
              <Text style={S.hint}>Verification code will be sent here.</Text>
            </View>

            {error && (
              <View style={S.errorBox}><Text style={S.errorText}>{error}</Text></View>
            )}

            <TouchableOpacity
              style={[S.btn, (!phoneFormValid || loading) && S.btnOff]}
              onPress={handlePhoneContinue} disabled={!phoneFormValid || loading}
            >
              {loading
                ? <ActivityIndicator color={Colors.textInverse} />
                : <Text style={S.btnText}>Send verification code</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity style={S.switchMode} onPress={() => setMode('email')}>
              <Text style={S.switchModeText}>
                Forgot phone number? <Text style={S.switchModeBold}>Use email instead</Text>
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            {/* Email-only recovery */}
            <View style={S.recoveryBadge}>
              <Text style={S.recoveryBadgeText}>Recovery mode — no phone needed</Text>
            </View>

            <View style={S.field}>
              <Text style={S.label}>Your email address</Text>
              <TextInput
                style={[S.input, email.length > 0 && !isValidEmail && S.inputErr]}
                placeholder="you@example.com" placeholderTextColor={Colors.textMuted}
                value={email} onChangeText={setEmail}
                autoCapitalize="none" keyboardType="email-address" maxLength={254} />
              <Text style={S.hint}>We'll send a one-time code to this address.</Text>
            </View>

            {emailError && (
              <View style={S.errorBox}><Text style={S.errorText}>{emailError}</Text></View>
            )}

            <TouchableOpacity
              style={[S.btn, (!emailFormValid || emailLoading) && S.btnOff]}
              onPress={handleEmailContinue} disabled={!emailFormValid || emailLoading}
            >
              {emailLoading
                ? <ActivityIndicator color={Colors.textInverse} />
                : <Text style={S.btnText}>Send code to email</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity style={S.switchMode} onPress={() => setMode('phone')}>
              <Text style={S.switchModeText}>
                Remember your phone? <Text style={S.switchModeBold}>Sign in with phone</Text>
              </Text>
            </TouchableOpacity>
          </>
        )}

        <View style={S.dividerRow}>
          <View style={S.dividerLine} />
          <Text style={S.dividerLabel}>or</Text>
          <View style={S.dividerLine} />
        </View>

        <TouchableOpacity style={S.registerLink} onPress={() => navigation.navigate('Registration')}>
          <Text style={S.registerLinkText}>New to PAGIR? <Text style={S.registerLinkBold}>Create account</Text></Text>
        </TouchableOpacity>

        <Text style={S.footer}>PAGIR 2.0 · Zero-knowledge P2P</Text>
      </ScrollView>

      {/* Country picker */}
      <Modal visible={showPicker} transparent animationType="slide" onRequestClose={() => setShowPicker(false)}>
        <View style={S.modalOverlay}>
          <View style={S.modalSheet}>
            <Text style={S.modalTitle}>Select country code</Text>
            <FlatList
              data={COUNTRY_LIST}
              keyExtractor={i => i.code}
              renderItem={({ item }) => (
                <TouchableOpacity style={S.countryRow} onPress={() => { setDialCode(item.dial); setShowPicker(false) }}>
                  <Text style={S.countryName}>{item.name}</Text>
                  <Text style={S.countryDial}>{item.dial}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  )
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  scroll:    { flexGrow: 1, paddingHorizontal: Spacing.xl, paddingTop: 60, paddingBottom: 40 },

  header:   { alignItems: 'center', marginBottom: 32 },
  logoMark: { width: 72, height: 72, borderRadius: 20, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  logoText: { fontSize: 36, fontWeight: '700', color: Colors.primary },
  title:    { ...Typography['3xl'], color: Colors.textPrimary, marginBottom: 8, textAlign: 'center' },
  subtitle: { ...Typography.body, textAlign: 'center', lineHeight: 20 },

  segmented: { flexDirection: 'row', backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, padding: 4, marginBottom: 28 },
  segBtn:    { flex: 1, paddingVertical: 10, borderRadius: Radius.sm, alignItems: 'center' },
  segBtnActive: { backgroundColor: Colors.primary },
  segText:   { fontSize: 14, fontWeight: '600', color: Colors.textMuted },
  segTextActive: { color: Colors.textInverse },

  recoveryBadge: { backgroundColor: Colors.primaryDeep, borderRadius: Radius.sm, paddingHorizontal: Spacing.base, paddingVertical: 8, alignSelf: 'flex-start', marginBottom: 20, borderWidth: 1, borderColor: Colors.primary },
  recoveryBadgeText: { fontSize: 12, color: Colors.primary, fontWeight: '600' },

  field:     { marginBottom: Spacing.lg },
  label:     { ...Typography.label, color: Colors.textSecondary, marginBottom: Spacing.sm },
  input:     { height: 52, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.base, fontSize: 16, color: Colors.textPrimary, backgroundColor: Colors.surface },
  inputErr:  { borderColor: Colors.danger },
  hint:      { marginTop: 6, fontSize: 12, color: Colors.textMuted, lineHeight: 16 },
  phoneRow:  { flexDirection: 'row', gap: 8 },
  dialBtn:   { height: 52, paddingHorizontal: 14, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  dialText:  { fontSize: 16, color: Colors.textPrimary, fontWeight: '600' },
  phoneInput: { flex: 1 },

  errorBox:   { backgroundColor: Colors.dangerBg, borderRadius: Radius.sm, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: Colors.danger },
  errorText:  { color: Colors.danger, fontSize: 14 },

  btn:     { height: 54, backgroundColor: Colors.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  btnOff:  { backgroundColor: Colors.primaryDeep },
  btnText: { color: Colors.textInverse, fontSize: 16, fontWeight: '700' },

  switchMode:     { alignItems: 'center', paddingVertical: 12 },
  switchModeText: { fontSize: 14, color: Colors.textDim },
  switchModeBold: { color: Colors.primary, fontWeight: '600' },

  dividerRow:  { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerLabel: { marginHorizontal: 12, fontSize: 13, color: Colors.textMuted },

  registerLink:     { alignItems: 'center', paddingVertical: 4, marginBottom: 20 },
  registerLinkText: { fontSize: 14, color: Colors.textDim },
  registerLinkBold: { color: Colors.primary, fontWeight: '600' },
  footer:           { fontSize: 11, color: Colors.textMuted, textAlign: 'center' },

  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  modalSheet:   { backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '70%', paddingBottom: 32 },
  modalTitle:   { fontSize: 16, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  countryRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.bg },
  countryName:  { fontSize: 15, color: Colors.textSecondary },
  countryDial:  { fontSize: 15, color: Colors.primary, fontWeight: '600' },
})
