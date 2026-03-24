import { useEffect, useRef, useState, useCallback } from "react"
import { motion, type PanInfo } from "framer-motion"
import { flushSync } from "react-dom"
import { Plus, Link2, Unlink, Network, Loader2 } from "lucide-react"

import { useNotes } from "~/hooks/useNotes"
import { useAuth } from "~/hooks/useAuth"
import { zettelkastenService } from "~/services/zettelkasten"
import { LoadingSpinner } from "~/components/LoadingSpinner"
import type { Note } from "~/lib/types"

// ─── Constants ───────────────────────────────────────────────────────────────

const NODE_WIDTH = 196
const NODE_HEIGHT = 100
const STORAGE_KEY_PREFIX = "minddock_zettel_canvas_pos_"

type Position = { x: number; y: number }

// ─── localStorage helpers ────────────────────────────────────────────────────

function loadPositions(userId: string): Record<string, Position> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + userId)
    return raw ? (JSON.parse(raw) as Record<string, Position>) : {}
  } catch {
    return {}
  }
}

function savePositions(userId: string, positions: Record<string, Position>) {
  try {
    localStorage.setItem(STORAGE_KEY_PREFIX + userId, JSON.stringify(positions))
  } catch {}
}

function getInitialPosition(index: number): Position {
  const cols = 3
  const col = index % cols
  const row = Math.floor(index / cols)
  return {
    x: 24 + col * (NODE_WIDTH + 44),
    y: 24 + row * (NODE_HEIGHT + 44)
  }
}

// ─── Deduplicate connections ─────────────────────────────────────────────────

function buildConnections(notes: Note[]): Array<{ from: string; to: string }> {
  const seen = new Set<string>()
  const out: Array<{ from: string; to: string }> = []
  for (const note of notes) {
    for (const targetId of note.linkedNoteIds) {
      const key = [note.id, targetId].sort().join("||")
      if (!seen.has(key)) {
        seen.add(key)
        out.push({ from: note.id, to: targetId })
      }
    }
  }
  return out
}

// ─── Connection SVG line ─────────────────────────────────────────────────────

function ConnectionLine({
  from,
  to,
  positions
}: {
  from: string
  to: string
  positions: Record<string, Position>
}) {
  const fromPos = positions[from]
  const toPos = positions[to]
  if (!fromPos || !toPos) return null

  const startX = fromPos.x + NODE_WIDTH
  const startY = fromPos.y + NODE_HEIGHT / 2
  const endX = toPos.x
  const endY = toPos.y + NODE_HEIGHT / 2
  const cp1X = startX + (endX - startX) * 0.5
  const cp2X = endX - (endX - startX) * 0.5
  const d = `M${startX},${startY} C${cp1X},${startY} ${cp2X},${endY} ${endX},${endY}`

  return (
    <path
      d={d}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeDasharray="6,5"
      strokeLinecap="round"
      opacity={0.35}
      className="text-action"
    />
  )
}

// ─── Note block ──────────────────────────────────────────────────────────────

function NoteBlock({
  note,
  isSource,
  isConnectMode,
  isDragging,
  onConnectStart,
  onUnlink,
  notesMap
}: {
  note: Note
  isSource: boolean
  isConnectMode: boolean
  isDragging: boolean
  onConnectStart: () => void
  onUnlink: (fromId: string, toId: string) => Promise<void>
  notesMap: Record<string, Note>
}) {
  const [showLinks, setShowLinks] = useState(false)
  const isTarget = isConnectMode && !isSource

  return (
    <div
      className={[
        "relative w-full overflow-hidden rounded-xl border bg-[#0d0d0d] p-3 transition-all duration-150",
        isSource
          ? "border-action/60 shadow-[0_0_14px_rgba(250,204,21,0.12)]"
          : isTarget
            ? "border-white/20 hover:border-action/40 hover:shadow-[0_0_8px_rgba(250,204,21,0.08)]"
            : isDragging
              ? "border-white/20 shadow-xl"
              : "border-white/[0.06] hover:border-white/[0.12]"
      ].join(" ")}
    >
      {/* Header row */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold leading-tight text-white">
            {note.title}
          </p>
          {note.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {note.tags.slice(0, 2).map((tag) => (
                <span
                  key={tag}
                  className="rounded-md bg-white/[0.05] px-1.5 py-0.5 text-[8px] text-zinc-500"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Connect / source badge */}
        {isSource ? (
          <span className="shrink-0 animate-pulse rounded-md bg-action/15 px-1.5 py-0.5 text-[8px] font-medium text-action">
            source
          </span>
        ) : (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onConnectStart()
            }}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-lg border border-white/[0.07] text-zinc-600 transition hover:border-action/40 hover:text-action"
            title="Connect to another note"
          >
            <Plus size={9} />
          </button>
        )}
      </div>

      {/* Link count toggle */}
      {note.linkedNoteIds.length > 0 && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            setShowLinks((v) => !v)
          }}
          className="mt-2 flex items-center gap-1 text-[8px] text-zinc-600 transition hover:text-zinc-400"
        >
          <Link2 size={8} />
          {note.linkedNoteIds.length} link{note.linkedNoteIds.length !== 1 ? "s" : ""}
        </button>
      )}

      {/* Expanded link list */}
      {showLinks && note.linkedNoteIds.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {note.linkedNoteIds.map((linkedId) => {
            const linked = notesMap[linkedId]
            if (!linked) return null
            return (
              <div
                key={linkedId}
                className="flex items-center justify-between rounded-lg bg-white/[0.03] px-2 py-1"
              >
                <span className="truncate text-[9px] text-zinc-400">
                  {linked.title}
                </span>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    onUnlink(note.id, linkedId)
                  }}
                  className="ml-1.5 shrink-0 text-zinc-700 transition hover:text-red-400"
                  title="Remove link"
                >
                  <Unlink size={9} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Main ZettelCanvas ───────────────────────────────────────────────────────

export function ZettelCanvas() {
  const { user } = useAuth()
  const { notes, isLoading, refetch } = useNotes()
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragStartPos = useRef<Position | null>(null)

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [positions, setPositions] = useState<Record<string, Position>>({})
  const [contentSize, setContentSize] = useState({ width: 800, height: 600 })
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null)
  const [isLinking, setIsLinking] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  // Init positions from localStorage, fill missing with grid layout
  useEffect(() => {
    if (!user || notes.length === 0) return
    const saved = loadPositions(user.id)
    const merged: Record<string, Position> = {}
    notes.forEach((note, i) => {
      merged[note.id] = saved[note.id] ?? getInitialPosition(i)
    })
    setPositions(merged)
    const maxX = Math.max(...Object.values(merged).map((p) => p.x + NODE_WIDTH))
    const maxY = Math.max(...Object.values(merged).map((p) => p.y + NODE_HEIGHT))
    setContentSize({ width: maxX + 60, height: maxY + 60 })
  }, [user, notes])

  // Persist positions
  useEffect(() => {
    if (!user || Object.keys(positions).length === 0) return
    savePositions(user.id, positions)
  }, [user, positions])

  // Drag
  const handleDragStart = useCallback(
    (noteId: string) => {
      setDraggingId(noteId)
      const pos = positions[noteId]
      if (pos) dragStartPos.current = { x: pos.x, y: pos.y }
    },
    [positions]
  )

  const handleDrag = useCallback((noteId: string, { offset }: PanInfo) => {
    if (!dragStartPos.current) return
    const newX = Math.max(0, dragStartPos.current.x + offset.x)
    const newY = Math.max(0, dragStartPos.current.y + offset.y)
    flushSync(() => {
      setPositions((prev) => ({ ...prev, [noteId]: { x: newX, y: newY } }))
    })
    setContentSize((prev) => ({
      width: Math.max(prev.width, newX + NODE_WIDTH + 60),
      height: Math.max(prev.height, newY + NODE_HEIGHT + 60)
    }))
  }, [])

  const handleDragEnd = useCallback(() => {
    setDraggingId(null)
    dragStartPos.current = null
  }, [])

  // Connect: click on target block
  const handleBlockClick = useCallback(
    async (noteId: string) => {
      if (!connectingFrom || !user) return
      if (connectingFrom === noteId) {
        setConnectingFrom(null)
        return
      }
      const sourceNote = notes.find((n) => n.id === connectingFrom)
      if (sourceNote?.linkedNoteIds.includes(noteId)) {
        setConnectingFrom(null)
        return
      }
      setIsLinking(true)
      try {
        await zettelkastenService.createLink(connectingFrom, noteId, user.id)
        await refetch()
        setFeedback("Connected!")
        setTimeout(() => setFeedback(null), 2000)
      } catch {
        setFeedback("Failed.")
        setTimeout(() => setFeedback(null), 2000)
      } finally {
        setIsLinking(false)
        setConnectingFrom(null)
      }
    },
    [connectingFrom, user, notes, refetch]
  )

  // Unlink
  const handleUnlink = useCallback(
    async (fromId: string, toId: string) => {
      try {
        await zettelkastenService.deleteLink(fromId, toId)
        await zettelkastenService.deleteLink(toId, fromId)
        await refetch()
      } catch {}
    },
    [refetch]
  )

  const connections = buildConnections(notes)
  const notesMap = Object.fromEntries(notes.map((n) => [n.id, n]))

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size={18} />
      </div>
    )
  }

  if (notes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10">
        <div className="liquid-glass-soft flex h-10 w-10 items-center justify-center rounded-2xl">
          <Network size={16} className="text-zinc-500" />
        </div>
        <p className="text-[11px] font-medium text-zinc-400">Canvas vazio</p>
        <p className="px-6 text-center text-[10px] text-zinc-600">
          Crie notas para visualizar e conectar seu grafo de conhecimento.
        </p>
      </div>
    )
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* Connect mode banner */}
      {connectingFrom && (
        <div className="flex shrink-0 items-center justify-between border-b border-action/20 bg-action/8 px-3 py-1.5">
          <div className="flex items-center gap-1.5">
            {isLinking && <Loader2 size={10} className="animate-spin text-action" />}
            <p className="text-[10px] font-medium text-action">
              {isLinking ? "Connecting..." : "Click a note to connect →"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConnectingFrom(null)}
            className="text-[9px] text-zinc-500 transition hover:text-zinc-300"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Canvas */}
      <div
        ref={canvasRef}
        className="relative flex-1 overflow-auto"
        style={{ background: "#050505" }}
      >
        <div
          className="relative"
          style={{ minWidth: contentSize.width, minHeight: contentSize.height }}
        >
          {/* SVG connection layer */}
          <svg
            className="pointer-events-none absolute left-0 top-0"
            width={contentSize.width}
            height={contentSize.height}
            style={{ overflow: "visible" }}
            aria-hidden="true"
          >
            {connections.map((c) => (
              <ConnectionLine
                key={`${c.from}||${c.to}`}
                from={c.from}
                to={c.to}
                positions={positions}
              />
            ))}
          </svg>

          {/* Note blocks */}
          {notes.map((note) => {
            const pos = positions[note.id]
            if (!pos) return null
            const isSource = connectingFrom === note.id
            const isConnectMode = !!connectingFrom

            return (
              <motion.div
                key={note.id}
                drag={!connectingFrom}
                dragMomentum={false}
                dragConstraints={{ left: 0, top: 0, right: 100000, bottom: 100000 }}
                onDragStart={() => handleDragStart(note.id)}
                onDrag={(_, info) => handleDrag(note.id, info)}
                onDragEnd={handleDragEnd}
                onClick={() => !isSource && isConnectMode && handleBlockClick(note.id)}
                style={{
                  x: pos.x,
                  y: pos.y,
                  width: NODE_WIDTH,
                  transformOrigin: "0 0",
                  position: "absolute",
                  cursor: isConnectMode
                    ? isSource
                      ? "default"
                      : "crosshair"
                    : "grab"
                }}
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ duration: 0.15 }}
                whileDrag={{ scale: 1.03, zIndex: 50, cursor: "grabbing" }}
              >
                <NoteBlock
                  note={note}
                  isSource={isSource}
                  isConnectMode={isConnectMode}
                  isDragging={draggingId === note.id}
                  onConnectStart={() => setConnectingFrom(note.id)}
                  onUnlink={handleUnlink}
                  notesMap={notesMap}
                />
              </motion.div>
            )
          })}
        </div>
      </div>

      {/* Footer stats */}
      <div className="flex shrink-0 items-center justify-between border-t border-white/[0.04] px-3 py-1.5">
        <div className="flex items-center gap-3 text-[9px] text-zinc-600">
          <span>{notes.length} notes</span>
          <span>{connections.length} connections</span>
        </div>
        {feedback ? (
          <span className="text-[9px] font-medium text-action">{feedback}</span>
        ) : (
          <span className="text-[9px] text-zinc-700">drag to reposition</span>
        )}
      </div>
    </div>
  )
}
