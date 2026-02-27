import { Plus, Tag, Trash2 } from "lucide-react"
import { useState, useEffect } from "react"
import { motion } from "framer-motion"
import { useAuth } from "~/hooks/useAuth"
import { getSupabaseClient } from "~/services/supabase-client"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { TAG_COLORS } from "~/lib/utils"
import type { Tag as TagType } from "~/lib/types"

export function TagManager() {
  const { user } = useAuth()
  const [tags, setTags] = useState<TagType[]>([])
  const [newTagName, setNewTagName] = useState("")
  const [selectedColor, setSelectedColor] = useState<(typeof TAG_COLORS)[number]>(TAG_COLORS[0])

  useEffect(() => {
    if (!user) return
    void (async () => {
      const supabase = await getSupabaseClient()
      const { data } = await supabase.from("tags").select("*").eq("user_id", user.id).order("name")
      setTags((data ?? []) as TagType[])
    })()
  }, [user])

  async function createTag() {
    if (!user || !newTagName.trim()) return
    const supabase = await getSupabaseClient()
    const { data } = await supabase
      .from("tags")
      .insert({ user_id: user.id, name: newTagName.trim().toLowerCase(), color: selectedColor })
      .select()
      .single()
    if (data) {
      setTags((prev) => [...prev, data as TagType])
      setNewTagName("")
    }
  }

  async function deleteTag(tagId: string) {
    const supabase = await getSupabaseClient()
    await supabase.from("tags").delete().eq("id", tagId)
    setTags((prev) => prev.filter((t) => t.id !== tagId))
  }

  return (
    <div className="flex flex-col h-full">
      {/* Create */}
      <div className="px-3 py-3 border-b border-white/8 space-y-2">
        <Input
          value={newTagName}
          onChange={(e) => setNewTagName(e.target.value)}
          placeholder="Nova tag..."
          leftIcon={<Tag size={12} strokeWidth={1.5} />}
          onKeyDown={(e) => e.key === "Enter" && createTag()}
          className="h-7 text-xs"
        />
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-tertiary">Cor:</span>
          <div className="flex gap-1.5">
            {TAG_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => setSelectedColor(color)}
                className={[
                  "w-5 h-5 rounded-full border-2 transition-all",
                  selectedColor === color ? "border-white scale-110" : "border-transparent opacity-70 hover:opacity-100"
                ].join(" ")}
                style={{ background: color }}
              />
            ))}
          </div>
          <Button variant="primary" size="sm" className="ml-auto h-6 px-2 text-xs" onClick={createTag}>
            <Plus size={11} strokeWidth={1.5} />
            Criar
          </Button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-1">
        {tags.length === 0 ? (
          <div className="empty-state py-8">
            <Tag size={20} strokeWidth={1} className="text-text-tertiary" />
            <p className="text-sm text-text-secondary">Nenhuma tag criada ainda</p>
          </div>
        ) : (
          tags.map((tag, i) => (
            <motion.div
              key={tag.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              className="group flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-white/5 transition-colors">
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ background: tag.color }}
              />
              <span className="text-sm text-text-secondary group-hover:text-white transition-colors flex-1">
                {tag.name}
              </span>
              <button
                onClick={() => deleteTag(tag.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-text-tertiary hover:text-error">
                <Trash2 size={12} strokeWidth={1.5} />
              </button>
            </motion.div>
          ))
        )}
      </div>
    </div>
  )
}
