import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  ArrowLeft,
  ChevronRight,
  Copy,
  Microscope,
  Brain,
  Map,
  GraduationCap,
  Mic,
  Network,
  CheckCircle2,
  Zap,
  BookMarked,
  Trash2,
  Plus,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Prompt {
  id: string
  title: string
  description: string
  icon: LucideIcon
  purpose: string
  text: string
}

interface Category {
  id: string
  name: string
  icon: LucideIcon
  pageFrom: string
  pageTo: string
  pageBar: string
  prompts: Prompt[]
}

// ─── Prompt Data ──────────────────────────────────────────────────────────────

const PROMPT_CATEGORIES: Category[] = [
  {
    id: "critical",
    name: "Critical Analysis",
    icon: Microscope,
    pageFrom: "#2D1F0A",
    pageTo: "#1A1200",
    pageBar: "#7C5C1A",
    prompts: [
      {
        id: "gap-analysis",
        title: "Gap Analysis",
        description: "Finds what is missing in the argument",
        icon: Microscope,
        purpose: "Identify missing evidence and logical leaps",
        text: `Analyze this content and map all argumentative gaps. For each one:\n\n(1) Quote the passage where the gap appears\n(2) Explain why it is a gap — what is being assumed without demonstration\n(3) Suggest what evidence or reasoning would fill that gap\n\nBe surgical: identify what is implicitly assumed but not demonstrated, what was conveniently omitted, and where the logical chain has unjustified leaps. Order by importance — which gap most weakens the central argument?`,
      },
      {
        id: "socratic",
        title: "Socratic Dialectic",
        description: "Progressively questions down to the core",
        icon: Brain,
        purpose: "Reach deeper clarity through questions",
        text: `Conduct a Socratic dialogue with this content.\n\nStart by identifying the central thesis. Then build a series of 5 progressive questions that challenge that thesis — each one deeper than the previous. For each question:\n\n(1) Formulate the challenging question\n(2) Offer the strongest possible response in defense of the thesis\n(3) Find the weakness in that response\n\nThe goal is to arrive at either a productive aporia (an impasse that reveals the limits of the argument) or a more robust and honest version of the original thesis.`,
      },
      {
        id: "contradictions",
        title: "Contradiction Map",
        description: "Lists internal tensions and paradoxes",
        icon: Map,
        purpose: "Expose inconsistencies that weaken the argument",
        text: `Examine this material and identify all internal tensions:\n\n(1) Claims that directly contradict each other\n(2) Premises that conflict with the conclusions\n(3) Examples used that contradict the general rule the text proposes\n(4) Positions that shift throughout the text without explicit justification\n\nFor each identified contradiction, evaluate: is it an argumentative flaw or an intentional nuance the author failed to articulate clearly? Which contradiction is most central to the argument?`,
      },
      {
        id: "premises",
        title: "Premise Review",
        description: "Questions the foundations of the argument",
        icon: CheckCircle2,
        purpose: "Test whether the fundamental premises are solid",
        text: `List the 5 most fundamental premises that support the central argument of this content.\n\nFor each premise:\n(1) Explain why it is necessary for the argument to work\n(2) Question whether it is true — what evidence supports it?\n(3) Explore what happens to the argument if it is false or only partially true\n(4) Rate on a scale: solid / questionable / fragile\n\nFinal: which premise is most fragile? If it falls, what remains of the argument?`,
      },
      {
        id: "counterfactual",
        title: "Counterfactual Analysis",
        description: "Tests solidity via alternative scenarios",
        icon: Zap,
        purpose: "Reveal what the argument actually depends on",
        text: `For each important conclusion in this content, build a counterfactual scenario: "What if premise X were different — would the conclusion still hold?"\n\nExplore at least 3 relevant counterfactuals. For each:\n(1) Describe the alternative scenario and its plausibility\n(2) How would this scenario affect the central conclusions?\n(3) What does this reveal about the limits and conditions of validity of the original argument?\n\nFinal: which conclusions depend on very specific conditions and which are more robust across different scenarios?`,
      },
    ],
  },
  {
    id: "feynman",
    name: "Feynman Method",
    icon: Brain,
    pageFrom: "#0D1F2D",
    pageTo: "#071420",
    pageBar: "#1E5F8A",
    prompts: [
      {
        id: "feynman-simple",
        title: "Feynman Simplifier",
        description: "Explains as if to a 12-year-old student",
        icon: Brain,
        purpose: "Test the real depth of understanding",
        text: `Explain the central concept of this content as if you were teaching a 12-year-old student who has never encountered this field.\n\nRules:\n- Only everyday language, no technical jargon\n- Use concrete analogies and real-life examples\n- If you cannot explain without technical terms, that is a signal — explicitly point out where the explanation becomes opaque\n\nAfter explaining, evaluate: which parts were easiest to simplify? Which revealed that our understanding is still superficial?`,
      },
      {
        id: "feynman-reverse",
        title: "Reverse Feynman",
        description: "Rebuilds complexity in 5 layers",
        icon: ArrowLeft,
        purpose: "Map the depth progression of the concept",
        text: `Starting from a simple explanation, progressively rebuild the complexity of this content in 5 layers:\n\nLayer 1 — Basic analogy (for anyone)\nLayer 2 — Fundamental mechanism (for a curious student)\nLayer 3 — Nuances and exceptions (for an advanced student)\nLayer 4 — Connections to other fields (for a developing specialist)\nLayer 5 — Frontiers of current knowledge, open questions, what we still do not know\n\nEach layer should build on the previous one without contradicting it.`,
      },
      {
        id: "gap-detector",
        title: "Cognitive Gap Detector",
        description: "Finds where the explanation hides ignorance",
        icon: Microscope,
        purpose: "Identify jargon that masks lack of clarity",
        text: `Act as a rigorous teacher reviewing the explanation in this content. Identify:\n\n(1) Terms that seem explained but are only redefined in equally opaque terms — circular definitions\n(2) Moments where the text uses "clearly", "obviously" or "it is evident that" before skipping an important logical step\n(3) Concepts used as self-explanatory that actually require undeclared prior knowledge\n\nFor each instance found: how should the explanation be reformulated to be genuinely clear?`,
      },
      {
        id: "deep-analogy",
        title: "Deep Analogy",
        description: "Connects to completely different domains",
        icon: Network,
        purpose: "Illuminate aspects of the concept via isomorphism",
        text: `Build 3 analogies for the central concept of this content, each from a completely different domain.\n\nFor each analogy:\n(1) Explain the structural correspondence — what maps to what\n(2) Show where the analogy breaks down or has limits\n(3) Identify which unique aspect of the original concept this analogy illuminates\n\nThe most fertile analogies come from seemingly unrelated domains: try biology, architecture, music, physics, sports, or cooking. Which of the 3 analogies captures the deepest essence?`,
      },
      {
        id: "teaching-test",
        title: "Socratic Teaching Test",
        description: "Simulates a student asking hard questions",
        icon: GraduationCap,
        purpose: "Expose confusing or incomplete points",
        text: `Simulate an intelligent but skeptical student who just read this content for the first time.\n\nAsk 5 genuine questions — not questions that test memorization, but questions that expose:\n- Points where the content is still confusing or ambiguous\n- Places where the text assumes too much from the reader\n- Conclusions that seem to have arrived too quickly\n- Internal tensions the text did not resolve\n\nFor each question, also offer the most honest possible answer — including "I don't know" or "the text doesn't say" when appropriate.`,
      },
    ],
  },
  {
    id: "knowledge-map",
    name: "Knowledge Map",
    icon: Map,
    pageFrom: "#0A1A2D",
    pageTo: "#050F1A",
    pageBar: "#1A4F8A",
    prompts: [
      {
        id: "literature-map",
        title: "Literature Map",
        description: "Maps works and authors in the field",
        icon: BookMarked,
        purpose: "Place this content in its intellectual ecosystem",
        text: `Create a map of the knowledge field to which this content belongs.\n\nIdentify:\n(1) Foundational works and authors who established the field's foundations\n(2) The main currents in tension or dialogue with each other\n(3) The most recent works that are shifting the central debate\n(4) Authors this content implicitly cites without naming — the invisible voices in the argument\n\nOrganize by importance and chronology. Where does this specific content position itself on this map?`,
      },
      {
        id: "conceptual-bridges",
        title: "Conceptual Bridges",
        description: "Connects to seemingly unrelated fields",
        icon: Network,
        purpose: "Discover insight transfers between disciplines",
        text: `Identify how the central concepts of this content connect to at least 3 other seemingly unrelated fields of knowledge.\n\nFor each connection:\n(1) Explain the structural isomorphism — what is structurally analogous between the two fields\n(2) Show how insights from one field could enrich the other\n(3) Identify whether this connection has already been explored in the literature or is a new bridge\n\nWhich interdisciplinary connection is most fertile for future research? Why?`,
      },
      {
        id: "intellectual-timeline",
        title: "Intellectual Timeline",
        description: "Historical evolution of the idea",
        icon: ChevronRight,
        purpose: "Understand how we arrived at the current state of debate",
        text: `Build an intellectual timeline of the central theme of this content.\n\nFor each relevant period or generation:\n(1) What was the central problem that generation of thinkers was trying to solve?\n(2) What solution was proposed and why did it represent an advance?\n(3) What did that solution leave unresolved — what tension created the next period?\n\nShow how we arrived at the current perspective. Where does the debate seem to be heading? What unresolved problem will likely define the next generation of research?`,
      },
      {
        id: "influence-tree",
        title: "Influence Tree",
        description: "Intellectual genealogy of ideas",
        icon: Map,
        purpose: "Trace the origin of ideas and implicit debates",
        text: `Map the intellectual genealogy of the main ideas in this content.\n\n(1) Declared direct influences — who is cited and how\n(2) Indirect influences detectable in the vocabulary, conceptual categories, and argument structure\n(3) Authors with whom this content implicitly debates without citing them — the invisible polemics\n(4) Intellectual traditions that shape which questions are asked (and which questions simply do not appear)\n\nWhich undeclared influence is most determinative for the argument?`,
      },
      {
        id: "field-boundaries",
        title: "Field Boundaries",
        description: "What this field can and cannot know",
        icon: Microscope,
        purpose: "Map the epistemological limits of the approach",
        text: `Map the epistemological limits of the theme of this content.\n\n(1) What is within what this discipline or approach can know with its current tools?\n(2) What is outside by principle — questions this approach simply cannot answer without transforming into something else?\n(3) Where do other fields begin and how do they relate to these boundaries?\n(4) Which questions are at the edges and require genuine interdisciplinary dialogue?\n\nBeing clear about what an approach cannot answer is a sign of intellectual maturity — where does this content demonstrate that maturity?`,
      },
    ],
  },
  {
    id: "academic",
    name: "Academic Writing",
    icon: GraduationCap,
    pageFrom: "#1A0D2D",
    pageTo: "#0D0717",
    pageBar: "#5A1F8A",
    prompts: [
      {
        id: "paper-structure",
        title: "Paper Structure",
        description: "Complete skeleton of an academic article",
        icon: GraduationCap,
        purpose: "Transform ideas into a publishable structure",
        text: `Transform the ideas in this content into a complete academic paper skeleton.\n\nGenerate:\n(1) Provisional title and 3 variations with different angles\n(2) 150-word abstract with: problem, approach, findings, contribution\n(3) 5 strategic keywords for indexing\n(4) Section structure with a description of the argument each section should develop (intro, review, method, results, discussion, conclusion)\n(5) 10 likely references that would be cited and why\n(6) The original contribution this paper would make to the field — what does it add that does not exist?`,
      },
      {
        id: "systematic-review",
        title: "Systematic Review",
        description: "Framework for reviewing literature rigorously",
        icon: Microscope,
        purpose: "Structure a methodologically sound review",
        text: `Structure a systematic literature review on the central theme of this content.\n\nDefine:\n(1) The research question in PICO or SPIDER format\n(2) Study inclusion and exclusion criteria with justification\n(3) Databases to consult and search terms\n(4) Thematic categories to organize and compare findings\n(5) Framework for evaluating the methodological quality of included studies\n(6) Structure of the expected narrative synthesis or meta-analysis\n\nWhat is the most likely publication bias risk in this field?`,
      },
      {
        id: "abstract",
        title: "Surgical Abstract",
        description: "Dense and precise abstract in 200 words",
        icon: BookMarked,
        purpose: "Communicate the essential to reviewers and readers",
        text: `Write a dense and precise academic abstract for the main ideas of this content.\n\nStructure in 200 words:\n(1) Problem and gap motivating the work — 40 words\n(2) Methodological or argumentative approach adopted — 50 words\n(3) Central findings or arguments with specificity — 70 words\n(4) Contribution and implications for the field — 40 words\n\nRules: every sentence must be necessary. Eliminate all unnecessary hedging ("this paper attempts to..."). Be specific about what was found. Do not use jargon without necessity.`,
      },
      {
        id: "falsifiable",
        title: "Falsifiable Hypothesis",
        description: "Transforms intuitions into testable hypotheses",
        icon: Zap,
        purpose: "Connect ideas to the scientific method",
        text: `Transform the central claims of this content into scientifically testable hypotheses.\n\nFor each hypothesis:\n(1) State it in a way that can be refuted by empirical evidence\n(2) Describe what type of data or experiment would confirm it\n(3) Describe what type of data would refute it\n(4) Identify the main confounders to control\n(5) Evaluate the difficulty of testing: easy / moderate / very difficult / currently impossible\n\nWhich hypothesis is most important and most accessible to test now?`,
      },
      {
        id: "peer-review",
        title: "Simulated Peer Review",
        description: "Critiques as a top-journal reviewer",
        icon: CheckCircle2,
        purpose: "Anticipate criticisms before submission",
        text: `Evaluate this content as a rigorous anonymous reviewer for a high-impact journal.\n\nProduce a complete review with:\n(1) 3-sentence summary of what the work claims to do\n(2) Evaluation of original contribution — does it exist? Is it significant for the field?\n(3) Numbered list of major problems (Major Revisions) with detailed explanation\n(4) Numbered list of minor problems (Minor Revisions)\n(5) Evaluation of writing clarity and organization\n(6) Recommended decision: Accept / Minor Revision / Major Revision / Reject — with justification\n\nBe honest. A good peer review helps more than one that only praises.`,
      },
    ],
  },
  {
    id: "communication",
    name: "Communication",
    icon: Mic,
    pageFrom: "#2D0D1A",
    pageTo: "#1A070D",
    pageBar: "#8A1F3F",
    prompts: [
      {
        id: "podcast",
        title: "Podcast Script",
        description: "Complete structured 45-minute episode",
        icon: Mic,
        purpose: "Transform dense content into engaging audio",
        text: `Create a complete 45-minute podcast episode script on the theme of this content.\n\nStructure:\n(1) Opening hook — 2 min: surprising fact or gripping question\n(2) Context — 5 min: why this matters now, for whom\n(3) Main block 1 — 12 min: central concept with stories and examples\n(4) Main block 2 — 12 min: nuances, contradictions, different perspectives\n(5) Implications block — 8 min: what changes in practice\n(6) Closing — 6 min: synthesis in 3 points, call to action\n\nInclude suggested questions for a guest if it is an interview format.`,
      },
      {
        id: "harvard-case",
        title: "Harvard Case Class",
        description: "Case discussion for classroom debate",
        icon: GraduationCap,
        purpose: "Create learning through dilemma and decision",
        text: `Transform this content into a case discussion in the Harvard Business School style.\n\nCreate:\n(1) A central dilemma with no obvious answer\n(2) The relevant facts of the case in chronological order\n(3) Discussion questions for each phase of the class:\n   - Opening: question that opens the debate\n   - Development: 3 questions that deepen it\n   - Synthesis: question that forces a position\n(4) The competing perspectives the instructor should facilitate\n(5) Teaching note: the insights students should arrive at by the end`,
      },
      {
        id: "executive-summary",
        title: "Executive Summary",
        description: "One page for leaders with limited time",
        icon: BookMarked,
        purpose: "Communicate complexity with executive clarity",
        text: `Distill this content into a one-page executive summary for senior leaders.\n\nStructure in blocks:\n(1) The problem and its magnitude — 2 sentences maximum\n(2) Why current approaches do not solve it — 1 paragraph\n(3) 3 key insights, each with supporting evidence\n(4) Decision implications in concrete bullets\n(5) Most important recommendation or next step — 1 sentence\n\nRules: no jargon, no context the reader already knows, no hedging. If it does not fit on one page, cut — do not compress.`,
      },
      {
        id: "academic-thread",
        title: "Academic Thread",
        description: "Academic rigor in viral thread format",
        icon: Zap,
        purpose: "Democratize dense knowledge on social media",
        text: `Transform the ideas of this content into a 15-post thread that combines academic rigor with digital engagement.\n\nStructure:\n- Post 1: hook with a counterintuitive fact or claim\n- Posts 2-4: context and problem\n- Posts 5-9: central argument, one concept per post\n- Posts 10-12: concrete cases or examples\n- Posts 13-14: implications — what changes\n- Post 15: synthesis in 3 points and invitation to discussion\n\nEach post: maximum 280 characters. Clear numbering (1/15). Accessible language without losing precision.`,
      },
      {
        id: "pitch",
        title: "Idea Pitch",
        description: "3-minute presentation with maximum clarity",
        icon: Mic,
        purpose: "Defend an idea clearly and persuasively",
        text: `Structure the ideas of this content as a 3-minute pitch for an academic panel.\n\nStructure with timing:\n(1) Central problem and urgency — 30 seconds\n(2) Why existing approaches fail — 30 seconds\n(3) Your approach and what differentiates it — 60 seconds (the core)\n(4) Evidence or preliminary results — 40 seconds\n(5) Expected impact and concrete next steps — 20 seconds\n\nRules: be specific in each section. The audience decides in the first 30 seconds. Start strong.`,
      },
    ],
  },
  {
    id: "systems",
    name: "Systems Thinking",
    icon: Network,
    pageFrom: "#0A1F15",
    pageTo: "#05100A",
    pageBar: "#1A6B40",
    prompts: [
      {
        id: "first-principles",
        title: "First Principles",
        description: "Deconstructs down to irreducible axioms",
        icon: Zap,
        purpose: "Eliminate unexamined assumptions",
        text: `Deconstruct the ideas of this content down to their irreducible axioms using first-principles reasoning.\n\nFor each important claim:\n(1) Ask "why is this true?" repeatedly until you cannot go deeper\n(2) Separate: which are axioms (accepted without proof) and which are derived propositions?\n(3) Reconstruct the conclusion from first principles — which steps were necessary, which were shortcuts?\n\nFinal: what can be simplified without losing substance? What seems complex but is derivable from something simple?`,
      },
      {
        id: "mental-models",
        title: "Mental Models",
        description: "Applies the 10 most useful models",
        icon: Brain,
        purpose: "See the problem from multiple angles",
        text: `Apply the 10 most relevant mental models to analyze the theme of this content.\n\nFor each model:\n(1) How it applies specifically to this content\n(2) What new insight it reveals that was not obvious in direct analysis\n(3) Where the model fails or has limits in this context\n\nPriority models: inversion, second-order effects, probabilistic thinking, map vs territory, circle of competence, Occam's razor, opportunity costs, survivorship bias, marginal thinking, OODA loop.\n\nWhich model produces the most surprising insight?`,
      },
      {
        id: "systems-analysis",
        title: "Systems Analysis",
        description: "Maps feedback loops and leverage points",
        icon: Network,
        purpose: "Find where to intervene most efficiently",
        text: `Map the system described or implied in this content.\n\nIdentify:\n(1) The elements of the system — actors, variables, resources, flows\n(2) The relationships and dependencies — who affects whom\n(3) Feedback loops: reinforcing (amplify) and balancing (resist)\n(4) Leverage points — where a small intervention produces a disproportionate effect\n(5) Bottlenecks — where the flow is blocked\n(6) Emergent behaviors from the interactions\n\nIf you could intervene at only one point in the system, which would it be and why?`,
      },
      {
        id: "second-order",
        title: "Second-Order Effects",
        description: "The consequences of consequences",
        icon: ChevronRight,
        purpose: "Anticipate non-obvious long-term impacts",
        text: `For each conclusion or proposal in this content, map the second and third-order effects.\n\n1st-order effects: direct and obvious consequences\n2nd-order effects: what happens as a result of the 1st-order consequences — usually counterintuitive\n3rd-order effects: the adaptations agents make in response to 2nd-order effects\n\nIdentify:\n- Which higher-order effect is most important but being ignored?\n- Which 2nd-order effects contradict the original intent?\n- Which unintended effect is most likely to appear first?`,
      },
      {
        id: "inversion",
        title: "Inversion",
        description: "Solves in reverse — by guaranteeing failure",
        icon: Zap,
        purpose: "Find hidden risks and robust paths",
        text: `Solve the central problem of this content through inversion — instead of asking how to achieve the goal, ask how to guarantee failure.\n\n(1) List all reliable ways to fail at what this content proposes\n(2) Identify which of those failure modes are already present in the current state\n(3) For each present failure mode: what would be necessary to eliminate it?\n(4) Reconstruct the positive strategy from what remains\n\nCharlie Munger: "Tell me where I'm going to die, that's where I won't go." What does this exercise reveal that direct analysis did not show?`,
      },
    ],
  },
]

// ─── Folder Card ──────────────────────────────────────────────────────────────

function FolderCard({ category, onClick }: { category: Category; onClick: () => void }) {
  const [isOpen, setIsOpen] = useState(false)
  const uid = `folder_${category.id}`

  const pages = [
    {
      initial: { rotate: -3, x: -38, y: 2 },
      open: { rotate: -8, x: -70, y: -55 },
      transition: { type: "spring" as const, bounce: 0.15, stiffness: 160, damping: 22 },
    },
    {
      initial: { rotate: 0, x: 0, y: 0 },
      open: { rotate: 1, x: 2, y: -75 },
      transition: { type: "spring" as const, duration: 0.55, bounce: 0.12, stiffness: 190, damping: 24 },
    },
    {
      initial: { rotate: 3.5, x: 42, y: 1 },
      open: { rotate: 9, x: 75, y: -60 },
      transition: { type: "spring" as const, duration: 0.58, bounce: 0.17, stiffness: 170, damping: 21 },
    },
  ]

  const PageEl = () => (
    <div
      className="w-full h-full rounded-xl shadow-lg p-3"
      style={{ background: `linear-gradient(to bottom, ${category.pageFrom}, ${category.pageTo})` }}
    >
      <div className="flex flex-col gap-1.5">
        <div className="w-full h-1.5 rounded-full" style={{ background: category.pageBar }} />
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex gap-1.5">
            <div className="flex-1 h-1 rounded-full" style={{ background: category.pageBar }} />
            <div className="flex-1 h-1 rounded-full" style={{ background: category.pageBar }} />
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
      className="flex flex-col items-center gap-2 rounded-xl border border-white/8 bg-[#0a0a0c] p-3 transition-all hover:border-white/20 hover:bg-[#0e0e11] active:scale-[0.97]"
    >
      {/* Folder — original 320×208 scaled 0.34× to 109×71 */}
      <div style={{ width: "109px", height: "71px", overflow: "hidden", flexShrink: 0 }}>
        <div
          style={{
            transform: "scale(0.34)",
            transformOrigin: "top left",
            width: "320px",
            height: "208px",
            pointerEvents: "none",
          }}
        >
          {/* folder body */}
          <div
            className="folder relative w-[87.5%] mx-auto items-center h-full flex justify-center"
            style={{
              background: "#18151B",
              boxShadow: "0px 0px 15.7px 16px rgba(79, 73, 85, 0.30) inset",
              borderRadius: 10,
            }}
          >
            {pages.map((page, i) => (
              <motion.div
                key={i}
                initial={page.initial}
                animate={isOpen ? page.open : page.initial}
                transition={page.transition}
                className="absolute top-2 w-32 h-fit rounded-xl"
              >
                <PageEl />
              </motion.div>
            ))}
          </div>

          {/* folder flap */}
          <motion.div
            animate={{ rotateX: isOpen ? -40 : 0 }}
            transition={{ type: "spring", duration: 0.5, bounce: 0.2 }}
            className="absolute -left-[1px] -right-[1px] -bottom-[1px] z-20 h-44 rounded-3xl origin-bottom flex justify-center items-center overflow-visible"
          >
            <svg
              className="w-full h-full overflow-visible"
              viewBox="0 0 235 121"
              fill="none"
              preserveAspectRatio="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <foreignObject x="-13" y="-13" width="262.4" height="148.4">
                <div
                  style={{
                    backdropFilter: "blur(6.5px)",
                    clipPath: `url(#${uid}_clip)`,
                    height: "100%",
                    width: "100%",
                  }}
                />
              </foreignObject>
              <path
                d="M104.615 0.350494L33.1297 0.838776C32.7542 0.841362 32.3825 0.881463 32.032 0.918854C31.6754 0.956907 31.3392 0.992086 31.0057 0.992096H31.0047C30.6871 0.99235 30.3673 0.962051 30.0272 0.929596C29.6927 0.897686 29.3384 0.863802 28.9803 0.866119L13.2693 0.967682H13.2527L13.2352 0.969635C13.1239 0.981406 13.0121 0.986674 12.9002 0.986237H9.91388C8.33299 0.958599 6.76052 1.22345 5.27423 1.76651H5.27325C4.33579 2.11246 3.48761 2.66213 2.7879 3.37393L2.49689 3.68839L2.492 3.69424C1.62667 4.73882 1.00023 5.96217 0.656067 7.27725C0.653324 7.28773 0.654065 7.29886 0.652161 7.30948C0.3098 8.62705 0.257231 10.0048 0.499817 11.3446L12.2147 114.399L12.2156 114.411L12.2176 114.423C12.6046 116.568 13.7287 118.508 15.3934 119.902C17.058 121.297 19.1572 122.056 21.3231 122.049V122.05H215.379C217.76 122.02 220.064 121.192 221.926 119.698V119.697C223.657 118.384 224.857 116.485 225.305 114.35L225.307 114.339L235.914 53.3798L235.968 53.1093L235.97 53.0985L235.971 53.0888C236.134 51.8978 236.044 50.685 235.705 49.5321C235.307 48.1669 234.63 46.9005 233.717 45.8144L233.383 45.4296C232.58 44.5553 231.614 43.8449 230.539 43.3398C229.311 42.7628 227.971 42.4685 226.616 42.4774H146.746C144.063 42.4705 141.423 41.8004 139.056 40.5263C136.691 39.2522 134.671 37.4127 133.175 35.1689L113.548 5.05948L113.544 5.05362L113.539 5.04776C112.545 3.65165 111.238 2.51062 109.722 1.72061C108.266 0.886502 106.627 0.422235 104.952 0.365143V0.364166L104.633 0.350494H104.615Z"
                fill={`url(#${uid}_fill)`}
                fillOpacity="0.3"
                stroke={`url(#${uid}_stroke)`}
                strokeWidth="0.7"
              />
              <defs>
                <clipPath id={`${uid}_clip`} transform="translate(13 13)">
                  <path d="M104.615 0.350494L33.1297 0.838776C32.7542 0.841362 32.3825 0.881463 32.032 0.918854C31.6754 0.956907 31.3392 0.992086 31.0057 0.992096H31.0047C30.6871 0.99235 30.3673 0.962051 30.0272 0.929596C29.6927 0.897686 29.3384 0.863802 28.9803 0.866119L13.2693 0.967682H13.2527L13.2352 0.969635C13.1239 0.981406 13.0121 0.986674 12.9002 0.986237H9.91388C8.33299 0.958599 6.76052 1.22345 5.27423 1.76651H5.27325C4.33579 2.11246 3.48761 2.66213 2.7879 3.37393L2.49689 3.68839L2.492 3.69424C1.62667 4.73882 1.00023 5.96217 0.656067 7.27725C0.653324 7.28773 0.654065 7.29886 0.652161 7.30948C0.3098 8.62705 0.257231 10.0048 0.499817 11.3446L12.2147 114.399L12.2156 114.411L12.2176 114.423C12.6046 116.568 13.7287 118.508 15.3934 119.902C17.058 121.297 19.1572 122.056 21.3231 122.049V122.05H215.379C217.76 122.02 220.064 121.192 221.926 119.698V119.697C223.657 118.384 224.857 116.485 225.305 114.35L225.307 114.339L235.914 53.3798L235.968 53.1093L235.97 53.0985L235.971 53.0888C236.134 51.8978 236.044 50.685 235.705 49.5321C235.307 48.1669 234.63 46.9005 233.717 45.8144L233.383 45.4296C232.58 44.5553 231.614 43.8449 230.539 43.3398C229.311 42.7628 227.971 42.4685 226.616 42.4774H146.746C144.063 42.4705 141.423 41.8004 139.056 40.5263C136.691 39.2522 134.671 37.4127 133.175 35.1689L113.548 5.05948L113.544 5.05362L113.539 5.04776C112.545 3.65165 111.238 2.51062 109.722 1.72061C108.266 0.886502 106.627 0.422235 104.952 0.365143V0.364166L104.633 0.350494H104.615Z" />
                </clipPath>
                <linearGradient id={`${uid}_fill`} x1="114.7" y1="0.7" x2="114.7" y2="121.7" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#2D2535" />
                  <stop offset="1" stopColor="#2A2A2A" />
                </linearGradient>
                <linearGradient id={`${uid}_stroke`} x1="114.7" y1="0.7" x2="114.7" y2="121.7" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#424242" stopOpacity="0.04" />
                  <stop offset="1" stopColor="#212121" stopOpacity="0.3" />
                </linearGradient>
              </defs>
            </svg>
          </motion.div>
        </div>
      </div>

      {/* Label */}
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[11px] font-semibold text-white/90 text-center leading-tight">
          {category.name}
        </span>
        <span className="text-[9px] text-zinc-500">{category.prompts.length} prompts</span>
      </div>
    </button>
  )
}

// ─── Prompt Card ──────────────────────────────────────────────────────────────

function PromptCard({ prompt, onClick }: { prompt: Prompt; onClick: () => void }) {
  const Icon = prompt.icon
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-start gap-1.5 rounded-lg border border-white/8 bg-[#0a0a0c] p-2.5 text-left transition-all hover:border-white/20 hover:bg-[#0e0e11] active:scale-[0.97]"
    >
      <div className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/5">
        <Icon size={13} className="text-zinc-300" strokeWidth={1.5} />
      </div>
      <div>
        <p className="text-[11px] font-semibold text-white/90 leading-tight">{prompt.title}</p>
        <p className="mt-0.5 text-[9px] text-zinc-500 leading-tight line-clamp-2">{prompt.description}</p>
      </div>
    </button>
  )
}

// ─── Prompt Modal ─────────────────────────────────────────────────────────────

function PromptModal({
  prompt,
  categoryName,
  onClose,
  onUse,
  isUsing,
}: {
  prompt: Prompt
  categoryName: string
  onClose: () => void
  onUse: () => void
  isUsing: boolean
}) {
  const [copied, setCopied] = useState(false)
  const Icon = prompt.icon

  async function handleCopy() {
    await navigator.clipboard.writeText(prompt.text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.15 }}
      className="absolute inset-0 z-50 flex flex-col bg-[#060606]"
    >
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/8 px-4 py-3">
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/8 hover:text-white transition-colors"
        >
          <ArrowLeft size={15} strokeWidth={1.5} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-zinc-500">{categoryName}</p>
          <p className="text-sm font-semibold text-white truncate">{prompt.title}</p>
        </div>
        <div className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/5">
          <Icon size={13} className="text-zinc-300" strokeWidth={1.5} />
        </div>
      </div>

      {/* Purpose */}
      <div className="border-b border-white/6 px-4 py-2">
        <p className="text-[10px] text-zinc-500">
          <span className="text-zinc-400 font-medium">Purpose: </span>
          {prompt.purpose}
        </p>
      </div>

      {/* Prompt text */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-300 font-sans">
          {prompt.text}
        </pre>
      </div>

      {/* Actions */}
      <div className="border-t border-white/8 p-3 flex gap-2">
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-zinc-300 hover:bg-white/10 transition-colors"
        >
          {copied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          onClick={onUse}
          disabled={isUsing}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#facc15] px-3 py-2 text-[11px] font-semibold text-black hover:bg-[#f4c400] disabled:opacity-60 transition-colors"
        >
          <Zap size={12} />
          {isUsing ? "Sending..." : "Use in NotebookLM"}
        </button>
      </div>
    </motion.div>
  )
}

// ─── Saved Tab ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "minddock_saved_prompts"

interface SavedItem {
  id: string
  title: string
  text: string
  createdAt: number
}

function SavedTab() {
  const [items, setItems] = useState<SavedItem[]>([])
  const [title, setTitle] = useState("")
  const [text, setText] = useState("")
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [isUsing, setIsUsing] = useState<string | null>(null)

  useEffect(() => {
    chrome.storage.local.get(STORAGE_KEY, (res) => {
      setItems(res[STORAGE_KEY] ?? [])
    })
  }, [])

  function persist(next: SavedItem[]) {
    setItems(next)
    chrome.storage.local.set({ [STORAGE_KEY]: next })
  }

  function handleSave() {
    if (!text.trim()) return
    const newItem: SavedItem = {
      id: crypto.randomUUID(),
      title: title.trim() || text.trim().slice(0, 40),
      text: text.trim(),
      createdAt: Date.now(),
    }
    persist([newItem, ...items])
    setTitle("")
    setText("")
  }

  async function handleCopy(item: SavedItem) {
    await navigator.clipboard.writeText(item.text)
    setCopiedId(item.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  async function handleUse(item: SavedItem) {
    setIsUsing(item.id)
    try {
      const tabs = await chrome.tabs.query({ url: "*://notebooklm.google.com/*" })
      if (tabs.length === 0) {
        await chrome.tabs.create({ url: "https://notebooklm.google.com" })
      } else {
        await chrome.tabs.update(tabs[0].id!, { active: true })
        try {
          await chrome.tabs.sendMessage(tabs[0].id!, { command: "MINDDOCK_INJECT_PROMPT", text: item.text })
        } catch {
          await navigator.clipboard.writeText(item.text)
        }
      }
    } finally {
      setIsUsing(null)
    }
  }

  function handleDelete(id: string) {
    persist(items.filter((i) => i.id !== id))
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Add form */}
      <div className="border-b border-white/8 p-3 flex flex-col gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (optional)"
          className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white placeholder-zinc-600 outline-none focus:border-white/20"
        />
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste or write your prompt here..."
          rows={4}
          className="w-full resize-none rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white placeholder-zinc-600 outline-none focus:border-white/20 leading-relaxed"
        />
        <button
          onClick={handleSave}
          disabled={!text.trim()}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-[#facc15] px-3 py-2 text-[11px] font-semibold text-black hover:bg-[#f4c400] disabled:opacity-40 transition-colors"
        >
          <Plus size={12} />
          Save prompt
        </button>
      </div>

      {/* Saved list */}
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <BookMarked size={20} className="text-zinc-600" strokeWidth={1} />
            <p className="text-[11px] text-zinc-600">No saved prompts yet.</p>
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {items.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 p-3">
                <p className="text-[11px] font-semibold text-white/90 leading-tight truncate">{item.title}</p>
                <p className="text-[10px] text-zinc-500 leading-relaxed line-clamp-2">{item.text}</p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => handleCopy(item)}
                    className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-zinc-400 hover:bg-white/10 transition-colors"
                  >
                    {copiedId === item.id ? <CheckCircle2 size={10} /> : <Copy size={10} />}
                    {copiedId === item.id ? "Copied" : "Copy"}
                  </button>
                  <button
                    onClick={() => handleUse(item)}
                    disabled={isUsing === item.id}
                    className="flex flex-1 items-center justify-center gap-1 rounded-md bg-[#facc15] px-2 py-1 text-[10px] font-semibold text-black hover:bg-[#f4c400] disabled:opacity-60 transition-colors"
                  >
                    <Zap size={10} />
                    {isUsing === item.id ? "Sending..." : "Use in NotebookLM"}
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="flex items-center justify-center rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-zinc-500 hover:text-red-400 hover:border-red-400/30 transition-colors"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface PromptLabProps {
  onBack: () => void
}

export function PromptLab({ onBack }: PromptLabProps) {
  const [tab, setTab] = useState<"lab" | "saved">("lab")
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null)
  const [selectedPrompt, setSelectedPrompt] = useState<Prompt | null>(null)
  const [isUsing, setIsUsing] = useState(false)

  async function handleUsePrompt(text: string) {
    setIsUsing(true)
    try {
      const tabs = await chrome.tabs.query({ url: "*://notebooklm.google.com/*" })
      if (tabs.length === 0) {
        await chrome.tabs.create({ url: "https://notebooklm.google.com" })
      } else {
        await chrome.tabs.update(tabs[0].id!, { active: true })
        try {
          await chrome.tabs.sendMessage(tabs[0].id!, {
            command: "MINDDOCK_INJECT_PROMPT",
            text,
          })
        } catch {
          await navigator.clipboard.writeText(text)
        }
      }
    } finally {
      setIsUsing(false)
      setSelectedPrompt(null)
    }
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/8 px-4 pt-4 pb-3">
        <button
          onClick={onBack}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 hover:bg-white/8 hover:text-white transition-colors"
        >
          <ArrowLeft size={15} strokeWidth={1.5} />
        </button>
        <span className="text-sm font-semibold text-white">Prompt Library</span>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-white/8 px-4 pt-2">
        {(["lab", "saved"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 px-3 text-[12px] font-medium transition-colors border-b-2 ${
              tab === t
                ? "border-[#facc15] text-[#facc15]"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t === "lab" ? "Lab" : "Saved"}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === "saved" ? (
        <SavedTab />
      ) : selectedCategory ? (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b border-white/6 px-4 py-2">
            <button
              onClick={() => setSelectedCategory(null)}
              className="flex h-6 w-6 items-center justify-center rounded text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <ArrowLeft size={13} strokeWidth={1.5} />
            </button>
            <selectedCategory.icon size={12} className="text-zinc-400" strokeWidth={1.5} />
            <span className="text-[12px] font-medium text-zinc-300">{selectedCategory.name}</span>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <div className="grid grid-cols-3 gap-2">
              {selectedCategory.prompts.map((prompt) => (
                <PromptCard
                  key={prompt.id}
                  prompt={prompt}
                  onClick={() => setSelectedPrompt(prompt)}
                />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-3">
            {PROMPT_CATEGORIES.map((cat) => (
              <FolderCard key={cat.id} category={cat} onClick={() => setSelectedCategory(cat)} />
            ))}
          </div>
        </div>
      )}

      {/* Prompt Modal */}
      <AnimatePresence>
        {selectedPrompt && (
          <PromptModal
            prompt={selectedPrompt}
            categoryName={selectedCategory?.name ?? ""}
            onClose={() => setSelectedPrompt(null)}
            onUse={() => handleUsePrompt(selectedPrompt.text)}
            isUsing={isUsing}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
