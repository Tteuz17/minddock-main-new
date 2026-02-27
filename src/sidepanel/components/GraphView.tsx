import { useEffect, useRef, useState } from "react"
import type { Edge, Network, Node, Options } from "vis-network"
import { useAuth } from "~/hooks/useAuth"
import { zettelkastenService } from "~/services/zettelkasten"
import { LoadingSpinner } from "~/components/LoadingSpinner"
import type { GraphData } from "~/lib/types"
import { Network as NetworkIcon } from "lucide-react"

interface GraphViewProps {
  onSelectNote: (noteId: string) => void
}

export function GraphView({ onSelectNote }: GraphViewProps) {
  const { user } = useAuth()
  const containerRef = useRef<HTMLDivElement>(null)
  const networkRef = useRef<Network | null>(null)
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    zettelkastenService.getGraphData(user.id).then((data) => {
      setGraphData(data)
      setIsLoading(false)
    })
  }, [user])

  useEffect(() => {
    if (!graphData || !containerRef.current || graphData.nodes.length === 0) return

    // Import dinâmico para não aumentar o bundle principal
    import("vis-network").then(({ Network: VisNetwork, DataSet }) => {
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
        color: { color: "rgba(255,255,255,0.15)", highlight: "#facc15" },
        smooth: { enabled: true, type: "curvedCW", roundness: 0.2 }
      }))

      const nodes = new DataSet<Node>(nodesData)
      const edges = new DataSet<Edge>(edgesData)

      const options: Options = {
        physics: {
          enabled: true,
          barnesHut: {
            gravitationalConstant: -3000,
            springLength: 120,
            springConstant: 0.04
          }
        },
        interaction: {
          hover: true,
          tooltipDelay: 300
        },
        nodes: {
          shape: "dot",
          borderWidth: 1,
          shadow: { enabled: true, color: "rgba(0,0,0,0.5)", size: 8 }
        },
        edges: {
          width: 1,
          arrows: { to: { enabled: true, scaleFactor: 0.5 } }
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
    }
  }, [graphData, onSelectNote])

  if (isLoading) {
    return <div className="py-12"><LoadingSpinner label="Carregando grafo..." /></div>
  }

  if (!graphData || graphData.nodes.length === 0) {
    return (
      <div className="empty-state flex-1">
        <NetworkIcon size={24} strokeWidth={1} className="text-text-tertiary" />
        <div>
          <p className="text-sm text-text-secondary font-medium">Grafo vazio</p>
          <p className="text-xs text-text-tertiary mt-1">
            Crie notas e adicione links [[]] para ver o grafo de conhecimento.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full">
      <div ref={containerRef} className="w-full h-full bg-bg" />
      <div className="absolute bottom-3 left-3 text-[10px] text-text-tertiary glass rounded px-2 py-1">
        Duplo clique para abrir nota
      </div>
      <div className="absolute top-3 right-3 text-[10px] text-text-tertiary glass rounded px-2 py-1">
        {graphData.nodes.length} notas · {graphData.edges.length} links
      </div>
    </div>
  )
}
