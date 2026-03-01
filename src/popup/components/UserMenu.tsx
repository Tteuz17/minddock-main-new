import {
  ArrowUp,
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

export function UserMenu() {
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
      <div className="rounded-[26px] border border-white/[0.05] bg-[linear-gradient(180deg,#060606_0%,#090a0d_40%,#050505_100%)] p-2.5 shadow-[0_24px_50px_rgba(0,0,0,0.38)] backdrop-blur-2xl">
        <div
          className="pointer-events-auto relative overflow-hidden rounded-[22px] border border-white/[0.08] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_24px_rgba(0,0,0,0.24)]"
          style={{
            backgroundImage: `url(${profileBackgroundSrc})`,
            backgroundPosition: "center bottom",
            backgroundSize: "cover"
          }}>
          <div className="pointer-events-none absolute inset-0 bg-black/35" />

          <div className="relative z-10 flex items-center gap-3">
            <div className="flex h-[56px] w-[56px] shrink-0 items-center justify-center overflow-hidden rounded-[16px] bg-[#e7d7c4] shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={displayName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="text-[18px] font-semibold tracking-[-0.03em] text-zinc-900">
                  {initials}
                </span>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-[15px] font-semibold tracking-[-0.02em] text-white">
                  {displayName}
                </span>
                <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-[#facc15]">
                  <span className="h-1.5 w-1.5 rounded-full bg-white" />
                </span>
              </div>

              <p className="mt-0.5 truncate text-[10px] text-zinc-300">
                MindDock {planName}
              </p>

              <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-white">
                <Star size={12} strokeWidth={2} className="fill-[#facc15] text-[#facc15]" />
                <span>5 (35)</span>
              </div>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.14] bg-white/[0.06] text-white backdrop-blur-xl hover:bg-white/[0.1]">
                  <ArrowUp size={15} strokeWidth={2} />
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent
                align="end"
                side="top"
                sideOffset={10}
                className="mb-1 w-60 rounded-[22px] border border-white/[0.05] bg-[linear-gradient(180deg,rgba(20,23,28,0.9),rgba(14,16,20,0.82))] p-2 shadow-[0_20px_42px_rgba(0,0,0,0.42)] backdrop-blur-2xl">
                <div className="space-y-1">
                  <DropdownMenuItem asChild>
                    <button
                      type="button"
                      onClick={() => chrome.tabs.create({ url: "https://minddock.app/account" })}
                      className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-white">
                      <User className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium">Minha conta</span>
                    </button>
                  </DropdownMenuItem>

                  <DropdownMenuItem asChild>
                    <button
                      type="button"
                      onClick={() => chrome.tabs.create({ url: "https://minddock.app/pricing" })}
                      className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-white">
                      <Sparkles className="h-3.5 w-3.5" />
                      <span className="flex-1 text-left text-xs font-medium">Plano</span>
                      <span className="text-[10px] text-zinc-500">{planName}</span>
                    </button>
                  </DropdownMenuItem>

                  <DropdownMenuItem asChild>
                    <button
                      type="button"
                      onClick={() => chrome.tabs.create({ url: "https://minddock.app/billing" })}
                      className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-white">
                      <CreditCard className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium">Assinatura</span>
                    </button>
                  </DropdownMenuItem>

                  <DropdownMenuItem asChild>
                    <button
                      type="button"
                      onClick={() => chrome.tabs.create({ url: "https://minddock.app/settings" })}
                      className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-white">
                      <Settings className="h-3.5 w-3.5" />
                      <span className="text-xs font-medium">Configuracoes</span>
                    </button>
                  </DropdownMenuItem>
                </div>

                <DropdownMenuSeparator className="my-2 bg-white/8" />

                <DropdownMenuItem asChild>
                  <button
                    type="button"
                    onClick={signOut}
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-red-400 transition-colors hover:bg-red-500/10">
                    <LogOut className="h-3.5 w-3.5" />
                    <span className="text-xs font-medium">Sair</span>
                  </button>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

      </div>
    </div>
  )
}
