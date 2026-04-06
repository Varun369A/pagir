/**
 * PAGIR 2 — Registration Screen
 *
 * New user setup:
 *   1. Pre-generates PAGIR ID + RSA-2048 key pair on mount (idempotent)
 *   2. Collects: display name, email, phone number
 *   3. Sends OTP → navigates to OTP screen
 *   4. If server returns alreadyRegistered: shows banner → redirect to Login
 */

import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView,
  Modal, Platform, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useDispatch, useSelector } from 'react-redux'
import type { RootStackParamList } from '../navigation/AppNavigator'
import { requestOtp } from '../store/authSlice'
import type { RootState, AppDispatch } from '../store'
import { identityManager } from '../services/IdentityManager'
import { Colors, Spacing, Radius, Typography } from '../theme'

type Props = NativeStackScreenProps<RootStackParamList, 'Registration'>

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

export default function RegistrationScreen({ navigation }: Props) {
  const dispatch = useDispatch<AppDispatch>()
  const { loading, error } = useSelector((s: RootState) => s.auth)

  const [displayName, setDisplayName]   = useState('')
  const [email, setEmail]               = useState('')
  const [phone, setPhone]               = useState('')
  const [dialCode, setDialCode]         = useState('+91')
  const [showPicker, setShowPicker]     = useState(false)
  const [termsAccepted, setTerms]       = useState(false)
  const [readyKeys, setReadyKeys]       = useState(false)
  const [alreadyReg, setAlreadyReg]     = useState(false)

  useEffect(() => {
    identityManager.ensureIdentity().finally(() => setReadyKeys(true))
  }, [])

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const isValid = displayName.trim().length >= 1
    && isValidEmail
    && phone.replace(/\D/g, '').length >= 7
    && termsAccepted
    && readyKeys

  const handleContinue = useCallback(async () => {
    if (!isValid || loading) return

    const fullPhone = `${dialCode}${phone.replace(/\D/g, '')}`

    const result = await dispatch(requestOtp({
      phoneNumber: fullPhone,
      email: email.trim().toLowerCase(),
      platform: Platform.OS as 'android' | 'ios',
    }))

    if (requestOtp.fulfilled.match(result)) {
      if ((result.payload as any)?.alreadyRegistered) {
        setAlreadyReg(true)
        // Still send them to OTP — code was sent, they just need to complete verify
        navigation.navigate('OTP', {
          phoneNumber: fullPhone,
          email:       email.trim().toLowerCase(),
          isNewUser:   false,
          displayName: displayName.trim(),
        })
        return
      }
      navigation.navigate('OTP', {
        phoneNumber: fullPhone,
        email:       email.trim().toLowerCase(),
        isNewUser:   true,
        displayName: displayName.trim(),
      })
      return
    }

    const msg = ((result.error?.message ?? '') + (result.payload as string ?? '')).toLowerCase()
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('econnrefused')) {
      Alert.alert(
        'No Internet Connection',
        'PAGIR can still receive files without internet.\nVerify your phone later from Settings.',
        [
          { text: 'Continue Offline', onPress: async () => {
            await AsyncStorage.setItem('pagir2:offline_mode', 'true')
            navigation.reset({ index: 0, routes: [{ name: 'Home' }] })
          }},
          { text: 'Try Again', style: 'cancel' },
        ]
      )
    }
  }, [isValid, loading, dialCode, phone, email, displayName, dispatch, navigation])

  return (
    <KeyboardAvoidingView style={S.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={S.scroll} keyboardShouldPersistTaps="handled">

        {/* Header */}
        <View style={S.header}>
          <View style={S.logoMark}><Text style={S.logoText}>P</Text></View>
          <Text style={S.title}>Set up PAGIR</Text>
          <Text style={S.subtitle}>Your PAGIR ID is already generated on this device.{'\n'}Verify your phone to unlock sending.</Text>
        </View>

        {/* Already registered banner */}
        {alreadyReg && (
          <View style={S.alreadyBox}>
            <Text style={S.alreadyTitle}>Phone already registered</Text>
            <Text style={S.alreadyBody}>
              This number is linked to an existing account. A code was sent to your email — enter it to sign in.
            </Text>
            <TouchableOpacity style={S.alreadyBtn} onPress={() => navigation.navigate('Login')}>
              <Text style={S.alreadyBtnText}>Go to Sign In</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Name */}
        <View style={S.field}>
          <Text style={S.label}>Your name</Text>
          <TextInput style={S.input} placeholder="How you appear to contacts"
            placeholderTextColor={Colors.textMuted} value={displayName} onChangeText={setDisplayName}
            autoCapitalize="words" maxLength={100} />
        </View>

        {/* Email */}
        <View style={S.field}>
          <Text style={S.label}>Email address</Text>
          <TextInput
            style={[S.input, email.length > 0 && !isValidEmail && S.inputErr]}
            placeholder="you@example.com" placeholderTextColor={Colors.textMuted}
            value={email} onChangeText={setEmail}
            autoCapitalize="none" keyboardType="email-address" maxLength={254} />
          <Text style={S.hint}>Verification code will be sent here.</Text>
        </View>

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
          <Text style={S.hint}>Stored as a one-way hash — never readable.</Text>
        </View>

        {/* Terms */}
        <TouchableOpacity style={S.termsRow} onPress={() => setTerms(v => !v)}>
          <View style={[S.checkbox, termsAccepted && S.checkboxOn]}>
            {termsAccepted && <Text style={S.checkmark}>✓</Text>}
          </View>
          <Text style={S.termsText}>I accept the Privacy Policy and Terms of Service</Text>
        </TouchableOpacity>

        {/* Error */}
        {error && !alreadyReg && (
          <View style={S.errorBox}><Text style={S.errorText}>{error}</Text></View>
        )}

        {/* CTA */}
        <TouchableOpacity
          style={[S.btn, (!isValid || loading) && S.btnOff]}
          onPress={handleContinue} disabled={!isValid || loading}
        >
          {loading || !readyKeys
            ? <ActivityIndicator color={Colors.textInverse} />
            : <Text style={S.btnText}>Send verification code</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity style={S.loginLink} onPress={() => navigation.navigate('Login')}>
          <Text style={S.loginLinkText}>Already have a PAGIR ID? <Text style={S.loginLinkBold}>Sign in</Text></Text>
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

  header:   { alignItems: 'center', marginBottom: 36 },
  logoMark: { width: 72, height: 72, borderRadius: 20, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  logoText: { fontSize: 36, fontWeight: '700', color: Colors.primary },
  title:    { ...Typography['3xl'], color: Colors.textPrimary, marginBottom: 8, textAlign: 'center' },
  subtitle: { ...Typography.body, textAlign: 'center', lineHeight: 20 },

  alreadyBox:  { backgroundColor: Colors.warningBg, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.warning, padding: Spacing.base, marginBottom: Spacing.base },
  alreadyTitle: { fontSize: 15, fontWeight: '700', color: Colors.warning, marginBottom: 6 },
  alreadyBody: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18, marginBottom: 12 },
  alreadyBtn:  { backgroundColor: Colors.warning, borderRadius: Radius.sm, paddingVertical: 10, alignItems: 'center' },
  alreadyBtnText: { fontSize: 14, fontWeight: '700', color: Colors.textInverse },

  field:     { marginBottom: Spacing.lg },
  label:     { ...Typography.label, color: Colors.textSecondary, marginBottom: Spacing.sm },
  input:     { height: 52, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.base, fontSize: 16, color: Colors.textPrimary, backgroundColor: Colors.surface },
  inputErr:  { borderColor: Colors.danger },
  hint:      { marginTop: 6, fontSize: 12, color: Colors.textMuted, lineHeight: 16 },
  phoneRow:  { flexDirection: 'row', gap: 8 },
  dialBtn:   { height: 52, paddingHorizontal: 14, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  dialText:  { fontSize: 16, color: Colors.textPrimary, fontWeight: '600' },
  phoneInput: { flex: 1 },

  termsRow:    { flexDirection: 'row', gap: 12, marginBottom: 24, alignItems: 'flex-start' },
  checkbox:    { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: Colors.textMuted, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  checkboxOn:  { backgroundColor: Colors.primary, borderColor: Colors.primary },
  checkmark:   { fontSize: 13, color: Colors.textInverse, fontWeight: '700' },
  termsText:   { flex: 1, fontSize: 14, color: Colors.textSecondary, lineHeight: 20 },

  errorBox:   { backgroundColor: Colors.dangerBg, borderRadius: Radius.sm, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: Colors.danger },
  errorText:  { color: Colors.danger, fontSize: 14 },

  btn:     { height: 54, backgroundColor: Colors.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  btnOff:  { backgroundColor: Colors.primaryDeep },
  btnText: { color: Colors.textInverse, fontSize: 16, fontWeight: '700' },

  loginLink:     { alignItems: 'center', paddingVertical: 12, marginBottom: 12 },
  loginLinkText: { fontSize: 14, color: Colors.textDim },
  loginLinkBold: { color: Colors.primary, fontWeight: '600' },
  footer:        { fontSize: 11, color: Colors.textMuted, textAlign: 'center' },

  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  modalSheet:   { backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '70%', paddingBottom: 32 },
  modalTitle:   { fontSize: 16, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center', paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  countryRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.bg },
  countryName:  { fontSize: 15, color: Colors.textSecondary },
  countryDial:  { fontSize: 15, color: Colors.primary, fontWeight: '600' },
})
