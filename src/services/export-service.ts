/**
 * MindDock — Export Service
 * Exporta fontes em Markdown, TXT, JSON.
 * PDF e ZIP são gerados no popup (browser context).
 */

import type { Source, ExportFormat } from "~/lib/types"

class ExportService {
  async export(
    sources: Source[],
    format: ExportFormat
  ): Promise<{ content: string; filename: string; mimeType: string }> {
    switch (format) {
      case "markdown":
        return this.toMarkdown(sources)
      case "txt":
        return this.toTxt(sources)
      case "json":
        return this.toJson(sources)
      default:
        throw new Error(`Formato não suportado: ${format}`)
    }
  }

  private toMarkdown(sources: Source[]): { content: string; filename: string; mimeType: string } {
    const lines: string[] = []

    sources.forEach((s, i) => {
      if (i > 0) lines.push("\n---\n")
      lines.push(`# ${s.title}`)
      lines.push(``)
      lines.push(`> **Tipo:** ${s.type} | **Criado em:** ${new Date(s.createTime).toLocaleDateString("pt-BR")}`)
      if (s.url) lines.push(`> **URL:** ${s.url}`)
      lines.push(``)
      lines.push(s.content ?? "_Conteúdo não carregado_")
    })

    const filename =
      sources.length === 1
        ? `${this.sanitizeFilename(sources[0].title)}.md`
        : `minddock-export-${Date.now()}.md`

    return {
      content: lines.join("\n"),
      filename,
      mimeType: "text/markdown"
    }
  }

  private toTxt(sources: Source[]): { content: string; filename: string; mimeType: string } {
    const lines: string[] = []

    sources.forEach((s, i) => {
      if (i > 0) lines.push("\n" + "=".repeat(60) + "\n")
      lines.push(s.title.toUpperCase())
      lines.push("-".repeat(s.title.length))
      lines.push(`Tipo: ${s.type} | Criado: ${new Date(s.createTime).toLocaleDateString("pt-BR")}`)
      if (s.url) lines.push(`URL: ${s.url}`)
      lines.push("")
      lines.push(s.content ?? "(Conteúdo não carregado)")
    })

    const filename =
      sources.length === 1
        ? `${this.sanitizeFilename(sources[0].title)}.txt`
        : `minddock-export-${Date.now()}.txt`

    return {
      content: lines.join("\n"),
      filename,
      mimeType: "text/plain"
    }
  }

  private toJson(sources: Source[]): { content: string; filename: string; mimeType: string } {
    const data = {
      exportedAt: new Date().toISOString(),
      exportedBy: "MindDock",
      count: sources.length,
      sources: sources.map((s) => ({
        id: s.id,
        title: s.title,
        type: s.type,
        url: s.url,
        content: s.content,
        createdAt: s.createTime,
        updatedAt: s.updateTime,
        wordCount: s.wordCount
      }))
    }

    return {
      content: JSON.stringify(data, null, 2),
      filename: `minddock-export-${Date.now()}.json`,
      mimeType: "application/json"
    }
  }

  private sanitizeFilename(name: string): string {
    return name
      .replace(/[^a-zA-Z0-9\s-_]/g, "")
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 50)
  }
}

export const exportService = new ExportService()
