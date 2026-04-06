/**
 * PAGIR 2 — Add Contact Screen
 *
 * Three input methods:
 *   1. Manual PAGIR ID entry
 *   2. QR scan (via VisionCamera + native code scanner)
 *   3. Paste from clipboard
 *
 * On submit:
 *   - Validates PAGIR ID format
 *   - Calls GET /users/:pagirId to fetch public profile
 *   - Saves to local ContactStore (SQLite)
 *   - Navigates back to Home
 */

import React, { useCallback, useState } from 'react'
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform,
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native'
import Clipboard from '@react-native-clipboard/clipboard'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { Camera, useCameraDevice, useCameraPermission, useCodeScanner } from 'react-native-vision-camera'
import type { RootStackParamList } from '../navigation/AppNavigator'
import { apiClient } from '../store/apiClient'
import { contactStore } from '../services/ContactStore'
import { isValidPagirId, decodePagirBundle } from '../utils/pagirId'
import { Colors, Spacing, Radius, Typography } from '../theme'

type Props = NativeStackScreenProps<RootStackParamList, 'AddContact'>

export default function AddContactScreen({ navigation }: Props) {
  const [pagirId, setPagirId]   = useState('')
  const [nickname, setNickname] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [preview, setPreview]   = useState<{ name: string; pagirId: string } | null>(null)
  const [showScanner, setShowScanner] = useState(false)
  const [scanError, setScanError]     = useState<string | null>(null)

  const { hasPermission, requestPermission } = useCameraPermission()
  const device = useCameraDevice('back')

  const isIdValid = isValidPagirId(pagirId.trim().toUpperCase())

  // ── QR code scanner ──────────────────────────────────────────────────────────

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      const raw = codes[0]?.value
      if (!raw) return

      // Try pagir2:// bundle first
      const stripped = raw.replace(/^pagir2?:\/\//i, '').trim()
      const decoded = decodePagirBundle(stripped)
      if (decoded && isValidPagirId(decoded.pagirId)) {
        setShowScanner(false)
        setScanError(null)
        setPagirId(decoded.pagirId)
        setPreview(null)
        setError(null)
        return
      }

      // Try raw PAGIR ID
      const upper = raw.trim().toUpperCase()
      if (isValidPagirId(upper)) {
        setShowScanner(false)
        setScanError(null)
        setPagirId(upper)
        setPreview(null)
        setError(null)
        return
      }

      setScanError('QR code is not a valid PAGIR identity. Ask your contact to share their PAGIR QR code.')
    },
  })

  const handleOpenCamera = useCallback(async () => {
    setScanError(null)
    if (!hasPermission) {
      const granted = await requestPermission()
      if (!granted) {
        Alert.alert(
          'Camera permission required',
          'Please allow camera access in your device settings to scan PAGIR QR codes.',
          [{ text: 'OK' }]
        )
        return
      }
    }
    if (!device) {
      Alert.alert('Camera not available', 'No back camera found on this device.')
      return
    }
    setShowScanner(true)
  }, [hasPermission, requestPermission, device])

  // ── Other handlers ───────────────────────────────────────────────────────────

  const handlePaste = useCallback(async () => {
    const text = await Clipboard.getString()
    if (text?.trim()) {
      const upper = text.trim().toUpperCase()
      setPagirId(upper)
      setError(null)
      setPreview(null)
    }
  }, [])

  const handleLookup = useCallback(async () => {
    const id = pagirId.trim().toUpperCase()
    if (!isValidPagirId(id)) {
      setError('Invalid PAGIR ID format. Expected: PAG-XXXX-XXXX-XXXX')
      return
    }

    setLoading(true)
    setError(null)
    setPreview(null)

    try {
      const profile = await apiClient.lookupUser(id)
      if (!profile) {
        setError('No PAGIR user found with that ID.')
        return
      }
      setPreview({ name: profile.displayName ?? profile.pagirId, pagirId: profile.pagirId })
    } catch (err: any) {
      const msg = (err?.message ?? '').toLowerCase()
      if (msg.includes('network') || msg.includes('fetch')) {
        setError('No connection. Check your internet and try again.')
      } else {
        setError(err?.message ?? 'Failed to look up user.')
      }
    } finally {
      setLoading(false)
    }
  }, [pagirId])

  const handleAdd = useCallback(async () => {
    if (!preview) return

    setLoading(true)
    try {
      const profile = await apiClient.lookupUser(preview.pagirId)
      if (!profile) throw new Error('User not found')
      await contactStore.add({
        pagirId:      profile.pagirId,
        displayName:  profile.displayName ?? profile.pagirId,
        nickname:     nickname.trim() || (profile.displayName ?? profile.pagirId),
        publicKeyPem: profile.publicKey ?? '',
      })
      Alert.alert('Contact added', `${profile.displayName ?? profile.pagirId} is now in your contacts.`)
      navigation.goBack()
    } catch (err: any) {
      setError(err?.message ?? 'Could not add contact. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [preview, nickname, navigation])

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView style={S.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={S.scroll} keyboardShouldPersistTaps="handled">

        {/* Header */}
        <View style={S.topBar}>
          <TouchableOpacity onPress={() => navigation.goBack()}>
            <Text style={S.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={S.topTitle}>Add Contact</Text>
          <View style={{ width: 60 }} />
        </View>

        <Text style={S.section}>Enter PAGIR ID</Text>

        {/* ID input */}
        <View style={S.field}>
          <Text style={S.label}>PAGIR ID</Text>
          <View style={S.idRow}>
            <TextInput
              style={[S.input, S.idInput, pagirId.length > 0 && !isIdValid && S.inputErr]}
              placeholder="PAG-XXXX-XXXX-XXXX"
              placeholderTextColor={Colors.textMuted}
              value={pagirId}
              onChangeText={v => { setPagirId(v.toUpperCase()); setPreview(null); setError(null) }}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={20}
            />
            <TouchableOpacity style={S.pasteBtn} onPress={handlePaste}>
              <Text style={S.pasteBtnText}>Paste</Text>
            </TouchableOpacity>
          </View>
          <Text style={S.hint}>Format: PAG-XXXX-XXXX-XXXX (16 characters after PAG-)</Text>
        </View>

        {/* Error */}
        {error && (
          <View style={S.errorBox}><Text style={S.errorText}>{error}</Text></View>
        )}

        {/* Lookup button */}
        {!preview && (
          <TouchableOpacity
            style={[S.btn, (!isIdValid || loading) && S.btnOff]}
            onPress={handleLookup} disabled={!isIdValid || loading}
          >
            {loading
              ? <ActivityIndicator color={Colors.textInverse} />
              : <Text style={S.btnText}>Look up user</Text>
            }
          </TouchableOpacity>
        )}

        {/* Preview card */}
        {preview && (
          <View style={S.previewCard}>
            <View style={S.previewAvatar}>
              <Text style={S.previewAvatarText}>{preview.name.slice(0, 2).toUpperCase()}</Text>
            </View>
            <View style={S.previewInfo}>
              <Text style={S.previewName}>{preview.name}</Text>
              <Text style={S.previewId}>{preview.pagirId}</Text>
            </View>
            <TouchableOpacity onPress={() => { setPreview(null); setPagirId('') }}>
              <Text style={S.previewClear}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Nickname (optional) */}
        {preview && (
          <View style={S.field}>
            <Text style={S.label}>Nickname (optional)</Text>
            <TextInput
              style={S.input}
              placeholder="How you want to remember them"
              placeholderTextColor={Colors.textMuted}
              value={nickname}
              onChangeText={setNickname}
              maxLength={50}
            />
          </View>
        )}

        {/* Add contact */}
        {preview && (
          <TouchableOpacity
            style={[S.btn, loading && S.btnOff]}
            onPress={handleAdd} disabled={loading}
          >
            {loading
              ? <ActivityIndicator color={Colors.textInverse} />
              : <Text style={S.btnText}>Add to contacts</Text>
            }
          </TouchableOpacity>
        )}

        <View style={S.dividerRow}>
          <View style={S.dividerLine} />
          <Text style={S.dividerLabel}>or scan QR code</Text>
          <View style={S.dividerLine} />
        </View>

        <View style={S.qrPlaceholder}>
          <Text style={S.qrIcon}>▦</Text>
          <Text style={S.qrText}>QR scanner</Text>
          <Text style={S.qrSub}>Scan a contact's PAGIR code to add them instantly</Text>
          <TouchableOpacity style={S.qrBtn} onPress={handleOpenCamera}>
            <Text style={S.qrBtnText}>Open Camera</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>

      {/* Camera scanner modal */}
      <Modal
        visible={showScanner}
        animationType="slide"
        onRequestClose={() => setShowScanner(false)}
      >
        <View style={S.scannerContainer}>
          {device ? (
            <Camera
              style={StyleSheet.absoluteFill}
              device={device}
              isActive={showScanner}
              codeScanner={codeScanner}
            />
          ) : null}

          {/* Scan overlay */}
          <View style={S.scanOverlay}>
            <View style={S.scanTopBar}>
              <TouchableOpacity style={S.scanClose} onPress={() => setShowScanner(false)}>
                <Text style={S.scanCloseText}>✕ Close</Text>
              </TouchableOpacity>
              <Text style={S.scanTitle}>Scan PAGIR QR Code</Text>
              <View style={{ width: 80 }} />
            </View>

            <View style={S.scanFrame}>
              <View style={[S.scanCorner, S.scanCornerTL]} />
              <View style={[S.scanCorner, S.scanCornerTR]} />
              <View style={[S.scanCorner, S.scanCornerBL]} />
              <View style={[S.scanCorner, S.scanCornerBR]} />
            </View>

            <Text style={S.scanHint}>Point camera at a PAGIR QR code</Text>

            {scanError && (
              <View style={S.scanErrorBox}>
                <Text style={S.scanErrorText}>{scanError}</Text>
                <TouchableOpacity onPress={() => setScanError(null)}>
                  <Text style={S.scanErrorDismiss}>Dismiss</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  )
}

const CORNER = 24

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  scroll:    { flexGrow: 1, paddingHorizontal: Spacing.xl, paddingTop: Platform.OS === 'ios' ? 56 : 20, paddingBottom: 40 },

  topBar:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 },
  back:      { fontSize: 16, color: Colors.primary, fontWeight: '600' },
  topTitle:  { ...Typography.xl, color: Colors.textPrimary },

  section:   { fontSize: 13, color: Colors.textMuted, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 16 },

  field:     { marginBottom: Spacing.lg },
  label:     { ...Typography.label, color: Colors.textSecondary, marginBottom: Spacing.sm },
  input:     { height: 52, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.base, fontSize: 16, color: Colors.textPrimary, backgroundColor: Colors.surface },
  inputErr:  { borderColor: Colors.danger },
  idRow:     { flexDirection: 'row', gap: 8 },
  idInput:   { flex: 1, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', letterSpacing: 1 },
  pasteBtn:  { height: 52, paddingHorizontal: 16, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.primary, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center' },
  pasteBtnText: { fontSize: 14, color: Colors.primary, fontWeight: '600' },
  hint:      { marginTop: 6, fontSize: 12, color: Colors.textMuted, lineHeight: 16 },

  errorBox:  { backgroundColor: Colors.dangerBg, borderRadius: Radius.sm, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: Colors.danger },
  errorText: { color: Colors.danger, fontSize: 14 },

  btn:     { height: 54, backgroundColor: Colors.primary, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  btnOff:  { backgroundColor: Colors.primaryDeep },
  btnText: { color: Colors.textInverse, fontSize: 16, fontWeight: '700' },

  previewCard:      { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.primary, padding: Spacing.base, marginBottom: Spacing.lg, gap: 12 },
  previewAvatar:    { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primaryDeep, alignItems: 'center', justifyContent: 'center' },
  previewAvatarText:{ fontSize: 16, fontWeight: '700', color: Colors.primary },
  previewInfo:      { flex: 1 },
  previewName:      { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  previewId:        { fontSize: 12, color: Colors.textMuted, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  previewClear:     { fontSize: 18, color: Colors.textMuted, padding: 4 },

  dividerRow:  { flexDirection: 'row', alignItems: 'center', marginVertical: 24 },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerLabel:{ marginHorizontal: 12, fontSize: 13, color: Colors.textMuted },

  qrPlaceholder: { backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed', padding: Spacing.xl, alignItems: 'center', gap: 8 },
  qrIcon:        { fontSize: 48, color: Colors.textMuted },
  qrText:        { fontSize: 16, fontWeight: '700', color: Colors.textSecondary },
  qrSub:         { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 18 },
  qrBtn:         { marginTop: 8, paddingHorizontal: Spacing.lg, paddingVertical: 12, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.primary },
  qrBtnText:     { fontSize: 14, color: Colors.primary, fontWeight: '600' },

  // Scanner modal
  scannerContainer: { flex: 1, backgroundColor: '#000' },
  scanOverlay:      { ...StyleSheet.absoluteFillObject, justifyContent: 'space-between' },
  scanTopBar:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: Platform.OS === 'ios' ? 56 : 20, paddingHorizontal: 20, paddingBottom: 16, backgroundColor: 'rgba(0,0,0,0.6)' },
  scanClose:        { paddingHorizontal: 12, paddingVertical: 8 },
  scanCloseText:    { fontSize: 15, color: '#fff', fontWeight: '600' },
  scanTitle:        { fontSize: 16, color: '#fff', fontWeight: '700' },

  scanFrame: {
    width: 260, height: 260,
    alignSelf: 'center',
    position: 'relative',
  },
  scanCorner:   { position: 'absolute', width: CORNER, height: CORNER, borderColor: Colors.primary, borderWidth: 3 },
  scanCornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  scanCornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  scanCornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  scanCornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },

  scanHint: { textAlign: 'center', color: '#fff', fontSize: 14, paddingHorizontal: 32, paddingBottom: 40, backgroundColor: 'rgba(0,0,0,0)', textShadowColor: '#000', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },

  scanErrorBox:    { margin: 20, backgroundColor: Colors.dangerBg, borderRadius: Radius.md, padding: 16, borderWidth: 1, borderColor: Colors.danger, alignItems: 'center', gap: 8 },
  scanErrorText:   { color: Colors.danger, fontSize: 13, textAlign: 'center', lineHeight: 18 },
  scanErrorDismiss:{ color: Colors.primary, fontSize: 13, fontWeight: '600' },
})
