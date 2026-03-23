import {
  ArrowUp,
  BarChart3,
  ChevronRight,
  CreditCard,
  LogOut,
  Settings,
  Sparkles,
  Star,
  User
} from "lucide-react"

import { useAuth } from "~/hooks/useAuth"
import { useSubscription } from "~/hooks/useSubscription"
import { PLAN_NAMES } from "~/lib/constants"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "~/components/ui/dropdown-menu"

interface UserMenuProps {
  onOpenUsage?: () => void
  onOpenPlans?: () => void
}

export function UserMenu({ onOpenUsage, onOpenPlans }: UserMenuProps) {
  const { user, signOut } = useAuth()
  const { tier } = useSubscription()

  if (!user) return null

  const initials = user.displayName
    ? user.displayName
        .split(" ")
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : user.email.slice(0, 2).toUpperCase()

  const displayName = user.displayName ?? user.email
  const planName = PLAN_NAMES[tier] ?? "Free"
  const profileBackgroundSrc = new URL(
    "../../../public/images/background/fundo perfil.png",
    import.meta.url
  ).href

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 right-3 z-20">
      <div className="rounded-[22px] border border-white/[0.05] bg-[linear-gradient(180deg,#060606_0%,#090a0d_40%,#050505_100%)] p-1.5 shadow-[0_18px_40px_rgba(0,0,0,0.34)] backdrop-blur-2xl">
        <div
          className="pointer-events-auto relative overflow-hidden rounded-[18px] border border-white/[0.08] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_8px_20px_rgba(0,0,0,0.2)]"
          style={{
            backgroundImage: `url(${profileBackgroundSrc})`,
            backgroundPosition: "center bottom",
            backgroundSize: "cover"
          }}>
          <div className="pointer-events-none absolute inset-0 bg-black/35" />

          <div className="relative z-10 flex items-center gap-3">
            <div className="flex h-[46px] w-[46px] shrink-0 items-center justify-center overflow-hidden rounded-[14px] bg-[#e7d7c4] shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={displayName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-[16px] font-semibold tracking-[-0.03em] text-zinc-900">
                  {initials}
                </span>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[14px] font-semibold tracking-[-0.02em] text-white">
                  {displayName}
                </span>
                <span className="inline-flex h-3 w-3 shrink-0 items-center justify-center rounded-full bg-[#facc15]">
                  <span className="h-1 w-1 rounded-full bg-white" />
                </span>
              </div>

              <p className="mt-0.5 truncate text-[9px] text-zinc-300">
                MindDock {planName}
              </p>

              <div className="mt-1 flex items-center gap-1.5 text-[9px] text-white">
                <Star size={11} strokeWidth={2} className="fill-[#facc15] text-[#facc15]" />
                <span>5 (35)</span>
              </div>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.14] bg-white/[0.06] text-white backdrop-blur-xl hover:bg-white/[0.1]">
                  <ArrowUp size={14} strokeWidth={2} />
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent
                align="end"
                side="top"
                sideOffset={10}
                className="relative mb-1 w-[252px] overflow-hidden rounded-[22px] border border-white/[0.08] bg-[#050505] p-2.5 shadow-[0_24px_52px_rgba(0,0,0,0.55)] backdrop-blur-2xl">
                <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),transparent)] opacity-30" />

                <div className="relative z-10">
                  <div className="mb-2 rounded-[15px] border border-white/[0.08] bg-white/[0.03] px-2.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                    <div className="flex items-start gap-2.5">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[11px] bg-[#e7d7c4] shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]">
                        {user.avatarUrl ? (
                          <img src={user.avatarUrl} alt={displayName} className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-[12px] font-semibold tracking-[-0.03em] text-zinc-900">
                            {initials}
                          </span>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">Account</p>
                        <p className="truncate text-[12px] font-semibold text-zinc-100">{displayName}</p>
                        <p className="truncate text-[10px] text-zinc-500">{user.email}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <DropdownMenuItem asChild>
                      <button
                        type="button"
                        onClick={() => chrome.tabs.create({ url: "https://minddocklm.digital/account" })}
                        className="group flex w-full items-center gap-2.5 rounded-[13px] border border-transparent px-2.5 py-2 text-zinc-300 transition-all hover:border-white/[0.08] hover:bg-white/[0.04] hover:text-white">
                        <span className="flex h-7 w-7 items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.03] text-zinc-400 group-hover:text-white">
                          <User className="h-3.5 w-3.5" />
                        </span>
                        <span className="flex-1 text-left text-[12px] font-medium">My account</span>
                        <ChevronRight className="h-3.5 w-3.5 text-zinc-600 group-hover:text-zinc-300" />
                      </button>
                    </DropdownMenuItem>

                    <DropdownMenuItem asChild>
                      <button
                        type="button"
                        onClick={() => onOpenPlans ? onOpenPlans() : chrome.tabs.create({ url: "https://minddocklm.digital/pricing" })}
                        className="group flex w-full items-center gap-2.5 rounded-[13px] border border-transparent px-2.5 py-2 text-zinc-300 transition-all hover:border-white/[0.08] hover:bg-white/[0.04] hover:text-white">
                        <span className="flex h-7 w-7 items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.03] text-zinc-400 group-hover:text-white">
                          <Sparkles className="h-3.5 w-3.5" />
                        </span>
                        <span className="flex-1 text-left text-[12px] font-medium">Plan</span>
                        <span className="rounded-full border border-[#facc15]/28 bg-[#facc15]/10 px-2 py-0.5 text-[10px] font-medium text-[#facc15]">
                          {planName}
                        </span>
                      </button>
                    </DropdownMenuItem>

                    <DropdownMenuItem asChild>
                      <button
                        type="button"
                        onClick={() => chrome.tabs.create({ url: "https://minddocklm.digital/billing" })}
                        className="group flex w-full items-center gap-2.5 rounded-[13px] border border-transparent px-2.5 py-2 text-zinc-300 transition-all hover:border-white/[0.08] hover:bg-white/[0.04] hover:text-white">
                        <span className="flex h-7 w-7 items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.03] text-zinc-400 group-hover:text-white">
                          <CreditCard className="h-3.5 w-3.5" />
                        </span>
                        <span className="flex-1 text-left text-[12px] font-medium">Subscription</span>
                        <ChevronRight className="h-3.5 w-3.5 text-zinc-600 group-hover:text-zinc-300" />
                      </button>
                    </DropdownMenuItem>

                    <DropdownMenuItem asChild>
                      <button
                        type="button"
                        onClick={() => {
                          if (onOpenUsage) {
                            onOpenUsage()
                            return
                          }
                          chrome.tabs.create({ url: "https://minddocklm.digital/usage" })
                        }}
                        className="group flex w-full items-center gap-2.5 rounded-[13px] border border-transparent px-2.5 py-2 text-zinc-300 transition-all hover:border-white/[0.08] hover:bg-white/[0.04] hover:text-white">
                        <span className="flex h-7 w-7 items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.03] text-zinc-400 group-hover:text-white">
                          <BarChart3 className="h-3.5 w-3.5" />
                        </span>
                        <span className="flex-1 text-left text-[12px] font-medium">Usage</span>
                        <ChevronRight className="h-3.5 w-3.5 text-zinc-600 group-hover:text-zinc-300" />
                      </button>
                    </DropdownMenuItem>

                    <DropdownMenuItem asChild>
                      <button
                        type="button"
                        onClick={() => chrome.tabs.create({ url: "https://minddocklm.digital/settings" })}
                        className="group flex w-full items-center gap-2.5 rounded-[13px] border border-transparent px-2.5 py-2 text-zinc-300 transition-all hover:border-white/[0.08] hover:bg-white/[0.04] hover:text-white">
                        <span className="flex h-7 w-7 items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.03] text-zinc-400 group-hover:text-white">
                          <Settings className="h-3.5 w-3.5" />
                        </span>
                        <span className="flex-1 text-left text-[12px] font-medium">Settings</span>
                        <ChevronRight className="h-3.5 w-3.5 text-zinc-600 group-hover:text-zinc-300" />
                      </button>
                    </DropdownMenuItem>
                  </div>

                  <DropdownMenuSeparator className="my-2 bg-white/[0.08]" />

                  <DropdownMenuItem asChild>
                    <button
                      type="button"
                      onClick={signOut}
                      className="group flex w-full items-center gap-2.5 rounded-[13px] border border-transparent px-2.5 py-2 text-red-400 transition-all hover:border-red-500/25 hover:bg-red-500/10 hover:text-red-300">
                      <span className="flex h-7 w-7 items-center justify-center rounded-[10px] border border-red-500/25 bg-red-500/10 text-red-400 group-hover:text-red-300">
                        <LogOut className="h-3.5 w-3.5" />
                      </span>
                      <span className="text-[12px] font-medium">Sign out</span>
                    </button>
                  </DropdownMenuItem>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

      </div>
    </div>
  )
}
