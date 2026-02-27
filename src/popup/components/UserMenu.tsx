import { LogOut, CreditCard, User, ChevronUp, Sparkles } from "lucide-react"
import { useAuth } from "~/hooks/useAuth"
import { useSubscription } from "~/hooks/useSubscription"
import { PLAN_NAMES } from "~/lib/constants"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "~/components/ui/dropdown-menu"

export function UserMenu() {
  const { user, signOut } = useAuth()
  const { tier } = useSubscription()

  if (!user) return null

  const initials = user.displayName
    ? user.displayName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase()
    : user.email.slice(0, 2).toUpperCase()

  return (
    <div className="border-t border-white/8 px-3 py-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors text-left group">
            {/* Avatar */}
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.displayName}
                className="w-7 h-7 rounded-full flex-shrink-0"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-semibold text-white">{initials}</span>
              </div>
            )}

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-white truncate">
                {user.displayName ?? user.email}
              </p>
              <p className="text-[10px] text-text-tertiary">
                {PLAN_NAMES[tier]}
              </p>
            </div>

            <ChevronUp
              size={13}
              strokeWidth={1.5}
              className="text-text-tertiary group-hover:text-white transition-colors"
            />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" side="top" className="w-56 mb-1">
          <DropdownMenuLabel>
            <div className="flex items-center gap-2">
              <User size={12} strokeWidth={1.5} />
              {user.email}
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {tier === "free" && (
            <DropdownMenuItem
              onClick={() => chrome.tabs.create({ url: "https://minddock.app/pricing" })}>
              <Sparkles size={13} strokeWidth={1.5} className="text-action" />
              <span className="text-action">Fazer upgrade</span>
            </DropdownMenuItem>
          )}

          <DropdownMenuItem
            onClick={() => chrome.tabs.create({ url: "https://minddock.app/billing" })}>
            <CreditCard size={13} strokeWidth={1.5} />
            Gerenciar assinatura
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuItem danger onClick={signOut}>
            <LogOut size={13} strokeWidth={1.5} />
            Sair
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
