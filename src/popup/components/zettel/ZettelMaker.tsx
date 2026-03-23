import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Sparkles, Check, X, Loader2 } from "lucide-react"

import { useNotes } from "~/hooks/useNotes"

interface PreviewNote {
  title: string
  content: string
  tags: string[]
  selected: boolean
}

export function ZettelMaker() {
  const { atomizePreview, saveAtomicNotes } = useNotes()
  const [inputText, setInputText] = useState("")
  const [previewNotes, setPreviewNotes] = useState<PreviewNote[]>([])
  const [isAtomizing, setIsAtomizing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedCount = previewNotes.filter((n) => n.selected).length

  const handleAtomize = async () => {
    if (!inputText.trim() || inputText.length < 200) {
      setError("Text is too short. Minimum of 200 characters.")
      return
    }

    setError(null)
    setIsAtomizing(true)
    setPreviewNotes([])
    setSuccess(false)

    try {
      const notes = await atomizePreview(inputText)
      if (notes.length === 0) {
        setError("No atomic notes were generated. Try a longer text.")
        return
      }
      setPreviewNotes(
        notes.map((n: { title: string; content: string; tags: string[] }) => ({
          ...n,
          selected: true
        }))
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to atomize.")
    } finally {
      setIsAtomizing(false)
    }
  }

  const handleSave = async () => {
    const toSave = previewNotes
      .filter((n) => n.selected)
      .map(({ title, content, tags }) => ({ title, content, tags }))

    if (toSave.length === 0) return

    setIsSaving(true)
    setError(null)

    try {
      await saveAtomicNotes(toSave)
      setSuccess(true)
      setPreviewNotes([])
      setInputText("")
      setTimeout(() => setSuccess(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save notes.")
    } finally {
      setIsSaving(false)
    }
  }

  const toggleNote = (index: number) => {
    setPreviewNotes((prev) =>
      prev.map((n, i) => (i === index ? { ...n, selected: !n.selected } : n))
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-3 py-2 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/5">
        {/* Input area */}
        <AnimatePresence mode="wait">
          {previewNotes.length === 0 && !success && (
            <motion.div
              key="input"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}>
              <div className="mb-2 flex items-center gap-2">
                <Sparkles size={12} className="text-action" />
                <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                  Atomic Maker
                </p>
              </div>
              <p className="mb-2 text-[10px] text-zinc-500">
                Paste a long text and AI will split it into independent atomic notes.
              </p>

              <div className="liquid-glass-panel rounded-[14px] p-0.5">
                <textarea
                  value={inputText}
                  onChange={(e) => {
                    setInputText(e.target.value)
                    setError(null)
                  }}
                  placeholder="Paste text, AI response, article, etc..."
                  rows={7}
                  className="liquid-glass-content w-full resize-none rounded-xl bg-transparent p-2.5 text-[11px] leading-relaxed text-white placeholder:text-zinc-700 focus:outline-none"
                />
              </div>

              <div className="mt-1.5 flex items-center justify-between">
                <span
                  className={[
                    "text-[9px]",
                    inputText.length >= 200 ? "text-zinc-500" : "text-zinc-700"
                  ].join(" ")}>
                  {inputText.length} / 200 min
                </span>
                <button
                  type="button"
                  onClick={handleAtomize}
                  disabled={isAtomizing || inputText.length < 200}
                  className="flex items-center gap-1.5 rounded-xl bg-action/90 px-3.5 py-1.5 text-[11px] font-semibold text-black transition hover:bg-action disabled:opacity-40 disabled:hover:bg-action/90">
                  {isAtomizing ? (
                    <>
                      <Loader2 size={12} className="animate-spin" />
                      Atomizing...
                    </>
                  ) : (
                    <>
                      <Sparkles size={12} />
                      Atomize
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          )}

          {/* Preview cards */}
          {previewNotes.length > 0 && (
            <motion.div
              key="preview"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                  {previewNotes.length} notes generated
                </p>
                <button
                  type="button"
                  onClick={() => setPreviewNotes([])}
                  className="text-[9px] text-zinc-600 transition hover:text-zinc-300">
                  Back
                </button>
              </div>

              <div className="flex flex-col gap-1.5">
                {previewNotes.map((note, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    onClick={() => toggleNote(index)}
                    className={[
                      "liquid-glass-panel cursor-pointer rounded-[12px] p-2.5 transition",
                      note.selected
                        ? "border-action/20"
                        : "opacity-40"
                    ].join(" ")}>
                    <div className="liquid-glass-content">
                      <div className="flex items-start gap-2">
                        <div
                          className={[
                            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition",
                            note.selected
                              ? "border-action bg-action/20 text-action"
                              : "border-zinc-700 text-transparent"
                          ].join(" ")}>
                          <Check size={10} strokeWidth={3} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h4 className="text-[11px] font-semibold text-white">
                            {note.title}
                          </h4>
                          <p className="mt-0.5 line-clamp-2 text-[9px] leading-relaxed text-zinc-500">
                            {note.content}
                          </p>
                          {note.tags.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {note.tags.map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded bg-white/[0.04] px-1 py-0.5 text-[7px] text-zinc-500">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Success */}
          {success && (
            <motion.div
              key="success"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex flex-col items-center justify-center gap-2 py-10">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/15">
                <Check size={18} className="text-green-400" />
              </div>
              <p className="text-[12px] font-medium text-white">Notes saved!</p>
              <p className="text-[10px] text-zinc-500">
                Atomic notes were added to your library.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Error */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-2 flex items-center gap-2 rounded-xl bg-red-500/8 px-3 py-2 text-[10px] text-red-400">
            <X size={12} />
            {error}
          </motion.div>
        )}
      </div>

      {/* Save footer */}
      {previewNotes.length > 0 && (
        <div className="flex items-center justify-between border-t border-white/[0.04] px-3 py-2">
          <span className="text-[10px] text-zinc-600">
            {selectedCount}/{previewNotes.length} selected
          </span>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || selectedCount === 0}
            className="flex items-center gap-1.5 rounded-xl bg-action/90 px-3.5 py-1.5 text-[11px] font-semibold text-black transition hover:bg-action disabled:opacity-40">
            {isSaving ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Saving...
              </>
            ) : (
              `Save ${selectedCount} note${selectedCount !== 1 ? "s" : ""}`
            )}
          </button>
        </div>
      )}
    </div>
  )
}
