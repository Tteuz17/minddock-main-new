import { useEffect, useRef, useState, useCallback } from "react"
import { motion } from "framer-motion"
import type { Edge, Network, Node, Options } from "vis-network"
import type { DataSet } from "vis-data"
import { Search, Network as NetworkIcon } from "lucide-react"

import { useAuth } from "~/hooks/useAuth"
import { zettelkastenService } from "~/services/zettelkasten"
import { LoadingSpinner } from "~/components/LoadingSpinner"
import type { GraphData } from "~/lib/types"

interface ZettelGraphViewProps {
  onSelectNote: (noteId: string) => void
}

export function ZettelGraphView({ onSelectNote }: ZettelGraphViewProps) {
  const { user } = useAuth()
  const containerRef = useRef<HTMLDivElement>(null)
  const networkRef = useRef<Network | null>(null)
  const nodesDataSetRef = useRef<DataSet<Node> | null>(null)
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState("")
  const [matchCount, setMatchCount] = useState(0)

  useEffect(() => {
    if (!user) return
    zettelkastenService.getGraphData(user.id).then((data) => {
      setGraphData(data)
      setIsLoading(false)
    })
  }, [user])

  const applySearchFilter = useCallback(
    (query: string) => {
      if (!nodesDataSetRef.current || !graphData) return

      const normalized = query.toLowerCase().trim()

      if (!normalized) {
        // Reset all nodes
        const resetNodes = graphData.nodes.map((n) => ({
          id: n.id,
          color: {
            background: n.color ?? "#3b82f6",
            border: "rgba(255,255,255,0.2)",
            highlight: { background: "#facc15", border: "#facc15" }
          },
          font: { color: "#ffffff", size: 11 },
          size: n.size ?? 12,
          opacity: 1
        }))
        nodesDataSetRef.current.update(resetNodes as Node[])
        setMatchCount(0)
        return
      }

      const matchingIds = new Set(
        graphData.nodes
          .filter((n) => n.title.toLowerCase().includes(normalized))
          .map((n) => n.id)
      )
      setMatchCount(matchingIds.size)

      const updatedNodes = graphData.nodes.map((n) => {
        const isMatch = matchingIds.has(n.id)
        return {
          id: n.id,
          color: isMatch
            ? {
                background: "#facc15",
                border: "#facc15",
                highlight: { background: "#facc15", border: "#fbbf24" }
              }
            : {
                background: "rgba(255,255,255,0.06)",
                border: "rgba(255,255,255,0.04)",
                highlight: { background: "#facc15", border: "#facc15" }
              },
          font: {
            color: isMatch ? "#ffffff" : "rgba(255,255,255,0.12)",
            size: isMatch ? 13 : 9
          },
          size: isMatch ? (n.size ?? 12) + 6 : 6,
          opacity: isMatch ? 1 : 0.15
        }
      })

      nodesDataSetRef.current.update(updatedNodes as Node[])

      // Focus camera on matching nodes
      if (matchingIds.size > 0 && networkRef.current) {
        networkRef.current.fit({
          nodes: Array.from(matchingIds),
          animation: { duration: 400, easingFunction: "easeInOutQuad" }
        })
      }
    },
    [graphData]
  )

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => applySearchFilter(searchQuery), 200)
    return () => clearTimeout(timer)
  }, [searchQuery, applySearchFilter])

  // Init vis-network
  useEffect(() => {
    if (!graphData || !containerRef.current || graphData.nodes.length === 0) return

    import("vis-network").then(({ Network: VisNetwork, DataSet: VisDataSet }) => {
      const nodesData: Node[] = graphData.nodes.map((n) => ({
        id: n.id,
        label: n.label,
        title: n.title,
        color: {
          background: n.color ?? "#3b82f6",
          border: "rgba(255,255,255,0.2)",
          highlight: { background: "#facc15", border: "#facc15" }
        },
        font: { color: "#ffffff", size: 11 },
        size: n.size ?? 12,
        borderWidth: 1
      }))

      const edgesData: Edge[] = graphData.edges.map((e) => ({
        id: e.id,
        from: e.from,
        to: e.to,
        color: { color: "rgba(255,255,255,0.12)", highlight: "#facc15" },
        smooth: { enabled: true, type: "curvedCW" as const, roundness: 0.2 }
      }))

      const nodes = new VisDataSet<Node>(nodesData)
      const edges = new VisDataSet<Edge>(edgesData)
      nodesDataSetRef.current = nodes as unknown as DataSet<Node>

      const options: Options = {
        physics: {
          enabled: true,
          barnesHut: {
            gravitationalConstant: -2500,
            springLength: 100,
            springConstant: 0.04,
            damping: 0.12
          },
          stabilization: { iterations: 80 }
        },
        interaction: {
          hover: true,
          tooltipDelay: 250,
          zoomView: true,
          dragView: true
        },
        nodes: {
          shape: "dot",
          borderWidth: 1,
          shadow: { enabled: true, color: "rgba(0,0,0,0.4)", size: 6 }
        },
        edges: {
          width: 1,
          arrows: { to: { enabled: true, scaleFactor: 0.4 } }
        }
      }

      if (networkRef.current) networkRef.current.destroy()
      networkRef.current = new VisNetwork(containerRef.current!, { nodes, edges }, options)

      networkRef.current.on("doubleClick", ({ nodes: clickedNodes }) => {
        if (clickedNodes.length > 0) {
          onSelectNote(clickedNodes[0] as string)
        }
      })
    })

    return () => {
      networkRef.current?.destroy()
      networkRef.current = null
      nodesDataSetRef.current = null
    }
  }, [graphData, onSelectNote])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size={18} />
      </div>
    )
  }

  if (!graphData || graphData.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-10">
        <div className="liquid-glass-soft flex h-10 w-10 items-center justify-center rounded-2xl">
          <NetworkIcon size={16} className="text-zinc-500" />
        </div>
        <p className="text-[11px] font-medium text-zinc-400">Empty graph</p>
        <p className="px-6 text-center text-[10px] text-zinc-600">
          Create notes and connect them to visualize your knowledge graph.
        </p>
      </div>
    )
  }

  return (
    <div className="relative h-full">
      {/* Search terminal */}
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        className="absolute left-2 right-2 top-2 z-10">
        <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-[#0a0a0a]/90 px-3 py-1.5 shadow-lg backdrop-blur-md">
          <Search size={11} className="text-action/70" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search graph..."
            className="flex-1 bg-transparent font-mono text-[10px] text-white placeholder:text-zinc-700 focus:outline-none"
          />
          {searchQuery && (
            <span className="text-[9px] text-zinc-500">
              {matchCount} result{matchCount !== 1 ? "s" : ""}
            </span>
          )}
          <div className="h-3 w-[1px] animate-pulse bg-action/50" />
        </div>
      </motion.div>

      {/* Graph canvas */}
      <div ref={containerRef} className="h-full w-full bg-[#050505]" />

      {/* Stats overlay */}
      <div className="absolute bottom-2 left-2 rounded-lg border border-white/[0.04] bg-[#0a0a0a]/80 px-2 py-1 text-[9px] text-zinc-600 backdrop-blur-sm">
        {graphData.nodes.length} notes · {graphData.edges.length} links
      </div>

      {/* Hint */}
      <div className="absolute bottom-2 right-2 rounded-lg border border-white/[0.04] bg-[#0a0a0a]/80 px-2 py-1 text-[9px] text-zinc-600 backdrop-blur-sm">
        Double click to open note
      </div>
    </div>
  )
}

