/**
 * PAGIR 2 — Settings Screen
 *
 * Sections:
 *   Account   — PAGIR ID, display name, email, phone
 *   Security  — View public key, verify phone number
 *   App       — Version info, offline mode toggle
 *   Session   — Sign out
 */

import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator, Alert, Platform, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Clipboard from '@react-native-clipboard/clipboard'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useDispatch, useSelector } from 'react-redux'
import type { RootStackParamList } from '../navigation/AppNavigator'
import type { RootState, AppDispatch } from '../store'
import { clearAuth } from '../store/authSlice'
import { apiClient } from '../store/apiClient'
import { identityManager } from '../services/IdentityManager'
import { Colors, Spacing, Radius, Typography } from '../theme'

type Props = NativeStackScreenProps<RootStackParamList, 'Settings'>

interface Profile {
  pagirId: string
  displayName: string | null
  email: string | null
  publicKey: string | null
}

export default function SettingsScreen({ navigation }: Props) {
  const dispatch = useDispatch<AppDispatch>()
  const { pagirId: reduxPagirId, isOfflineMode } = useSelector((s: RootState) => s.auth)

  const [profile, setProfile]       = useState<Profile | null>(null)
  const [loading, setLoading]       = useState(true)
  const [signingOut, setSigningOut] = useState(false)
  const [keyCopied, setKeyCopied]   = useState(false)
  const [idCopied, setIdCopied]     = useState(false)

  useEffect(() => {
    loadProfile()
  }, [])

  async function loadProfile() {
    setLoading(true)
    try {
      if (!isOfflineMode) {
        const serverProfile = await apiClient.getMyProfile()
        setProfile({
          pagirId:     serverProfile.pagirId,
          displayName: serverProfile.displayName ?? null,
          email:       null,
          publicKey:   serverProfile.publicKey ?? null,
        })
        setLoading(false)
        return
      }
    } catch {
      // Fall through to local
    }

    // Local fallback
    const identity = await identityManager.getIdentity()
    const name = await AsyncStorage.getItem('pagir2:registered_name').catch(() => null)
    setProfile({
      pagirId:     identity?.pagirId ?? reduxPagirId ?? '—',
      displayName: name ?? null,
      email:       null,
      publicKey:   identity?.publicKey ?? null,
    })
    setLoading(false)
  }

  const handleCopyId = useCallback(() => {
    if (!profile?.pagirId) return
    Clipboard.setString(profile.pagirId)
    setIdCopied(true)
    setTimeout(() => setIdCopied(false), 2000)
  }, [profile])

  const handleCopyKey = useCallback(() => {
    if (!profile?.publicKey) return
    Clipboard.setString(profile.publicKey)
    setKeyCopied(true)
    setTimeout(() => setKeyCopied(false), 2000)
  }, [profile])

  const handleSignOut = useCallback(() => {
    Alert.alert(
      'Sign out',
      'You will need to sign in again to send files. Your received files stay on your device.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: doSignOut },
      ]
    )
  }, [])

  async function doSignOut() {
    setSigningOut(true)
    try {
      await apiClient.logout()
    } catch { /* ignore — tokens cleared in finally inside apiClient.logout */ }
    await AsyncStorage.multiRemove([
      'pagir2:offline_mode',
      'pagir2:registered_id',
      'pagir2:registered_name',
      'pagir2:registered_phone',
    ]).catch(() => {})
    dispatch(clearAuth())
    navigation.reset({ index: 0, routes: [{ name: 'Login' }] })
  }

  const pagirId = profile?.pagirId ?? reduxPagirId ?? '—'

  return (
    <View style={S.container}>
      {/* Top bar */}
      <View style={S.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={S.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={S.topTitle}>Settings</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={S.scroll}>

        {loading ? (
          <ActivityIndicator color={Colors.primary} style={S.loader} />
        ) : (
          <>
            {/* Account section */}
            <Text style={S.sectionTitle}>Account</Text>
            <View style={S.card}>
              <SettingsRow label="PAGIR ID" value={pagirId} mono onPress={handleCopyId} actionText={idCopied ? '✓' : 'Copy'} />
              {profile?.displayName && <SettingsRow label="Display name" value={profile.displayName} />}
              {profile?.email && <SettingsRow label="Email" value={profile.email} />}
            </View>

            {/* Security section */}
            <Text style={S.sectionTitle}>Security</Text>
            <View style={S.card}>
              {profile?.publicKey ? (
                <SettingsRow
                  label="Public key"
                  value={profile.publicKey.slice(0, 60) + '…'}
                  mono
                  onPress={handleCopyKey}
                  actionText={keyCopied ? '✓ Copied' : 'Copy full'}
                />
              ) : (
                <SettingsRow label="Public key" value="Not available offline" />
              )}
              <SettingsTouchRow
                label="Emergency options"
                desc="Wipe identity or delete account"
                danger
                onPress={() => navigation.navigate('Emergency')}
              />
            </View>

            {/* App section */}
            <Text style={S.sectionTitle}>App</Text>
            <View style={S.card}>
              <SettingsRow label="Version" value="PAGIR 2.0.0" />
              <SettingsRow label="Mode" value={isOfflineMode ? 'Offline' : 'Online'} />
              <SettingsTouchRow
                label="Share my identity"
                desc="QR code + text bundle"
                onPress={() => navigation.navigate('ShareIdentity')}
              />
            </View>

            {/* Session */}
            <Text style={S.sectionTitle}>Session</Text>
            <View style={S.card}>
              <TouchableOpacity
                style={[S.signOutRow, signingOut && S.rowDisabled]}
                onPress={handleSignOut} disabled={signingOut}
              >
                {signingOut
                  ? <ActivityIndicator color={Colors.danger} />
                  : <Text style={S.signOutText}>Sign out</Text>
                }
              </TouchableOpacity>
            </View>
          </>
        )}

        <Text style={S.footer}>PAGIR 2.0 · Zero-knowledge P2P · Your keys, your data</Text>
      </ScrollView>
    </View>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SettingsRow({
  label, value, mono, onPress, actionText,
}: {
  label: string
  value: string
  mono?: boolean
  onPress?: () => void
  actionText?: string
}) {
  return (
    <View style={R.row}>
      <Text style={R.label}>{label}</Text>
      <Text style={[R.value, mono && R.mono]} numberOfLines={1} ellipsizeMode="middle">{value}</Text>
      {onPress && (
        <TouchableOpacity onPress={onPress} style={R.action}>
          <Text style={R.actionText}>{actionText ?? 'Copy'}</Text>
        </TouchableOpacity>
      )}
    </View>
  )
}

function SettingsTouchRow({
  label, desc, onPress, danger,
}: {
  label: string
  desc?: string
  onPress: () => void
  danger?: boolean
}) {
  return (
    <TouchableOpacity style={[R.row, R.touchRow]} onPress={onPress}>
      <View style={R.touchContent}>
        <Text style={[R.label, danger && { color: Colors.danger }]}>{label}</Text>
        {desc && <Text style={R.desc}>{desc}</Text>}
      </View>
      <Text style={R.chevron}>›</Text>
    </TouchableOpacity>
  )
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  topBar:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.xl, paddingTop: Platform.OS === 'ios' ? 56 : 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  back:      { fontSize: 16, color: Colors.primary, fontWeight: '600' },
  topTitle:  { ...Typography.xl, color: Colors.textPrimary },

  scroll:   { paddingHorizontal: Spacing.xl, paddingBottom: 40, paddingTop: 8 },
  loader:   { marginTop: 60 },

  sectionTitle: { fontSize: 12, color: Colors.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 24, marginBottom: 8 },
  card:         { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', marginBottom: 4 },

  signOutRow:    { paddingVertical: 16, paddingHorizontal: Spacing.base, alignItems: 'center' },
  signOutText:   { fontSize: 16, fontWeight: '700', color: Colors.danger },
  rowDisabled:   { opacity: 0.5 },

  footer: { marginTop: 32, fontSize: 12, color: Colors.textMuted, textAlign: 'center', lineHeight: 18 },
})

const R = StyleSheet.create({
  row:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.base, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.bg },
  touchRow:    { paddingVertical: 16 },
  touchContent:{ flex: 1 },
  label:       { fontSize: 14, fontWeight: '600', color: Colors.textSecondary, width: 110 },
  value:       { flex: 1, fontSize: 14, color: Colors.textPrimary, textAlign: 'right', marginRight: 8 },
  mono:        { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 12 },
  action:      { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.primary },
  actionText:  { fontSize: 12, color: Colors.primary, fontWeight: '600' },
  desc:        { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  chevron:     { fontSize: 20, color: Colors.textMuted },
})
