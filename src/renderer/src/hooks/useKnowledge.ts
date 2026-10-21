import { useCallback, useEffect, useState } from 'react'
import type { DocumentRecord, ImportResult, MemoryRecord } from '@shared/types'

export interface KnowledgeController {
  memories: MemoryRecord[]
  documents: DocumentRecord[]
  importing: boolean
  notice: string | null
  error: string | null
  addMemory: (text: string, tags: string) => Promise<void>
  togglePinned: (record: MemoryRecord) => Promise<void>
  updateMemory: (id: string, text: string) => Promise<void>
  deleteMemory: (id: string) => Promise<void>
  clearMemories: () => Promise<void>
  importDocuments: () => Promise<void>
  deleteDocument: (id: string) => Promise<void>
  clearDocuments: () => Promise<void>
}

/**
 * What the assistant knows about the user.
 *
 * This is the grounding for a meeting answer: a resume, a project
 * description, a document you were sent. It is the difference between an
 * answer about you and a generic one.
 */
export function useKnowledge(): KnowledgeController {
  const [memories, setMemories] = useState<MemoryRecord[]>([])
  const [documents, setDocuments] = useState<DocumentRecord[]>([])
  const [importing, setImporting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refreshMemory = useCallback(async (): Promise<void> => {
    setMemories(await window.klyro.memoryList())
  }, [])

  const refreshDocuments = useCallback(async (): Promise<void> => {
    setDocuments(await window.klyro.documentList())
  }, [])

  useEffect(() => {
    void refreshMemory()
    void refreshDocuments()
  }, [refreshMemory, refreshDocuments])

  const guard = useCallback(async (action: () => Promise<void>): Promise<void> => {
    setError(null)
    try {
      await action()
    } catch (caught) {
      setError((caught as Error).message)
    }
  }, [])

  const addMemory = useCallback(
    async (text: string, tags: string): Promise<void> => {
      await guard(async () => {
        const list = tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
        setMemories(await window.klyro.memoryAdd({ text, tags: list, source: 'user' }))
      })
    },
    [guard]
  )

  const togglePinned = useCallback(
    async (record: MemoryRecord): Promise<void> => {
      await guard(async () => {
        setMemories(await window.klyro.memoryUpdate(record.id, { pinned: !record.pinned }))
      })
    },
    [guard]
  )

  const updateMemory = useCallback(
    async (id: string, text: string): Promise<void> => {
      await guard(async () => {
        setMemories(await window.klyro.memoryUpdate(id, { text }))
      })
    },
    [guard]
  )

  const deleteMemory = useCallback(
    async (id: string): Promise<void> => {
      await guard(async () => {
        setMemories(await window.klyro.memoryDelete(id))
      })
    },
    [guard]
  )

  const clearMemories = useCallback(async (): Promise<void> => {
    await guard(async () => {
      setMemories(await window.klyro.memoryClear())
    })
  }, [guard])

  const importDocuments = useCallback(async (): Promise<void> => {
    setError(null)
    setNotice(null)
    setImporting(true)
    try {
      const result: ImportResult = await window.klyro.documentImport()
      await refreshDocuments()
      const parts: string[] = []
      if (result.imported.length) parts.push(`Added ${result.imported.length} document(s).`)
      if (result.skipped.length) parts.push(`Skipped ${result.skipped.length}: ${result.skipped.map((s) => `${s.name} — ${s.reason}`).join('; ')}`)
      setNotice(parts.join(' ') || 'Nothing selected.')
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setImporting(false)
    }
  }, [refreshDocuments])

  const deleteDocument = useCallback(
    async (id: string): Promise<void> => {
      await guard(async () => {
        setDocuments(await window.klyro.documentDelete(id))
      })
    },
    [guard]
  )

  const clearDocuments = useCallback(async (): Promise<void> => {
    await guard(async () => {
      setDocuments(await window.klyro.documentClear())
    })
  }, [guard])

  return {
    memories,
    documents,
    importing,
    notice,
    error,
    addMemory,
    togglePinned,
    updateMemory,
    deleteMemory,
    clearMemories,
    importDocuments,
    deleteDocument,
    clearDocuments
  }
}
