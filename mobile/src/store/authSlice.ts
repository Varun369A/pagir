/**
 * PAGIR 2 — Auth Redux slice
 */

import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { apiClient } from './apiClient'
import { identityManager } from '../services/IdentityManager'

interface AuthState {
  isAuthenticated: boolean
  isOfflineMode:   boolean
  pagirId:         string | null
  loading:         boolean
  error:           string | null
  otpSent:         boolean
  alreadyRegistered: boolean
}

const initialState: AuthState = {
  isAuthenticated:   false,
  isOfflineMode:     false,
  pagirId:           null,
  loading:           false,
  error:             null,
  otpSent:           false,
  alreadyRegistered: false,
}

// ─── Thunks ───────────────────────────────────────────────────────────────────

export const requestOtp = createAsyncThunk(
  'auth/requestOtp',
  async (params: { phoneNumber: string; email: string; platform: 'android' | 'ios' }) => {
    await AsyncStorage.setItem('pagir2:registered_phone', params.phoneNumber).catch(() => {})
    return apiClient.requestOtp(params.phoneNumber, params.email, params.platform)
  }
)

export const verifyOtp = createAsyncThunk(
  'auth/verifyOtp',
  async (params: {
    phoneNumber: string
    otp: string
    displayName?: string
    platform?: 'android' | 'ios'
  }) => {
    // Ensure identity exists before verifying
    await identityManager.ensureIdentity()
    const identity = await identityManager.getIdentity()
    if (!identity) throw new Error('Could not initialize device identity. Please restart the app.')

    // Device fingerprint — SHA-256 of a stable device identifier
    const deviceFingerprint = await _getDeviceFingerprint()

    const result = await apiClient.verifyOtp({
      phoneNumber:       params.phoneNumber,
      otp:               params.otp,
      pagirId:           identity.pagirId,
      deviceFingerprint,
      publicKey:         identity.publicKey,
      name:              params.displayName ?? 'PAGIR User',
      platform:          params.platform,
    })

    // Server may return a different pagirId (identity recovery after reinstall)
    if (result.pagirId && result.pagirId !== identity.pagirId) {
      await identityManager.storePagirId(result.pagirId)
    }

    // Persist registration markers
    await AsyncStorage.multiSet([
      ['pagir2:registered_id', result.pagirId],
      ...(params.displayName ? [['pagir2:registered_name', params.displayName] as [string, string]] : []),
    ]).catch(() => {})

    return result
  }
)

export const loadProfile = createAsyncThunk('auth/loadProfile', async () => {
  return apiClient.getMyProfile()
})

// ─── Slice ────────────────────────────────────────────────────────────────────

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setOfflineMode(state) {
      state.isAuthenticated = true
      state.isOfflineMode   = true
    },
    clearOfflineMode(state) {
      state.isOfflineMode = false
    },
    setAuthenticated(state, action: PayloadAction<string>) {
      state.isAuthenticated = true
      state.pagirId         = action.payload
    },
    clearAuth(state) {
      return { ...initialState }
    },
    clearError(state) {
      state.error = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(requestOtp.pending, (state) => {
        state.loading = true
        state.error   = null
        state.alreadyRegistered = false
      })
      .addCase(requestOtp.fulfilled, (state, action) => {
        state.loading = false
        state.otpSent = true
        state.alreadyRegistered = action.payload.alreadyRegistered
      })
      .addCase(requestOtp.rejected, (state, action) => {
        state.loading = false
        state.error   = action.error.message ?? 'Failed to send verification code'
      })

    builder
      .addCase(verifyOtp.pending, (state) => {
        state.loading = true
        state.error   = null
      })
      .addCase(verifyOtp.fulfilled, (state, action) => {
        state.loading         = false
        state.isAuthenticated = true
        state.pagirId         = action.payload.pagirId
        state.otpSent         = false
      })
      .addCase(verifyOtp.rejected, (state, action) => {
        state.loading = false
        state.error   = action.error.message ?? 'Invalid verification code'
      })
  },
})

export const { setOfflineMode, clearOfflineMode, setAuthenticated, clearAuth, clearError } = authSlice.actions
export default authSlice.reducer

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function _getDeviceFingerprint(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem('pagir2:device_fingerprint')
    if (stored?.length === 64) return stored
  } catch {}

  // Generate a stable device fingerprint from random bytes (per-install)
  const cryptoLib: any = require('react-native-quick-crypto')
  const fp = cryptoLib.randomBytes(32).toString('hex')
  await AsyncStorage.setItem('pagir2:device_fingerprint', fp).catch(() => {})
  return fp
}
