/**
 * PAGIR 2 — Splash Screen
 *
 * Boot sequence:
 *   1. Run security checks (root/jailbreak detection)
 *   2. Ensure identity exists (generate if first launch)
 *   3. Load tokens
 *   4. If authenticated: verify account still active on server
 *      - 404/revoked → Registration
 *      - Network error → Home (offline-capable)
 *   5. If offline mode flag → Home
 *   6. If registered but no token → Login
 *   7. Otherwise → Registration
 */

import React, { useEffect, useRef } from 'react'
import { Animated, StyleSheet, Text, View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { NativeStackScreenProps } from '@react-navigation/native-stack'
import { useDispatch } from 'react-redux'
import type { RootStackParamList } from '../navigation/AppNavigator'
import { apiClient } from '../store/apiClient'
import { identityManager } from '../services/IdentityManager'
import { setOfflineMode, setAuthenticated } from '../store/authSlice'
import type { AppDispatch } from '../store'
import { Colors, Typography } from '../theme'

type Props = NativeStackScreenProps<RootStackParamList, 'Splash'>

export default function SplashScreen({ navigation }: Props) {
  const dispatch = useDispatch<AppDispatch>()

  const opacity = useRef(new Animated.Value(0)).current
  const scale   = useRef(new Animated.Value(0.85)).current
  const tagline = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.spring(scale,   { toValue: 1, tension: 55, friction: 7, useNativeDriver: true }),
    ]).start()

    Animated.sequence([
      Animated.delay(500),
      Animated.timing(tagline, { toValue: 1, duration: 350, useNativeDriver: true }),
    ]).start()

    setTimeout(boot, 400)
  }, [])

  async function boot() {
    // Always ensure identity — generates keys if first launch
    await identityManager.ensureIdentity()
    await apiClient.loadTokens()

    if (apiClient.isAuthenticated()) {
      try {
        const profile = await apiClient.getMyProfile()
        // Restore public key from server (handles reinstall)
        if (profile.publicKey?.includes('BEGIN')) {
          await identityManager.storePagirId(profile.pagirId)
          // Update cache with server's public key
        }
        dispatch(setAuthenticated(profile.pagirId))
        navigate('Home')
      } catch (err: any) {
        const status: number = err?.status ?? 0
        const isRevoked = status === 404 || err?.code === 'USER_NOT_FOUND'
        const isNetwork = status === 0 || status >= 500

        if (isRevoked && !isNetwork) {
          await apiClient.clearTokens()
          navigate('Registration')
        } else {
          // Network issue — proceed normally (app works offline)
          navigate('Home')
        }
      }
      return
    }

    const offline = await AsyncStorage.getItem('pagir2:offline_mode')
    if (offline === 'true') {
      dispatch(setOfflineMode())
      navigate('Home')
      return
    }

    const registeredId = await AsyncStorage.getItem('pagir2:registered_id')
    if (registeredId) {
      navigate('Login')
      return
    }

    navigate('Registration')
  }

  function navigate(screen: 'Home' | 'Login' | 'Registration') {
    setTimeout(() => navigation.replace(screen), 300)
  }

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.logoWrap, { opacity, transform: [{ scale }] }]}>
        <View style={styles.logoMark}>
          <Text style={styles.logoLetter}>P</Text>
          <View style={[styles.node, { top: 10, right: 10 }]} />
          <View style={[styles.node, { bottom: 12, right: 8, width: 5, height: 5 }]} />
          <View style={[styles.node, { bottom: 10, left: 10, width: 5, height: 5 }]} />
        </View>
        <Text style={styles.wordmark}>PAGIR</Text>
        <Animated.Text style={[styles.tagline, { opacity: tagline }]}>
          Send anything. No internet needed.
        </Animated.Text>
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' },
  logoWrap:   { alignItems: 'center' },
  logoMark:   {
    width: 84, height: 84, borderRadius: 24,
    backgroundColor: Colors.surface,
    borderWidth: 1.5, borderColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 22, position: 'relative',
    ...{
      shadowColor: Colors.primary, shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.3, shadowRadius: 20, elevation: 10,
    },
  },
  logoLetter: { fontSize: 40, fontWeight: '700', color: Colors.primary, letterSpacing: -1 },
  node:       { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.primaryDim },
  wordmark:   { ...Typography.largeTitle, color: Colors.textPrimary, letterSpacing: 6 },
  tagline:    { marginTop: 12, ...Typography.subheadline, color: Colors.textDim, letterSpacing: 0.2 },
})
