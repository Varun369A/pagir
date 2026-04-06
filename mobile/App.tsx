/**
 * PAGIR 2 — App root
 *
 * Wraps the full app in:
 *   - Redux Provider
 *   - ErrorBoundary (crash recovery)
 *   - AppNavigator (navigation container)
 */

import React from 'react'
import { Provider } from 'react-redux'
import { store } from './src/store'
import { ErrorBoundary } from './src/components/ErrorBoundary'
import AppNavigator from './src/navigation/AppNavigator'

export default function App() {
  return (
    <Provider store={store}>
      <ErrorBoundary>
        <AppNavigator />
      </ErrorBoundary>
    </Provider>
  )
}
