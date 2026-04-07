/**
 * PAGIR 2 — Chat Screen
 *
 * Text messaging + file transfer with a contact via the TARANG relay.
 * Frames are base64-encoded JSON queued on the backend (48h TTL).
 * Polls every 3 s for incoming frames.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView,
  Platform, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native'
import DocumentPicker from 'react-native-document-picker'
import { Buffer } from 'buffer'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import type { RootStackParamList } from '../navigation/AppNavigator'
import { identityManager } from '../services/IdentityManager'
import { messageStore, type Message } from '../services/MessageStore'
import { contactStore } from '../services/ContactStore'
import { apiClient } from '../store/apiClient'
import { Colors, Radius, Spacing, Typography } from '../theme'

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>

const POLL_MS = 3000

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toB64(str: string): string {
  return Buffer.from(str, 'utf8').toString('base64')
}

function fromB64(b64: string): string {
  return Buffer.from(b64, 'base64').toString('utf8')
}

async function fileToBase64(uri: string): Promise<string> {
  const res = await fetch(uri)
  const arrayBuf = await res.arrayBuffer()
  return Buffer.from(arrayBuf).toString('base64')
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function fileIcon(mime: string | null): string {
  if (!mime) return '📄'
  if (mime.startsWith('image/')) return '🖼️'
  if (mime.startsWith('video/')) return '🎬'
  if (mime.startsWith('audio/')) return '🎵'
  if (mime.includes('pdf')) return '📕'
  if (mime.includes('zip') || mime.includes('rar') || mime.includes('7z')) return '🗜️'
  return '📄'
}

function newMsgId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ChatScreen({ route, navigation }: Props) {
  const { contactPagirId, contactName } = route.params

  const [messages, setMessages]   = useState<Message[]>([])
  const [text, setText]           = useState('')
  const [sending, setSending]     = useState(false)
  const [polling, setPolling]     = useState(false)
  const [myPagirId, setMyPagirId] = useState<string | null>(null)

  const listRef  = useRef<FlatList>(null)
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let alive = true
    bootstrap(alive)
    return () => {
      alive = false
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  async function bootstrap(alive: boolean) {
    await messageStore.init()
    const identity = await identityManager.getIdentity()
    if (!alive) return
    setMyPagirId(identity?.pagirId ?? null)
    await loadMessages()
    await doPoll()
    pollRef.current = setInterval(doPoll, POLL_MS)
  }

  async function loadMessages() {
    const msgs = await messageStore.getByContact(contactPagirId, 100)
    setMessages(msgs.reverse()) // oldest first
    await messageStore.markRead(contactPagirId)
    setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 80)
  }

  const doPoll = useCallback(async () => {
    try {
      setPolling(true)
      const frames = await apiClient.pollFrames()
      if (!frames.length) return
      let hasNew = false
      for (const f of frames) {
        try {
          const json  = fromB64(f.frame)
          const payload = JSON.parse(json)
          const sender  = f.senderId  // authenticated from JWT — trust this
          await messageStore.save({
            id:        payload.id ?? String(f.ts) + sender,
            contactId: sender,
            direction: 'in',
            mimeType:  payload.type === 'file' ? (payload.mime ?? null) : 'text/plain',
            fileName:  payload.type === 'file' ? (payload.name ?? null) : null,
            fileSize:  payload.type === 'file' ? (payload.size ?? null) : null,
            data:      payload.type === 'file' ? (payload.data ?? '') : (payload.text ?? ''),
            ts:        f.ts,
          })
          if (sender === contactPagirId) {
            hasNew = true
            contactStore.updateLastSeen(sender)
          }
        } catch { /* malformed frame — skip */ }
      }
      if (hasNew) await loadMessages()
    } catch { /* network error — silent */ }
    finally { setPolling(false) }
  }, [contactPagirId])

  const handleSend = useCallback(async () => {
    const msg = text.trim()
    if (!msg || !myPagirId || sending) return
    setSending(true)
    const id = newMsgId()
    const payload = { v: 1, type: 'text', id, sender: myPagirId, ts: Date.now(), text: msg }
    const json    = JSON.stringify(payload).padEnd(72, ' ')
    try {
      await apiClient.sendFrame(contactPagirId, toB64(json))
      await messageStore.save({
        id, contactId: contactPagirId, direction: 'out',
        mimeType: 'text/plain', fileName: null, fileSize: null,
        data: msg, ts: Date.now(),
      })
      setText('')
      await loadMessages()
    } catch (e: any) {
      Alert.alert('Send failed', e?.message ?? 'Could not send message. Check your connection.')
    } finally {
      setSending(false)
    }
  }, [text, myPagirId, sending, contactPagirId])

  const handleAttach = useCallback(async () => {
    if (!myPagirId) return
    try {
      const result = await DocumentPicker.pickSingle({
        type: DocumentPicker.types.allFiles,
        copyTo: 'cachesDirectory',
      })
      const fileUri  = result.fileCopyUri ?? result.uri
      const fileSize = result.size ?? 0
      const maxBytes = 1.4 * 1024 * 1024  // 1.4 MB raw → ~1.9 MB base64 → under 2 MB relay limit
      if (fileSize > maxBytes) {
        Alert.alert('File too large', `Max file size is 1.4 MB. Your file is ${fmtSize(fileSize)}.`)
        return
      }
      setSending(true)
      const fileBase64 = await fileToBase64(fileUri)
      const id      = newMsgId()
      const payload = {
        v: 1, type: 'file', id, sender: myPagirId, ts: Date.now(),
        name: result.name ?? 'file',
        mime: result.type ?? 'application/octet-stream',
        size: fileSize,
        data: fileBase64,
      }
      await apiClient.sendFrame(contactPagirId, toB64(JSON.stringify(payload)))
      await messageStore.save({
        id, contactId: contactPagirId, direction: 'out',
        mimeType: result.type ?? 'application/octet-stream',
        fileName: result.name ?? 'file',
        fileSize,
        data: fileBase64, ts: Date.now(),
      })
      await loadMessages()
    } catch (e: any) {
      if (!DocumentPicker.isCancel(e)) {
        Alert.alert('Send failed', e?.message ?? 'Could not send file.')
      }
    } finally {
      setSending(false)
    }
  }, [myPagirId, contactPagirId])

  return (
    <KeyboardAvoidingView
      style={S.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      {/* Top bar */}
      <View style={S.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={S.backBtn}>
          <Text style={S.backText}>←</Text>
        </TouchableOpacity>
        <View style={S.topCenter}>
          <Text style={S.topName} numberOfLines={1}>{contactName}</Text>
          <Text style={S.topId} numberOfLines={1}>{contactPagirId}</Text>
        </View>
        <View style={S.topRight}>
          {polling && <ActivityIndicator size="small" color={Colors.primary} />}
        </View>
      </View>

      {/* Messages */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={m => m.id}
        contentContainerStyle={S.listContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => <MessageBubble msg={item} />}
        ListEmptyComponent={
          <View style={S.emptyState}>
            <Text style={S.emptyIcon}>💬</Text>
            <Text style={S.emptyText}>No messages yet</Text>
            <Text style={S.emptySub}>Send a message or a file to start the conversation.</Text>
          </View>
        }
      />

      {/* Input bar */}
      <View style={S.inputBar}>
        <TouchableOpacity style={S.attachBtn} onPress={handleAttach} disabled={sending}>
          <Text style={S.attachIcon}>📎</Text>
        </TouchableOpacity>
        <TextInput
          style={S.textInput}
          value={text}
          onChangeText={setText}
          placeholder="Message…"
          placeholderTextColor={Colors.textMuted}
          multiline
          maxLength={4000}
          returnKeyType="default"
          editable={!sending}
        />
        <TouchableOpacity
          style={[S.sendBtn, (!text.trim() || sending) && S.sendBtnOff]}
          onPress={handleSend}
          disabled={!text.trim() || sending}
        >
          {sending
            ? <ActivityIndicator size="small" color={Colors.textInverse} />
            : <Text style={S.sendIcon}>↑</Text>
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: Message }) {
  const isSent = msg.direction === 'out'
  const isFile = msg.mimeType !== 'text/plain' && msg.fileName

  return (
    <View style={[S.bubbleWrap, isSent ? S.bubbleWrapSent : S.bubbleWrapRecv]}>
      <View style={[S.bubble, isSent ? S.bubbleSent : S.bubbleRecv]}>
        {isFile ? (
          <View style={S.fileRow}>
            <Text style={S.fileIconText}>{fileIcon(msg.mimeType)}</Text>
            <View style={S.fileMeta}>
              <Text style={[S.fileName, isSent && S.sentText]} numberOfLines={2}>
                {msg.fileName}
              </Text>
              {msg.fileSize != null && (
                <Text style={[S.fileSize, isSent && S.sentSubText]}>
                  {fmtSize(msg.fileSize)}
                </Text>
              )}
            </View>
          </View>
        ) : (
          <Text style={[S.msgText, isSent && S.sentText]}>{msg.data}</Text>
        )}
        <Text style={[S.ts, isSent && S.sentTs]}>{fmtTime(msg.ts)}</Text>
      </View>
    </View>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },

  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingTop: Platform.OS === 'ios' ? 56 : 20,
    paddingBottom: 12, paddingHorizontal: Spacing.base,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.bg,
  },
  backBtn:   { paddingRight: 12, paddingVertical: 4 },
  backText:  { fontSize: 22, color: Colors.primary, fontWeight: '600' },
  topCenter: { flex: 1 },
  topName:   { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  topId:     { fontSize: 11, color: Colors.textMuted, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginTop: 1 },
  topRight:  { width: 28, alignItems: 'center' },

  listContent: { paddingHorizontal: Spacing.base, paddingVertical: Spacing.base, flexGrow: 1 },

  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: 32 },
  emptyIcon:  { fontSize: 48, marginBottom: 16 },
  emptyText:  { fontSize: 18, fontWeight: '700', color: Colors.textSecondary, marginBottom: 8 },
  emptySub:   { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 18 },

  bubbleWrap:     { marginVertical: 3, maxWidth: '80%' },
  bubbleWrapSent: { alignSelf: 'flex-end' },
  bubbleWrapRecv: { alignSelf: 'flex-start' },

  bubble:     { borderRadius: Radius.lg, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleSent: { backgroundColor: Colors.primary },
  bubbleRecv: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },

  msgText:  { fontSize: 15, color: Colors.textPrimary, lineHeight: 21 },
  sentText: { color: Colors.textInverse },

  fileRow:      { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fileIconText: { fontSize: 28 },
  fileMeta:     { flex: 1 },
  fileName:     { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  fileSize:     { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  sentSubText:  { color: 'rgba(15,15,18,0.6)' },

  ts:     { fontSize: 11, color: Colors.textMuted, marginTop: 4, textAlign: 'right' },
  sentTs: { color: 'rgba(15,15,18,0.55)' },

  inputBar: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: Spacing.base, paddingVertical: Spacing.sm,
    paddingBottom: Platform.OS === 'ios' ? 28 : Spacing.sm,
    borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.bg, gap: 8,
  },
  attachBtn:  { width: 42, height: 42, borderRadius: Radius.md, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  attachIcon: { fontSize: 20 },
  textInput:  { flex: 1, minHeight: 42, maxHeight: 120, backgroundColor: Colors.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: Colors.textPrimary },
  sendBtn:    { width: 42, height: 42, borderRadius: 21, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnOff: { backgroundColor: Colors.primaryDeep },
  sendIcon:   { fontSize: 20, color: Colors.textInverse, fontWeight: '700' },
})
