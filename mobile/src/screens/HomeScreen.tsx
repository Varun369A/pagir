/**
 * PAGIR 2 — Home Screen
 *
 * Main dashboard after auth:
 *   - PAGIR ID display + copy
 *   - Contact list (from ContactStore / SQLite)
 *   - Quick actions: Add Contact, Share Identity
 *   - Offline mode banner
 *   - Empty state with onboarding CTA
 */

import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator, Alert, FlatList, Platform, RefreshControl,
  ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useDispatch, useSelector } from 'react-redux'
import type { RootStackParamList } from '../navigation/AppNavigator'
import type { RootState, AppDispatch } from '../store'
import { identityManager } from '../services/IdentityManager'
import { contactStore, type Contact } from '../services/ContactStore'
import { Colors, Spacing, Radius, Typography } from '../theme'

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>

export default function HomeScreen({ navigation }: Props) {
  const dispatch = useDispatch<AppDispatch>()
  const { pagirId: reduxPagirId, isOfflineMode } = useSelector((s: RootState) => s.auth)

  const [pagirId, setPagirId]       = useState<string | null>(reduxPagirId)
  const [contacts, setContacts]     = useState<Contact[]>([])
  const [loading, setLoading]       = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [idCopied, setIdCopied]     = useState(false)

  useEffect(() => {
    bootstrap()
  }, [])

  async function bootstrap() {
    setLoading(true)
    try {
      // Ensure we have the pagirId
      if (!pagirId) {
        const identity = await identityManager.getIdentity()
        if (identity?.pagirId) setPagirId(identity.pagirId)
      }
      contactStore.init()
      const all = contactStore.getAll()
      setContacts(all)
    } catch (err) {
      // Non-fatal — UI will show empty state
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const all = contactStore.getAll()
      setContacts(all)
    } finally {
      setRefreshing(false)
    }
  }, [])

  const handleCopyId = useCallback(() => {
    if (!pagirId) return
    Clipboard.setString(pagirId)
    setIdCopied(true)
    setTimeout(() => setIdCopied(false), 2000)
  }, [pagirId])

  const activeContacts = contacts.filter(c => !c.blockedAt)

  return (
    <View style={S.container}>
      {/* Header */}
      <View style={S.header}>
        <View style={S.headerLeft}>
          <View style={S.logoMini}><Text style={S.logoMiniText}>P</Text></View>
          <View>
            <Text style={S.headerTitle}>PAGIR</Text>
            <Text style={S.headerSub}>Zero-knowledge P2P</Text>
          </View>
        </View>
        <TouchableOpacity style={S.settingsBtn} onPress={() => navigation.navigate('Settings')}>
          <Text style={S.settingsIcon}>⚙</Text>
        </TouchableOpacity>
      </View>

      {/* Offline banner */}
      {isOfflineMode && (
        <View style={S.offlineBanner}>
          <Text style={S.offlineBannerText}>Offline mode — files can be received without internet</Text>
        </View>
      )}

      <FlatList
        data={activeContacts}
        keyExtractor={c => c.pagirId}
        contentContainerStyle={S.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />}
        ListHeaderComponent={
          <>
            {/* Identity card */}
            <View style={S.idCard}>
              <Text style={S.idCardLabel}>Your PAGIR ID</Text>
              <Text style={S.idCardValue} numberOfLines={1} ellipsizeMode="middle">
                {pagirId ?? '—'}
              </Text>
              <View style={S.idCardActions}>
                <TouchableOpacity style={S.idAction} onPress={handleCopyId}>
                  <Text style={S.idActionText}>{idCopied ? '✓ Copied' : 'Copy ID'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={S.idAction} onPress={() => navigation.navigate('ShareIdentity')}>
                  <Text style={S.idActionText}>Share</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Quick actions */}
            <View style={S.quickActions}>
              <TouchableOpacity style={S.quickBtn} onPress={() => navigation.navigate('AddContact')}>
                <Text style={S.quickBtnIcon}>+</Text>
                <Text style={S.quickBtnLabel}>Add Contact</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.quickBtn} onPress={() => navigation.navigate('ShareIdentity')}>
                <Text style={S.quickBtnIcon}>↑</Text>
                <Text style={S.quickBtnLabel}>Share Identity</Text>
              </TouchableOpacity>
              <TouchableOpacity style={S.quickBtn} onPress={() => navigation.navigate('Emergency')}>
                <Text style={[S.quickBtnIcon, { color: Colors.danger }]}>⚠</Text>
                <Text style={[S.quickBtnLabel, { color: Colors.danger }]}>Emergency</Text>
              </TouchableOpacity>
            </View>

            {/* Contacts header */}
            {activeContacts.length > 0 && (
              <Text style={S.sectionTitle}>Contacts ({activeContacts.length})</Text>
            )}
          </>
        }
        renderItem={({ item }) => (
          <ContactRow
            contact={item}
            onPress={() => navigation.navigate('Chat', {
              contactPagirId: item.pagirId,
              contactName: item.nickname || item.displayName,
            })}
          />
        )}
        ListEmptyComponent={
          loading
            ? <ActivityIndicator color={Colors.primary} style={S.loader} />
            : <EmptyContacts onAdd={() => navigation.navigate('AddContact')} />
        }
      />
    </View>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ContactRow({ contact, onPress }: { contact: Contact; onPress: () => void }) {
  const label    = contact.nickname || contact.displayName
  const initials = label.slice(0, 2).toUpperCase()

  return (
    <TouchableOpacity style={S.contactRow} onPress={onPress} activeOpacity={0.7}>
      <View style={S.avatar}>
        <Text style={S.avatarText}>{initials}</Text>
      </View>
      <View style={S.contactInfo}>
        <Text style={S.contactName}>{label}</Text>
        <Text style={S.contactId} numberOfLines={1}>{contact.pagirId}</Text>
      </View>
      <View style={S.contactRight}>
        {contact.lastSeen && (
          <Text style={S.contactTime}>{formatRelative(contact.lastSeen)}</Text>
        )}
        <Text style={S.chevron}>›</Text>
      </View>
    </TouchableOpacity>
  )
}

function EmptyContacts({ onAdd }: { onAdd: () => void }) {
  return (
    <View style={S.empty}>
      <Text style={S.emptyIcon}>○</Text>
      <Text style={S.emptyTitle}>No contacts yet</Text>
      <Text style={S.emptyBody}>
        Add someone by scanning their PAGIR code or entering their PAGIR ID.
        Files transfer directly — no servers, no cloud.
      </Text>
      <TouchableOpacity style={S.emptyBtn} onPress={onAdd}>
        <Text style={S.emptyBtnText}>Add first contact</Text>
      </TouchableOpacity>
    </View>
  )
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms
  const m = Math.floor(diff / 60_000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const S = StyleSheet.create({
  container:   { flex: 1, backgroundColor: Colors.bg },

  header:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.xl, paddingTop: Platform.OS === 'ios' ? 56 : 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerLeft:  { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logoMini:    { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  logoMiniText:{ fontSize: 18, fontWeight: '700', color: Colors.primary },
  headerTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  headerSub:   { fontSize: 11, color: Colors.textMuted },
  settingsBtn: { padding: 8 },
  settingsIcon:{ fontSize: 22, color: Colors.textSecondary },

  offlineBanner: { backgroundColor: Colors.warningBg, paddingVertical: 8, paddingHorizontal: Spacing.xl, borderBottomWidth: 1, borderBottomColor: Colors.warning },
  offlineBannerText: { fontSize: 13, color: Colors.warning, textAlign: 'center', fontWeight: '600' },

  listContent: { paddingBottom: 32 },

  idCard:        { margin: Spacing.xl, backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.lg },
  idCardLabel:   { fontSize: 12, color: Colors.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
  idCardValue:   { fontSize: 18, fontWeight: '700', color: Colors.primary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginBottom: 14 },
  idCardActions: { flexDirection: 'row', gap: 8 },
  idAction:      { flex: 1, paddingVertical: 8, borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.primary, alignItems: 'center' },
  idActionText:  { fontSize: 13, color: Colors.primary, fontWeight: '600' },

  quickActions: { flexDirection: 'row', paddingHorizontal: Spacing.xl, gap: 12, marginBottom: 28 },
  quickBtn:     { flex: 1, backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, paddingVertical: 16, alignItems: 'center', gap: 6 },
  quickBtnIcon: { fontSize: 22, color: Colors.primary, fontWeight: '700' },
  quickBtnLabel:{ fontSize: 12, color: Colors.textSecondary, fontWeight: '600' },

  sectionTitle: { paddingHorizontal: Spacing.xl, marginBottom: 8, fontSize: 13, color: Colors.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },

  contactRow:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.xl, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.border },
  avatar:       { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primaryDeep, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  avatarText:   { fontSize: 16, fontWeight: '700', color: Colors.primary },
  contactInfo:  { flex: 1 },
  contactName:  { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  contactId:    { fontSize: 12, color: Colors.textMuted, marginTop: 2, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  contactRight: { alignItems: 'flex-end', gap: 2 },
  contactTime:  { fontSize: 12, color: Colors.textMuted },
  chevron:      { fontSize: 18, color: Colors.textMuted },

  loader: { marginTop: 60 },
  empty:      { alignItems: 'center', paddingTop: 48, paddingHorizontal: Spacing.xl },
  emptyIcon:  { fontSize: 48, color: Colors.textMuted, marginBottom: 16 },
  emptyTitle: { ...Typography.xl, color: Colors.textPrimary, marginBottom: 12, textAlign: 'center' },
  emptyBody:  { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20, marginBottom: 28 },
  emptyBtn:   { backgroundColor: Colors.primary, borderRadius: Radius.lg, paddingHorizontal: Spacing.xl, paddingVertical: 14 },
  emptyBtnText: { fontSize: 15, fontWeight: '700', color: Colors.textInverse },
})
