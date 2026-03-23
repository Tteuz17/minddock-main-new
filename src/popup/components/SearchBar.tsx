import { Search, X } from "lucide-react"
import { Input } from "~/components/ui/input"

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function SearchBar({ value, onChange, placeholder }: SearchBarProps) {
  return (
    <Input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? "Search..."}
      leftIcon={<Search size={13} strokeWidth={1.5} />}
      rightIcon={
        value ? (
          <button
            onClick={() => onChange("")}
            className="hover:text-white transition-colors">
            <X size={13} strokeWidth={1.5} />
          </button>
        ) : null
      }
      className="w-full h-8 text-xs"
    />
  )
}
