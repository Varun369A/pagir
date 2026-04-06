/**
 * PAGIR 2 — Share Identity Screen
 *
 * Shows the user's PAGIR ID in two shareable forms:
 *   1. QR code (renders the pagir2:// bundle URI)
 *   2. Text bundle (base64url encoded identity bundle)
 *
 * Actions:
 *   - Copy PAGIR ID
 *   - Copy full bundle text
 *   - Share via native share sheet
 */

import React, { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator, Platform, ScrollView, Share,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import QRCode from 'react-native-qrcode-svg'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { RootStackParamList } from '../navigation/AppNavigator'
import { identityManager } from '../services/IdentityManager'
import { encodePagirBundle, pagirBundleToShareText } from '../utils/pagirId'
import { Colors, Spacing, Radius, Typography } from '../theme'

type Props = NativeStackScreenProps<RootStackParamList, 'ShareIdentity'>

export default function ShareIdentityScreen({ navigation }: Props) {
  const [pagirId, setPagirId]     = useState<string | null>(null)
  const [bundle, setBundle]       = useState<string | null>(null)
  const [shareText, setShareText] = useState<string | null>(null)
  const [loading, setLoading]     = useState(true)
  const [idCopied, setIdCopied]   = useState(false)
  const [txtCopied, setTxtCopied] = useState(false)

  useEffect(() => {
    loadIdentity()
  }, [])

  async function loadIdentity() {
    setLoading(true)
    try {
      const identity = await identityManager.getIdentity()
      if (!identity) return

      setPagirId(identity.pagirId)
      const uri = encodePagirBundle(identity.pagirId, identity.publicKey)
      setBundle(uri)
      setShareText(pagirBundleToShareText(identity.pagirId, identity.publicKey))
    } finally {
      setLoading(false)
    }
  }

  const handleCopyId = useCallback(() => {
    if (!pagirId) return
    Clipboard.setString(pagirId)
    setIdCopied(true)
    setTimeout(() => setIdCopied(false), 2000)
  }, [pagirId])

  const handleCopyBundle = useCallback(() => {
    if (!shareText) return
    Clipboard.setString(shareText)
    setTxtCopied(true)
    setTimeout(() => setTxtCopied(false), 2000)
  }, [shareText])

  const handleShare = useCallback(async () => {
    if (!shareText) return
    await Share.share({
      message: shareText,
      title:   'My PAGIR Identity',
    })
  }, [shareText])

  return (
    <View style={S.container}>
      {/* Top bar */}
      <View style={S.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={S.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={S.topTitle}>Share Identity</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={S.scroll}>
        <Text style={S.intro}>
          Share your PAGIR ID or QR code so others can add you as a contact.
          Your private key never leaves your device.
        </Text>

        {loading ? (
          <ActivityIndicator color={Colors.primary} style={S.loader} />
        ) : (
          <>
            {/* QR code */}
            <View style={S.qrCard}>
              {bundle ? (
                <QRCode
                  value={bundle}
                  size={220}
                  color={Colors.textPrimary}
                  backgroundColor={Colors.surface}
                />
              ) : (
                <View style={S.qrFallback}>
                  <Text style={S.qrFallbackText}>QR unavailable</Text>
                </View>
              )}
              <Text style={S.qrHint}>Scan with any PAGIR 2 device</Text>
            </View>

            {/* PAGIR ID row */}
            <View style={S.idRow}>
              <Text style={S.idLabel}>PAGIR ID</Text>
              <Text style={S.idValue} selectable numberOfLines={1}>
                {pagirId ?? '—'}
              </Text>
              <TouchableOpacity style={S.copyBtn} onPress={handleCopyId}>
                <Text style={S.copyBtnText}>{idCopied ? '✓' : 'Copy'}</Text>
              </TouchableOpacity>
            </View>

            {/* Bundle row */}
            <View style={S.bundleCard}>
              <Text style={S.bundleLabel}>Text bundle</Text>
              <Text style={S.bundleValue} numberOfLines={4} ellipsizeMode="tail">
                {shareText ?? '—'}
              </Text>
              <View style={S.bundleActions}>
                <TouchableOpacity style={S.bundleAction} onPress={handleCopyBundle}>
                  <Text style={S.bundleActionText}>{txtCopied ? '✓ Copied' : 'Copy bundle'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[S.bundleAction, S.bundleActionPrimary]} onPress={handleShare}>
                  <Text style={[S.bundleActionText, S.bundleActionPrimaryText]}>Share</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Security note */}
            <View style={S.secNote}>
              <Text style={S.secNoteText}>
                This bundle contains your PAGIR ID and public key only.
                Your private key never leaves your device.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  )
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  topBar:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.xl, paddingTop: Platform.OS === 'ios' ? 56 : 20, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: Colors.border },
  back:      { fontSize: 16, color: Colors.primary, fontWeight: '600' },
  topTitle:  { ...Typography.xl, color: Colors.textPrimary },

  scroll:    { paddingHorizontal: Spacing.xl, paddingBottom: 40 },
  intro:     { fontSize: 14, color: Colors.textSecondary, lineHeight: 20, marginVertical: 20, textAlign: 'center' },

  loader: { marginTop: 60 },

  qrCard:        { backgroundColor: Colors.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.border, padding: Spacing.xl, alignItems: 'center', marginBottom: 24, gap: 16 },
  qrFallback:    { width: 220, height: 220, borderRadius: Radius.md, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  qrFallbackText:{ color: Colors.textMuted, fontSize: 14 },
  qrHint:        { fontSize: 13, color: Colors.textMuted },

  idRow:    { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, padding: Spacing.base, marginBottom: 16, gap: 8 },
  idLabel:  { fontSize: 12, color: Colors.textMuted, fontWeight: '600', width: 72 },
  idValue:  { flex: 1, fontSize: 14, color: Colors.primary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontWeight: '600' },
  copyBtn:  { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.primary },
  copyBtnText: { fontSize: 13, color: Colors.primary, fontWeight: '600' },

  bundleCard:      { backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, padding: Spacing.base, marginBottom: 16 },
  bundleLabel:     { fontSize: 12, color: Colors.textMuted, fontWeight: '600', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6 },
  bundleValue:     { fontSize: 12, color: Colors.textSecondary, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', lineHeight: 18, marginBottom: 12 },
  bundleActions:   { flexDirection: 'row', gap: 8 },
  bundleAction:    { flex: 1, paddingVertical: 10, borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  bundleActionPrimary:     { backgroundColor: Colors.primary, borderColor: Colors.primary },
  bundleActionText:        { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  bundleActionPrimaryText: { color: Colors.textInverse },

  secNote:     { backgroundColor: Colors.primaryDeep, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, padding: Spacing.base },
  secNoteText: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18, textAlign: 'center' },
})
