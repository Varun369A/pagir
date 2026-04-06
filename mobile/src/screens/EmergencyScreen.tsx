/**
 * PAGIR 2 — Emergency Screen
 *
 * Two destructive actions (separated by a visual divider):
 *
 *   1. Emergency Wipe (soft reset)
 *      - Revokes current PAGIR ID on server
 *      - Generates new PAGIR ID + new key pair
 *      - Your contacts can no longer send to the old ID
 *      - Account survives — phone/email preserved
 *
 *   2. Delete Account Permanently (hard delete)
 *      - Removes ALL server-side data (user, OTPs, friends, transfers)
 *      - Phone number freed — can re-register
 *      - Irreversible
 */

import React, { useCallback, useState } from 'react'
import {
  ActivityIndicator, Alert, Platform, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useDispatch } from 'react-redux'
import type { RootStackParamList } from '../navigation/AppNavigator'
import type { AppDispatch } from '../store'
import { clearAuth } from '../store/authSlice'
import { apiClient } from '../store/apiClient'
import { identityManager } from '../services/IdentityManager'
import { Colors, Spacing, Radius, Typography } from '../theme'

type Props = NativeStackScreenProps<RootStackParamList, 'Emergency'>

export default function EmergencyScreen({ navigation }: Props) {
  const dispatch = useDispatch<AppDispatch>()
  const [wiping, setWiping]   = useState(false)
  const [deleting, setDeleting] = useState(false)

  // ─── Emergency Wipe ─────────────────────────────────────────────────────────

  const handleWipe = useCallback(() => {
    Alert.alert(
      'Emergency Wipe',
      'This will:\n\n• Revoke your current PAGIR ID\n• Generate a new identity\n• Sign you out\n\nYour contacts can no longer reach the old ID. Your account and phone number are preserved.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Wipe Identity',
          style: 'destructive',
          onPress: confirmWipe,
        },
      ]
    )
  }, [])

  async function confirmWipe() {
    setWiping(true)
    try {
      await apiClient.emergencyWipe()
    } catch (err: any) {
      const msg = (err?.message ?? '').toLowerCase()
      if (!msg.includes('network') && !msg.includes('fetch')) {
        Alert.alert('Wipe failed', err?.message ?? 'Please try again.')
        setWiping(false)
        return
      }
      // Offline: still wipe locally
    }

    // Always wipe local state
    await identityManager.wipeLocal()
    await AsyncStorage.multiRemove([
      'pagir2:registered_id',
      'pagir2:registered_name',
      'pagir2:registered_phone',
      'pagir2:offline_mode',
      'pagir2:device_fingerprint',
    ]).catch(() => {})
    dispatch(clearAuth())
    navigation.reset({ index: 0, routes: [{ name: 'Registration' }] })
  }

  // ─── Delete Account ──────────────────────────────────────────────────────────

  const handleDelete = useCallback(() => {
    Alert.alert(
      'Delete Account Permanently',
      'This will:\n\n• Delete all your data from PAGIR servers\n• Remove all friends and transfer history\n• Free your phone number\n• Wipe your local identity\n\nThis CANNOT be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Everything',
          style: 'destructive',
          onPress: confirmDelete,
        },
      ]
    )
  }, [])

  async function confirmDelete() {
    // Double confirm
    Alert.alert(
      'Are you absolutely sure?',
      'Deleting your account is permanent. All data will be lost.',
      [
        { text: 'No, keep account', style: 'cancel' },
        {
          text: 'Yes, delete account',
          style: 'destructive',
          onPress: executeDelete,
        },
      ]
    )
  }

  async function executeDelete() {
    setDeleting(true)
    try {
      await apiClient.deleteAccount()
    } catch (err: any) {
      const msg = (err?.message ?? '').toLowerCase()
      if (!msg.includes('network') && !msg.includes('fetch') && !msg.includes('401')) {
        Alert.alert('Delete failed', err?.message ?? 'Please try again.')
        setDeleting(false)
        return
      }
      // If server is unreachable or token expired, still clear local
    }

    await identityManager.wipeLocal()
    await AsyncStorage.multiRemove([
      'pagir2:registered_id',
      'pagir2:registered_name',
      'pagir2:registered_phone',
      'pagir2:offline_mode',
      'pagir2:device_fingerprint',
    ]).catch(() => {})
    dispatch(clearAuth())
    navigation.reset({ index: 0, routes: [{ name: 'Registration' }] })
  }

  return (
    <View style={S.container}>
      {/* Top bar */}
      <View style={S.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={S.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={S.topTitle}>Emergency</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={S.scroll}>

        {/* Warning header */}
        <View style={S.warningHeader}>
          <Text style={S.warningIcon}>⚠</Text>
          <Text style={S.warningTitle}>Danger Zone</Text>
          <Text style={S.warningBody}>
            These actions are irreversible. Only proceed if you have a security reason to do so.
          </Text>
        </View>

        {/* ─── Emergency Wipe ─── */}
        <View style={S.actionCard}>
          <View style={S.actionHeader}>
            <Text style={S.actionIcon}>⟳</Text>
            <View style={S.actionMeta}>
              <Text style={S.actionTitle}>Emergency Identity Wipe</Text>
              <Text style={S.actionBadge}>RECOVERABLE</Text>
            </View>
          </View>
          <Text style={S.actionDesc}>
            Use this if you suspect your identity was compromised. Your PAGIR ID is revoked and
            a new one is generated. Your phone number and email remain registered — you can
            still sign back in.
          </Text>
          <View style={S.consequenceList}>
            {[
              'Current PAGIR ID permanently revoked',
              'New ID + key pair generated instantly',
              'Contacts must re-add your new ID',
              'Account and phone number preserved',
            ].map(c => (
              <View key={c} style={S.consequenceRow}>
                <Text style={S.consequenceDot}>•</Text>
                <Text style={S.consequenceText}>{c}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity
            style={[S.wipeBtn, wiping && S.btnDisabled]}
            onPress={handleWipe} disabled={wiping || deleting}
          >
            {wiping
              ? <ActivityIndicator color={Colors.textInverse} />
              : <Text style={S.wipeBtnText}>Wipe Identity Now</Text>
            }
          </TouchableOpacity>
        </View>

        {/* Divider */}
        <View style={S.divider}>
          <View style={S.dividerLine} />
          <Text style={S.dividerText}>more severe</Text>
          <View style={S.dividerLine} />
        </View>

        {/* ─── Delete Account ─── */}
        <View style={[S.actionCard, S.deleteCard]}>
          <View style={S.actionHeader}>
            <Text style={[S.actionIcon, { color: Colors.danger }]}>✕</Text>
            <View style={S.actionMeta}>
              <Text style={[S.actionTitle, { color: Colors.danger }]}>Delete Account Permanently</Text>
              <Text style={[S.actionBadge, S.actionBadgeDanger]}>IRREVERSIBLE</Text>
            </View>
          </View>
          <Text style={S.actionDesc}>
            Completely removes your account from all PAGIR servers. Your phone number is freed
            and can be registered again from scratch.
          </Text>
          <View style={S.consequenceList}>
            {[
              'All server data deleted (users, friends, transfers)',
              'Phone number freed for new registration',
              'Local identity and keys wiped',
              'Cannot be undone — ever',
            ].map(c => (
              <View key={c} style={S.consequenceRow}>
                <Text style={[S.consequenceDot, { color: Colors.danger }]}>•</Text>
                <Text style={S.consequenceText}>{c}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity
            style={[S.deleteBtn, deleting && S.btnDisabled]}
            onPress={handleDelete} disabled={wiping || deleting}
          >
            {deleting
              ? <ActivityIndicator color={Colors.textInverse} />
              : <Text style={S.deleteBtnText}>Delete Account Permanently</Text>
            }
          </TouchableOpacity>
        </View>

      </ScrollView>
    </View>
  )
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  topBar:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.xl, paddingTop: Platform.OS === 'ios' ? 56 : 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  back:      { fontSize: 16, color: Colors.primary, fontWeight: '600' },
  topTitle:  { ...Typography.xl, color: Colors.textPrimary },

  scroll: { paddingHorizontal: Spacing.xl, paddingBottom: 40, paddingTop: 20 },

  warningHeader: { backgroundColor: Colors.dangerBg, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.danger, padding: Spacing.lg, alignItems: 'center', marginBottom: 28, gap: 8 },
  warningIcon:   { fontSize: 32, color: Colors.danger },
  warningTitle:  { ...Typography.xl, color: Colors.danger },
  warningBody:   { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },

  actionCard:   { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg, marginBottom: 20 },
  deleteCard:   { borderColor: Colors.danger },
  actionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 12 },
  actionIcon:   { fontSize: 24, color: Colors.warning },
  actionMeta:   { flex: 1 },
  actionTitle:  { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  actionBadge:  { fontSize: 10, fontWeight: '700', color: Colors.warning, backgroundColor: Colors.warningBg, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start', marginTop: 4 },
  actionBadgeDanger: { color: Colors.danger, backgroundColor: Colors.dangerBg },
  actionDesc:   { fontSize: 14, color: Colors.textSecondary, lineHeight: 20, marginBottom: 16 },

  consequenceList: { gap: 6, marginBottom: 20 },
  consequenceRow:  { flexDirection: 'row', gap: 8 },
  consequenceDot:  { fontSize: 14, color: Colors.warning, lineHeight: 20 },
  consequenceText: { flex: 1, fontSize: 13, color: Colors.textSecondary, lineHeight: 20 },

  wipeBtn:     { height: 50, backgroundColor: Colors.warning, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  wipeBtnText: { fontSize: 15, fontWeight: '700', color: Colors.bg },
  deleteBtn:     { height: 50, backgroundColor: Colors.danger, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  deleteBtnText: { fontSize: 15, fontWeight: '700', color: Colors.textInverse },
  btnDisabled:   { opacity: 0.5 },

  divider:     { flexDirection: 'row', alignItems: 'center', marginVertical: 8 },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { marginHorizontal: 12, fontSize: 11, color: Colors.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
})
