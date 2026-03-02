import { useState } from "react"
import { Chrome, Loader2 } from "lucide-react"
import { motion } from "framer-motion"
import { useAuth } from "~/hooks/useAuth"
import { Button } from "~/components/ui/button"

interface AuthScreenProps {
  compact?: boolean
}

const DEV_TEST_USER = {
  id: "dev-test-user-001",
  email: "dev@minddock.test",
  displayName: "Dev Tester",
  avatarUrl: null,
  stripeCustomerId: null,
  subscriptionTier: "thinker_pro",
  subscriptionStatus: "active",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
}

export function AuthScreen({ compact }: AuthScreenProps) {
  const { signIn, refresh, error } = useAuth()
  const [isLoading, setIsLoading] = useState(false)

  async function handleSignIn() {
    setIsLoading(true)
    try {
      await signIn()
    } catch {
      // O erro ja e exposto pelo hook.
    } finally {
      setIsLoading(false)
    }
  }

  async function handleDevAccess() {
    await chrome.storage.local.set({ minddock_user_profile: DEV_TEST_USER })
    // Invalida cache de subscription para forçar re-leitura do perfil dev
    await chrome.storage.local.remove("minddock_subscription")
    await refresh()
  }

  if (compact) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 p-6">
        <p className="text-sm text-text-secondary text-center">
          Entre para usar o Zettelkasten
        </p>
        <Button variant="primary" size="md" onClick={handleSignIn} disabled={isLoading}>
          {isLoading ? (
            <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
          ) : (
            <Chrome size={14} strokeWidth={1.5} />
          )}
          Entrar com Google
        </Button>
      </div>
    )
  }

  return (
    <div className="popup-container items-center justify-center flex">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col items-center gap-6 px-6 py-8 text-center">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-action flex items-center justify-center shadow-elevation-2">
            <span className="text-black text-2xl font-bold">M</span>
          </div>
          <div>
            <h1 className="text-h3 font-semibold">MindDock</h1>
            <p className="text-sm text-text-secondary mt-1">
              NotebookLM Supercharged
            </p>
          </div>
        </div>

        {/* Features */}
        <div className="space-y-2 text-left w-full">
          {[
            "Importar conversas do ChatGPT, Claude e Gemini",
            "Organizar notebooks com pastas e tags",
            "Zettelkasten com links bidirecionais",
            "Prompts Ágeis com 1 clique"
          ].map((feat) => (
            <div key={feat} className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-action flex-shrink-0" />
              <span className="text-xs text-text-secondary">{feat}</span>
            </div>
          ))}
        </div>

        {/* CTA */}
        <Button
          variant="primary"
          size="lg"
          onClick={handleSignIn}
          disabled={isLoading}
          className="w-full gap-2">
          {isLoading ? (
            <Loader2 size={16} strokeWidth={1.5} className="animate-spin" />
          ) : (
            <Chrome size={16} strokeWidth={1.5} />
          )}
          {isLoading ? "Entrando..." : "Continuar com Google"}
        </Button>

        {error ? (
          <div className="w-full rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-left">
            <p className="text-xs leading-relaxed text-red-200">{error}</p>
          </div>
        ) : null}

        <p
          className="text-xs text-text-tertiary cursor-default select-none"
          onClick={handleDevAccess}>
          Grátis para começar · Sem cartão de crédito
        </p>
      </motion.div>
    </div>
  )
}
