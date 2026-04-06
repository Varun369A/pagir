/**
 * PAGIR 2 — PagirButton
 *
 * Standardised button component with variants:
 *   primary   — filled, Colors.primary background
 *   secondary — outlined, Colors.border
 *   danger    — filled, Colors.danger
 *   ghost     — no border, text-only
 *
 * States: default / loading / disabled
 */

import React from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, type ViewStyle } from 'react-native'
import { Colors, Radius } from '../theme'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'

interface Props {
  label:    string
  onPress:  () => void
  variant?: Variant
  loading?: boolean
  disabled?: boolean
  style?: ViewStyle
}

export function PagirButton({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
}: Props) {
  const isDisabled = disabled || loading
  return (
    <TouchableOpacity
      style={[S.base, S[variant], isDisabled && S.disabled, style]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.75}
    >
      {loading
        ? <ActivityIndicator color={variant === 'secondary' || variant === 'ghost' ? Colors.primary : Colors.textInverse} />
        : <Text style={[S.label, ST[variant]]}>{label}</Text>
      }
    </TouchableOpacity>
  )
}

const S = StyleSheet.create({
  base:      { height: 54, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  primary:   { backgroundColor: Colors.primary },
  secondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.border },
  danger:    { backgroundColor: Colors.danger },
  ghost:     { backgroundColor: 'transparent' },
  disabled:  { opacity: 0.45 },
  label:     { fontSize: 16, fontWeight: '700' },
})

const ST = StyleSheet.create({
  primary:   { color: Colors.textInverse },
  secondary: { color: Colors.textSecondary },
  danger:    { color: Colors.textInverse },
  ghost:     { color: Colors.primary },
})
