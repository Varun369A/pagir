/**
 * PAGIR 2 — Push Service
 *
 * Registers FCM (Android) / APNs (iOS) device tokens with the PAGIR server.
 * Push notifications are used ONLY as a wake signal — not to deliver content.
 *
 * PRIVACY MODEL:
 *   - Notification payload: { type: "pagir_ping", senderId: "PAG-..." }
 *   - Content NEVER in push payload — server cannot read messages
 *   - Push wakes the app → app fetches pending frames via WebSocket
 *   - If offline mesh → push is irrelevant (direct BLE/WiFi transfer)
 *
 * SECURITY:
 *   - Device token stored on server encrypted (associated with user)
 *   - Revoked on emergency wipe / logout
 *   - FCM/APNs tokens rotate regularly — re-register on token refresh
 */

import { Platform } from 'react-native'
import { apiClient } from '../store/apiClient'

class PushService {
  private _registered = false

  async register(): Promise<void> {
    if (this._registered) return

    try {
      const token = await this._getDeviceToken()
      if (!token) return

      await apiClient.registerPushToken(token, Platform.OS as 'android' | 'ios')
      this._registered = true
    } catch (err) {
      // Non-fatal — push is enhancement only, not required for core function
      console.warn('[PushService] Registration failed:', err)
    }
  }

  async unregister(): Promise<void> {
    try {
      await apiClient.unregisterPushToken()
      this._registered = false
    } catch {}
  }

  private async _getDeviceToken(): Promise<string | null> {
    try {
      if (Platform.OS === 'ios') {
        // iOS: react-native-push-notification-ios
        const PushNotificationIOS = require('@react-native-community/push-notification-ios').default
        return new Promise((resolve) => {
          PushNotificationIOS.requestPermissions().then(() => {
            PushNotificationIOS.addEventListener('register', (token: string) => {
              resolve(token)
            })
          }).catch(() => resolve(null))
        })
      } else {
        // Android: @react-native-firebase/messaging
        const messaging = require('@react-native-firebase/messaging').default
        const authStatus = await messaging().requestPermission()
        if (authStatus < 1) return null
        return await messaging().getToken()
      }
    } catch {
      return null
    }
  }
}

export const pushService = new PushService()
