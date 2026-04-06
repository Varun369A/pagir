/**
 * PAGIR 2 — useIdentity hook
 *
 * Loads the local identity (pagirId + publicKey) from IdentityManager.
 * Refreshes when refreshKey changes.
 */

import { useCallback, useEffect, useState } from 'react'
import { identityManager } from '../services/IdentityManager'

interface Identity {
  pagirId:   string
  publicKey: string
}

interface Result {
  identity:  Identity | null
  loading:   boolean
  error:     string | null
  refresh:   () => void
}

export function useIdentity(): Result {
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [tick, setTick]         = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    identityManager.getIdentity()
      .then(id => {
        if (cancelled) return
        setIdentity(id ? { pagirId: id.pagirId, publicKey: id.publicKey } : null)
      })
      .catch(err => {
        if (cancelled) return
        setError(err?.message ?? 'Could not load identity')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [tick])

  const refresh = useCallback(() => setTick(t => t + 1), [])

  return { identity, loading, error, refresh }
}
