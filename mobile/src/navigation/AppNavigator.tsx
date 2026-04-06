/**
 * PAGIR 2 — App Navigator
 *
 * Flat stack. SplashScreen handles all initial routing logic.
 * All screens are always registered — deep-link safe.
 */

import React from 'react'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import { Colors } from '../theme'

// Screens
import SplashScreen          from '../screens/SplashScreen'
import RegistrationScreen    from '../screens/RegistrationScreen'
import LoginScreen           from '../screens/LoginScreen'
import OTPScreen             from '../screens/OTPScreen'
import HomeScreen            from '../screens/HomeScreen'
import AddContactScreen      from '../screens/AddContactScreen'
import ShareIdentityScreen   from '../screens/ShareIdentityScreen'
import EmergencyScreen       from '../screens/EmergencyScreen'
import { SettingsScreen }    from '../screens/SettingsScreen'

export type RootStackParamList = {
  // Onboarding
  Splash:       undefined
  Registration: undefined
  Login:        undefined
  OTP: {
    phoneNumber: string   // empty string when isEmailOnly = true
    email:       string
    isNewUser?:  boolean
    displayName?: string
    isEmailOnly?: boolean
  }

  // Main
  Home:            undefined
  AddContact:      undefined
  ShareIdentity:   undefined
  Settings:        undefined
  Emergency:       undefined
}

const Stack = createNativeStackNavigator<RootStackParamList>()

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Splash"
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: Colors.bg },
        }}
      >
        <Stack.Screen name="Splash"        component={SplashScreen} />
        <Stack.Screen name="Registration"  component={RegistrationScreen} />
        <Stack.Screen name="Login"         component={LoginScreen} />
        <Stack.Screen name="OTP"           component={OTPScreen} />
        <Stack.Screen name="Home"          component={HomeScreen} />
        <Stack.Screen name="AddContact"    component={AddContactScreen} />
        <Stack.Screen name="ShareIdentity" component={ShareIdentityScreen} />
        <Stack.Screen name="Settings"      component={SettingsScreen} />
        <Stack.Screen name="Emergency"     component={EmergencyScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  )
}
