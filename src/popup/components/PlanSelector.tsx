import { useMemo, useState } from "react"
import {
  ArrowLeft,
  Check,
  Crown,
  Lock,
  Sparkles,
  Unlock,
  Zap
} from "lucide-react"
import { useSubscription } from "~/hooks/useSubscription"
import { resolvePlanLimits, STRIPE_PRICES } from "~/lib/constants"
import { MESSAGE_ACTIONS } from "~/lib/contracts"
import type { PlanLimits, SubscriptionCycle, SubscriptionTier } from "~/lib/types"

interface PlanSelectorProps {
  onBack: () => void
}

type BillingCycle = "monthly" | "yearly"
type PlanId = "free" | "pro" | "thinker"
type RawFeatureValue = number | "unlimited" | boolean | undefined

interface PlanOption {
  id: PlanId
  name: string
  tag: string
  description: string
  monthlyPrice: number
  yearlyTotal: number
  priceMonthly: string | null
  priceYearly: string | null
  buttonText: string
  accent: "neutral" | "gold"
  features: string[]
}

interface FeatureRow {
  label: string
  getValue: (limits: PlanLimits) => RawFeatureValue
}

interface CheckoutResponse {
  success?: boolean
  payload?: { url?: string; opened?: boolean }
  data?: { url?: string; opened?: boolean }
  error?: string
}

const PLAN_ORDER: PlanId[] = ["free", "pro", "thinker"]

const PLAN_OPTIONS: PlanOption[] = [
  {
    id: "free",
    name: "Free",
    tag: "Start",
    description: "Daily-limited plan for basic capture and exports.",
    monthlyPrice: 0,
    yearlyTotal: 0,
    priceMonthly: null,
    priceYearly: null,
    buttonText: "Get started free",
    accent: "neutral",
    features: [
      "7 imports + 7 exports per day",
      "Basic NotebookLM workflow",
      "No AI generation tools"
    ]
  },
  {
    id: "pro",
    name: "Pro",
    tag: "Workflow",
    description: "Unlimited core operations, but AI tools stay locked.",
    monthlyPrice: 4.99,
    yearlyTotal: 24.99,
    priceMonthly: STRIPE_PRICES.pro_monthly,
    priceYearly: STRIPE_PRICES.pro_yearly,
    buttonText: "Upgrade to Pro",
    accent: "neutral",
    features: [
      "Unlimited imports and exports",
      "Unlimited source captures",
      "AI features remain locked"
    ]
  },
  {
    id: "thinker",
    name: "Thinker",
    tag: "AI",
    description: "Unlocks Agile, Focus Docks and Brain Merge quotas.",
    monthlyPrice: 7.99,
    yearlyTotal: 59.99,
    priceMonthly: STRIPE_PRICES.thinker_monthly,
    priceYearly: STRIPE_PRICES.thinker_yearly,
    buttonText: "Upgrade to Thinker",
    accent: "gold",
    features: [
      "Everything in Pro",
      "Zettelkasten and AI workflow unlocked",
      "Quota packs by billing cycle"
    ]
  }
]

const FEATURE_ROWS: FeatureRow[] = [
  {
    label: "Agile Prompts / month",
    getValue: (limits) =>
      limits.ai_features ? limits.agile_prompts_per_month ?? false : false
  },
  {
    label: "Focus Docks / month",
    getValue: (limits) =>
      limits.zettelkasten ? limits.docks_summaries_per_month ?? false : false
  },
  {
    label: "Brain Merge / month",
    getValue: (limits) =>
      limits.ai_features ? limits.brain_merges_per_month ?? false : false
  },
  {
    label: "Zettelkasten workspace",
    getValue: (limits) => limits.zettelkasten ?? false
  },
  {
    label: "Imports / day",
    getValue: (limits) => limits.imports_per_day
  }
]

function cycleToSubscriptionCycle(cycle: BillingCycle): SubscriptionCycle {
  return cycle === "yearly" ? "yearly" : "monthly"
}

function resolveDisplayLimits(planId: PlanId, cycle: BillingCycle): PlanLimits {
  if (planId === "thinker") {
    return resolvePlanLimits("thinker", cycleToSubscriptionCycle(cycle))
  }
  return resolvePlanLimits(planId, "monthly")
}

function mapFeatureValue(value: RawFeatureValue): { label: string; enabled: boolean } {
  if (value === "unlimited") return { label: "INF", enabled: true }
  if (typeof value === "number") return { label: String(value), enabled: true }
  if (value === true) return { label: "On", enabled: true }
  return { label: "Lock", enabled: false }
}

function readQuota(limit: number | "unlimited" | undefined): string {
  if (limit === "unlimited") return "Unlimited"
  if (typeof limit === "number") return `${limit}`
  return "Locked"
}

function sendCheckoutMessage(priceId: string, timeoutMs = 12_000): Promise<CheckoutResponse> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timeoutId = window.setTimeout(() => {
      if (settled) return
      settled = true
      reject(new Error("Checkout timeout. Reload extension and try again."))
    }, timeoutMs)

    try {
      chrome.runtime.sendMessage(
        {
          command: MESSAGE_ACTIONS.CMD_CREATE_CHECKOUT,
          action: MESSAGE_ACTIONS.CMD_CREATE_CHECKOUT,
          payload: { priceId, openInTab: true }
        },
        (response: CheckoutResponse) => {
          if (settled) return
          settled = true
          window.clearTimeout(timeoutId)

          const runtimeError = chrome.runtime.lastError
          if (runtimeError?.message) {
            reject(new Error(runtimeError.message))
            return
          }

          if (response === undefined) {
            reject(new Error("No checkout response from background. Reload the extension and try again."))
            return
          }

          resolve(response ?? {})
        }
      )
    } catch (err) {
      if (settled) return
      settled = true
      window.clearTimeout(timeoutId)
      reject(err instanceof Error ? err : new Error("Checkout messaging failed."))
    }
  })
}

function openCheckoutTab(url: string): Promise<void> {
  const normalizedUrl = String(url ?? "").trim()
  if (!normalizedUrl) {
    return Promise.reject(new Error("Checkout URL is missing."))
  }

  if (chrome?.tabs?.create) {
    return new Promise((resolve, reject) => {
      chrome.tabs.create({ url: normalizedUrl }, () => {
        const runtimeError = chrome.runtime?.lastError
        if (runtimeError?.message) {
          reject(new Error(runtimeError.message))
          return
        }
        resolve()
      })
    })
  }

  const openedWindow = window.open(normalizedUrl, "_blank", "noopener,noreferrer")
  if (openedWindow) {
    return Promise.resolve()
  }

  return Promise.reject(new Error("Unable to open checkout tab from popup context."))
}

function AccessPill({
  label,
  value,
  enabled
}: {
  label: string
  value: string
  enabled: boolean
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-2 py-1.5 text-center">
      <p className="text-[11px] font-semibold text-white">{value}</p>
      <p className="text-[8px] uppercase tracking-[0.14em] text-zinc-500">{label}</p>
      <p className={`mt-0.5 text-[8px] ${enabled ? "text-emerald-300" : "text-zinc-600"}`}>
        {enabled ? "Unlocked" : "Locked"}
      </p>
    </div>
  )
}

export function PlanSelector({ onBack }: PlanSelectorProps) {
  const [cycle, setCycle] = useState<BillingCycle>("yearly")
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorTarget, setErrorTarget] = useState<PlanId | "thinker-annual" | null>(null)
  const {
    tier: currentTier,
    cycle: currentCycle,
    limits: currentLimits
  } = useSubscription()
  const currentBillingCycle: BillingCycle =
    currentCycle === "yearly" ? "yearly" : "monthly"

  const limitsByPlan = useMemo(
    () => ({
      free: resolveDisplayLimits("free", cycle),
      pro: resolveDisplayLimits("pro", cycle),
      thinker: resolveDisplayLimits("thinker", cycle)
    }),
    [cycle]
  )

  const thinkerPlan = PLAN_OPTIONS.find((plan) => plan.id === "thinker")
  const planRank: Record<PlanId, number> = {
    free: 0,
    pro: 1,
    thinker: 2
  }
  const tierRank: Record<SubscriptionTier, number> = {
    free: 0,
    pro: 1,
    thinker: 2,
    thinker_pro: 3
  }
  const isPlanSameTier = (planId: PlanId): boolean => currentTier === planId
  const isPlanCurrentForSelectedCycle = (planId: PlanId): boolean => {
    if (tierRank[currentTier] > planRank[planId]) {
      return true
    }

    if (currentTier !== planId) {
      return false
    }
    if (planId === "free") {
      return true
    }
    return currentBillingCycle === cycle
  }
  const thinkerAnnualIncludedByHigherTier = currentTier === "thinker_pro"
  const thinkerAnnualCurrent =
    (currentTier === "thinker" || currentTier === "thinker_pro") &&
    currentBillingCycle === "yearly"

  async function handleSubscribe(
    plan: PlanOption,
    sourceId: PlanId | "thinker-annual" = plan.id
  ) {
    if (!plan.priceMonthly) return

    const priceId = cycle === "yearly" ? plan.priceYearly : plan.priceMonthly
    if (!priceId) return

    setLoadingPlan(plan.id)
    setError(null)
    setErrorTarget(null)

    try {
      const response = await sendCheckoutMessage(priceId)

      const checkoutUrl = String(response?.payload?.url ?? response?.data?.url ?? "").trim()
      const openedByBackground = Boolean(response?.payload?.opened ?? response?.data?.opened)

      if (response?.success && checkoutUrl && openedByBackground) {
        return
      }

      if (checkoutUrl) {
        try {
          await openCheckoutTab(checkoutUrl)
          return
        } catch (openError) {
          const openErrorMessage =
            openError instanceof Error
              ? openError.message
              : "Unable to open checkout tab."
          setError(openErrorMessage)
          setErrorTarget(sourceId)
          return
        }
      }

      setError(
        response?.error ??
          "Checkout unavailable. No checkout URL was returned."
      )
      setErrorTarget(sourceId)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to connect to billing server."
      )
      setErrorTarget(sourceId)
    } finally {
      setLoadingPlan(null)
    }
  }

  const thinkerAgile = readQuota(limitsByPlan.thinker.agile_prompts_per_month)
  const thinkerDocks = readQuota(limitsByPlan.thinker.docks_summaries_per_month)
  const thinkerMerge = readQuota(limitsByPlan.thinker.brain_merges_per_month)

  const currentAgile = currentLimits.ai_features
    ? readQuota(currentLimits.agile_prompts_per_month)
    : "Locked"
  const currentDocks = currentLimits.zettelkasten
    ? readQuota(currentLimits.docks_summaries_per_month)
    : "Locked"
  const currentMerge = currentLimits.ai_features
    ? readQuota(currentLimits.brain_merges_per_month)
    : "Locked"

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[radial-gradient(80%_55%_at_50%_0%,rgba(250,204,21,0.14),rgba(5,5,5,0.98)_52%)] text-white">
      <div className="border-b border-white/10 px-4 py-3">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onBack}
            className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-black/35 text-zinc-300 transition hover:border-white/30 hover:text-white">
            <ArrowLeft size={14} strokeWidth={2} />
          </button>
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold tracking-[-0.02em] text-white">
              Plans & Access
            </h2>
            <p className="mt-0.5 text-[10px] text-zinc-400">
              Locked and unlocked tools by plan, clearly mapped.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 pt-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <div className="rounded-2xl border border-white/10 bg-black/35 p-1">
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={() => setCycle("monthly")}
              className={`rounded-xl py-2 text-[11px] font-medium transition ${
                cycle === "monthly"
                  ? "bg-white text-black"
                  : "text-zinc-400 hover:text-zinc-100"
              }`}>
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setCycle("yearly")}
              className={`rounded-xl py-2 text-[11px] font-medium transition ${
                cycle === "yearly"
                  ? "bg-[#facc15] text-black"
                  : "text-zinc-400 hover:text-zinc-100"
              }`}>
              Yearly
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-[11px] text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-3 rounded-2xl border border-white/10 bg-black/35 p-3">
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Current Access
          </p>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            <AccessPill
              label="Agile"
              value={currentAgile}
              enabled={currentLimits.ai_features === true}
            />
            <AccessPill
              label="Docks"
              value={currentDocks}
              enabled={currentLimits.zettelkasten === true}
            />
            <AccessPill
              label="Merge"
              value={currentMerge}
              enabled={currentLimits.ai_features === true}
            />
          </div>
        </div>

        {cycle === "yearly" && thinkerPlan ? (
          <div className="mt-3 rounded-2xl border border-[#facc15]/40 bg-[linear-gradient(145deg,rgba(250,204,21,0.25),rgba(250,204,21,0.06)_42%,rgba(9,9,9,0.96))] p-3 shadow-[0_10px_35px_rgba(250,204,21,0.12)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="inline-flex items-center gap-1 rounded-full border border-[#facc15]/55 bg-[#facc15]/20 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#fde68a]">
                  <Crown size={10} />
                  Focus: Thinker Annual
                </p>
                <p className="mt-2 text-[12px] font-semibold text-white">
                  50 Agile + 12 Docks + 5 Brain Merge per month
                </p>
                <p className="mt-1 text-[10px] text-[#fef08a]">
                  $59.99/year (about $5/month) with the highest Thinker quotas.
                </p>
              </div>
              <Sparkles size={14} className="mt-0.5 shrink-0 text-[#facc15]" />
            </div>
            <button
              type="button"
              disabled={loadingPlan !== null || thinkerAnnualCurrent || thinkerAnnualIncludedByHigherTier}
              onClick={() => handleSubscribe(thinkerPlan, "thinker-annual")}
              className="mt-3 w-full rounded-xl bg-[#facc15] py-2.5 text-[12px] font-semibold text-black transition hover:bg-[#f7c700] disabled:opacity-55">
              {loadingPlan === thinkerPlan.id
                ? "Opening checkout..."
                : thinkerAnnualIncludedByHigherTier
                  ? "Included in Thinker Pro"
                  : thinkerAnnualCurrent
                  ? "Current plan"
                  : "Start Thinker Annual"}
            </button>
            {errorTarget === "thinker-annual" && error ? (
              <p className="mt-2 text-[10px] text-red-300">{error}</p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-3 space-y-2.5">
          {PLAN_OPTIONS.map((plan) => {
            const isSameTier = isPlanSameTier(plan.id)
            const isCurrentPlan = isPlanCurrentForSelectedCycle(plan.id)
            const monthlyEquivalent =
              plan.yearlyTotal > 0
                ? Number((plan.yearlyTotal / 12).toFixed(2))
                : 0
            const displayPrice = cycle === "yearly" ? monthlyEquivalent : plan.monthlyPrice
            const yearlySaving =
              cycle === "yearly" && plan.monthlyPrice > 0
                ? Number((plan.monthlyPrice * 12 - plan.yearlyTotal).toFixed(2))
                : null
            const isThinker = plan.id === "thinker"
            const spotlightThinker = isThinker && cycle === "yearly"
            const cycleSwitchLabel =
              isSameTier && !isCurrentPlan && plan.priceMonthly
                ? cycle === "yearly"
                  ? "Switch to yearly"
                  : "Switch to monthly"
                : null

            return (
              <div
                key={plan.id}
                className={`rounded-2xl border p-3 ${
                  spotlightThinker
                    ? "border-[#facc15]/45 bg-[linear-gradient(155deg,rgba(250,204,21,0.14),rgba(9,9,9,0.97)_48%)]"
                    : "border-white/10 bg-black/35"
                }`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-semibold tracking-[-0.02em] text-white">
                      {plan.name}
                    </h3>
                    <p className="mt-0.5 text-[10px] text-zinc-500">{plan.description}</p>
                  </div>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] ${
                      plan.accent === "gold"
                        ? "border-[#facc15]/40 bg-[#facc15]/15 text-[#fde68a]"
                        : "border-white/20 bg-white/[0.05] text-zinc-300"
                    }`}>
                    {isCurrentPlan ? "Current" : isSameTier ? "Current tier" : plan.tag}
                  </span>
                </div>

                <div className="mt-2 flex items-end gap-1.5">
                  <span className="text-[30px] font-semibold leading-none tracking-[-0.04em] text-white">
                    {displayPrice === 0 ? "Free" : `$${displayPrice}`}
                  </span>
                  {displayPrice > 0 ? (
                    <span className="pb-0.5 text-[11px] text-zinc-400">/month</span>
                  ) : null}
                </div>

                {yearlySaving !== null ? (
                  <p className="mt-1 text-[10px] text-[#facc15]">
                    Save ${yearlySaving}/year - billed at ${plan.yearlyTotal}/year
                  </p>
                ) : plan.monthlyPrice > 0 ? (
                  <p className="mt-1 text-[10px] text-zinc-600">billed monthly</p>
                ) : (
                  <p className="mt-1 text-[10px] text-zinc-600">no payment required</p>
                )}

                {isThinker ? (
                  <div className="mt-2 grid grid-cols-3 gap-1.5">
                    <AccessPill label="Agile" value={thinkerAgile} enabled />
                    <AccessPill label="Docks" value={thinkerDocks} enabled />
                    <AccessPill label="Merge" value={thinkerMerge} enabled />
                  </div>
                ) : null}

                {!isThinker && cycle === "yearly" ? (
                  <p className="mt-2 inline-flex items-center gap-1 text-[10px] text-zinc-400">
                    <Lock size={10} className="text-zinc-500" />
                    Agile, Docks and Brain Merge stay locked.
                  </p>
                ) : null}

                {!isThinker && cycle === "monthly" ? (
                  <p className="mt-2 inline-flex items-center gap-1 text-[10px] text-zinc-400">
                    <Lock size={10} className="text-zinc-500" />
                    No monthly AI quotas on this plan.
                  </p>
                ) : null}

                {isThinker && cycle === "monthly" ? (
                  <p className="mt-2 inline-flex items-center gap-1 text-[10px] text-zinc-400">
                    <Zap size={10} className="text-[#facc15]" />
                    Annual adds +20 Agile, +6 Docks and +5 Brain Merge every month.
                  </p>
                ) : null}

                <ul className="mt-2.5 space-y-1.5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-[#facc15]/18">
                        <Check size={8} strokeWidth={3} className="text-[#facc15]" />
                      </span>
                      <span className="text-[11px] leading-relaxed text-zinc-300">{feature}</span>
                    </li>
                  ))}
                </ul>

                {plan.priceMonthly ? (
                  <>
                    <button
                      type="button"
                      disabled={isCurrentPlan || loadingPlan !== null}
                      onClick={() => handleSubscribe(plan)}
                      className={`mt-3 w-full rounded-xl py-2.5 text-[12px] font-semibold transition disabled:opacity-55 ${
                        spotlightThinker
                          ? "bg-[#facc15] text-black hover:bg-[#f7c700]"
                          : "border border-white/15 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                      }`}>
                      {loadingPlan === plan.id
                        ? "Opening checkout..."
                        : isCurrentPlan
                          ? "Current plan"
                          : cycleSwitchLabel
                            ? cycleSwitchLabel
                          : spotlightThinker
                            ? "Start Thinker Annual"
                            : plan.buttonText}
                    </button>
                    {errorTarget === plan.id && error ? (
                      <p className="mt-2 text-[10px] text-red-300">{error}</p>
                    ) : null}
                  </>
                ) : (
                  <button
                    type="button"
                    disabled
                    className="mt-3 w-full rounded-xl border border-white/10 bg-white/[0.03] py-2.5 text-[12px] font-medium text-zinc-500">
                    {isCurrentPlan ? "Current plan" : "Get started free"}
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <div className="mt-3 rounded-2xl border border-white/10 bg-black/35 p-3">
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            Access Matrix
          </p>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {PLAN_ORDER.map((planId) => (
              <p
                key={planId}
                className={`rounded-lg border px-1 py-1 text-center text-[9px] font-semibold uppercase tracking-[0.12em] ${
                  planId === "thinker"
                    ? "border-[#facc15]/40 bg-[#facc15]/12 text-[#fde68a]"
                    : "border-white/15 bg-white/[0.03] text-zinc-300"
                }`}>
                {planId}
              </p>
            ))}
          </div>

          <div className="mt-2 space-y-2">
            {FEATURE_ROWS.map((row) => (
              <div key={row.label}>
                <p className="text-[10px] text-zinc-400">{row.label}</p>
                <div className="mt-1 grid grid-cols-3 gap-1.5">
                  {PLAN_ORDER.map((planId) => {
                    const mapped = mapFeatureValue(
                      row.getValue(limitsByPlan[planId])
                    )
                    return (
                      <span
                        key={`${row.label}-${planId}`}
                        className={`inline-flex h-7 items-center justify-center gap-1 rounded-lg border px-1 text-[9px] font-medium ${
                          mapped.enabled
                            ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-200"
                            : "border-zinc-700/70 bg-zinc-900/70 text-zinc-500"
                        }`}>
                        {mapped.enabled ? <Unlock size={9} /> : <Lock size={9} />}
                        {mapped.label}
                      </span>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {currentTier === "thinker_pro" ? (
          <div className="mt-3 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-[10px] text-emerald-300">
            Your current plan is Thinker Pro with 50 Agile, 12 Docks and 5 Brain Merge per month.
          </div>
        ) : null}

        <p className="pt-3 text-center text-[10px] text-zinc-600">
          <Sparkles size={9} className="mr-1 inline text-[#facc15]" />
          Secure Stripe checkout. Unlocks apply immediately.
        </p>
      </div>
    </div>
  )
}
