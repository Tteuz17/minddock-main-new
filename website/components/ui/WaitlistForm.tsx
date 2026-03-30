"use client"

import { useState, useRef } from "react"

export default function WaitlistForm() {
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle")
  const [errorMsg, setErrorMsg] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (status === "loading") return

    setStatus("loading")
    setErrorMsg("")

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Erro desconhecido.")
      setStatus("success")
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Erro ao cadastrar.")
      setStatus("error")
    }
  }

  return (
    <>
      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-md flex-col gap-3 sm:flex-row"
        aria-label="Formulário de acesso antecipado"
      >
        <input
          ref={inputRef}
          type="email"
          required
          placeholder="your@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={status === "loading" || status === "success"}
          className="flex-1 rounded-full border border-white/12 bg-white/6 px-5 py-3.5 text-sm text-white placeholder-white/28 outline-none backdrop-blur-sm transition focus:border-white/30 focus:bg-white/9 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={status === "loading" || status === "success"}
          className="shrink-0 rounded-full bg-white px-6 py-3.5 text-sm font-semibold text-black transition hover:opacity-88 active:scale-[0.97] disabled:opacity-50"
        >
          {status === "loading" ? "Sending…" : status === "success" ? "Joined ✓" : "Get early access"}
        </button>
      </form>

      {status === "error" && (
        <p className="mt-2 text-center text-xs text-red-400">{errorMsg}</p>
      )}

      <p className="mt-3 text-[11px] text-white/28">
        No spam. You'll be notified when access opens.
      </p>

      {/* Success popup */}
      {status === "success" && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Email cadastrado com sucesso"
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          onClick={() => setStatus("idle")}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-hidden="true" />

          {/* Card */}
          <div
            className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-white/10 bg-[#0d0e10] p-8 text-center shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            style={{ animation: "popIn 0.3s cubic-bezier(0.34,1.56,0.64,1) both" }}
          >
            {/* Glow */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-0 h-40 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                background:
                  "radial-gradient(ellipse, rgba(250,204,21,0.18) 0%, transparent 70%)"
              }}
            />

            {/* Icon */}
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#facc15]/25 bg-[#facc15]/10">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M5 13l4 4L19 7" stroke="#facc15" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>

            <h2 className="text-xl font-semibold tracking-[-0.04em] text-white">
              You're on the list!
            </h2>
            <p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-white/50">
              As soon as access opens, you'll be one of the first to know. Keep an eye on your inbox.
            </p>

            <button
              onClick={() => setStatus("idle")}
              className="mt-7 w-full rounded-full bg-white py-3 text-sm font-semibold text-black transition hover:opacity-88"
            >
              Perfect!
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes popIn {
          from { opacity: 0; transform: scale(0.88); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </>
  )
}
