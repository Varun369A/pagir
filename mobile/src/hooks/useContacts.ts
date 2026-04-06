/**
 * PAGIR 2 — useContacts hook
 *
 * Returns active (non-blocked) contacts from local SQLite store.
 * Provides add / remove / block helpers.
 */

import { useCallback, useEffect, useState } from 'react'
import { contactStore, type Contact } from '../services/ContactStore'

interface Result {
  contacts: Contact[]
  loading:  boolean
  error:    string | null
  refresh:  () => void
  addContact: (c: Omit<Contact, 'addedAt' | 'lastSeen' | 'blockedAt'>) => void
  removeContact: (pagirId: string) => void
  blockContact:  (pagirId: string) => void
}

export function useContacts(): Result {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [tick, setTick]         = useState(0)

  useEffect(() => {
    setLoading(true)
    setError(null)
    try {
      contactStore.init()
      const all = contactStore.getAll()
      setContacts(all.filter(c => !c.blockedAt))
    } catch (err: any) {
      setError(err?.message ?? 'Could not load contacts')
    } finally {
      setLoading(false)
    }
  }, [tick])

  const refresh = useCallback(() => setTick(t => t + 1), [])

  const addContact = useCallback((c: Omit<Contact, 'addedAt' | 'lastSeen' | 'blockedAt'>) => {
    contactStore.add(c)
    refresh()
  }, [refresh])

  const removeContact = useCallback((pagirId: string) => {
    contactStore.remove(pagirId)
    refresh()
  }, [refresh])

  const blockContact = useCallback((pagirId: string) => {
    contactStore.block(pagirId)
    refresh()
  }, [refresh])

  return { contacts, loading, error, refresh, addContact, removeContact, blockContact }
}
