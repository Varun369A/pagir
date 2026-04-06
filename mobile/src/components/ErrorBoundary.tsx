/**
 * PAGIR 2 — Error Boundary
 *
 * Catches unhandled React render errors and shows a recovery UI
 * instead of a blank crash screen.
 */

import React, { Component, type ReactNode } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { Colors, Spacing, Radius, Typography } from '../theme'

interface Props  { children: ReactNode }
interface State  { hasError: boolean; message: string }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error?.message ?? 'Unknown error' }
  }

  handleReset = () => {
    this.setState({ hasError: false, message: '' })
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <View style={S.container}>
        <View style={S.card}>
          <Text style={S.icon}>⚠</Text>
          <Text style={S.title}>Something went wrong</Text>
          <Text style={S.message}>{this.state.message}</Text>
          <TouchableOpacity style={S.btn} onPress={this.handleReset}>
            <Text style={S.btnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }
}

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  card:      { backgroundColor: Colors.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.danger, padding: Spacing.xl, alignItems: 'center', gap: 12, width: '100%' },
  icon:      { fontSize: 40, color: Colors.danger },
  title:     { ...Typography.xl, color: Colors.textPrimary },
  message:   { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 18 },
  btn:       { marginTop: 8, height: 48, backgroundColor: Colors.primary, borderRadius: Radius.lg, paddingHorizontal: Spacing.xl, alignItems: 'center', justifyContent: 'center' },
  btnText:   { fontSize: 15, fontWeight: '700', color: Colors.textInverse },
})
