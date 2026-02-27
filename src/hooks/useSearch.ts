import { useState, useCallback, useMemo } from "react"
import { debounce } from "~/lib/utils"
import type { Notebook, SavedPrompt } from "~/lib/types"

export function useSearch<T extends Notebook | SavedPrompt>(
  items: T[],
  searchFn: (item: T, query: string) => boolean
) {
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    if (!query.trim()) return items
    return items.filter((item) => searchFn(item, query.toLowerCase()))
  }, [items, query, searchFn])

  const debouncedSetQuery = useCallback(
    debounce((q: string) => setQuery(q), 200) as (q: string) => void,
    []
  )

  return { query, setQuery: debouncedSetQuery, filtered }
}
