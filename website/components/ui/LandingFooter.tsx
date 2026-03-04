import Image from "next/image"
import minddockLogo from "../../../public/lp/logo/logo minddock sem fundo.png"
import footerBg from "../../../public/lp/background footer.png"

const CHROME_URL = "https://chromewebstore.google.com/detail/minddock/your-extension-id"
const GITHUB_URL  = "https://github.com/Tteuz17/minddock-main-new"
const CONTACT_URL = "mailto:hello@minddock.ai"

const nav = [
  {
    heading: "Product",
    links: [
      { label: "Features",   href: "#features" },
      { label: "Pricing",    href: "#pricing" },
      { label: "Download",   href: CHROME_URL, external: true },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "GitHub",     href: GITHUB_URL,  external: true },
      { label: "Contact",    href: CONTACT_URL },
    ],
  },
]

export default function LandingFooter() {
  const year = new Date().getFullYear()

  return (
    <footer
      style={{
        position: "relative",
        overflow: "hidden",
        background: "#050608",
        borderTop: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Background image */}
      <Image
        src={footerBg}
        alt=""
        aria-hidden="true"
        fill
        style={{ objectFit: "cover", objectPosition: "center bottom", opacity: 0.55, pointerEvents: "none" }}
        priority={false}
      />

      {/* Overlay to keep text legible */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(180deg, rgba(5,6,8,0.6) 0%, rgba(5,6,8,0.3) 50%, rgba(5,6,8,0.55) 100%)",
          pointerEvents: "none",
        }}
      />

      {/* Faint watermark */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          bottom: "-0.1em",
          right: "-0.05em",
          fontSize: "clamp(6rem, 18vw, 16rem)",
          fontWeight: 800,
          letterSpacing: "-0.06em",
          color: "rgba(255,255,255,0.025)",
          lineHeight: 1,
          pointerEvents: "none",
          userSelect: "none",
          whiteSpace: "nowrap",
        }}
      >
        MINDDOCK
      </div>

      {/* Yellow top accent bar */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "2px",
          background: "linear-gradient(90deg, transparent 0%, #facc15 30%, #facc15 70%, transparent 100%)",
          opacity: 0.35,
        }}
      />

      <div
        style={{
          position: "relative",
          maxWidth: "1280px",
          margin: "0 auto",
          padding: "0 1.5rem",
        }}
      >

        {/* ── Main body ─────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr auto",
            gap: "4rem",
            padding: "4.5rem 0 4rem",
            alignItems: "start",
          }}
        >
          {/* Left — brand statement */}
          <div>
            <Image
              src={minddockLogo}
              alt="MindDock"
              style={{ height: "2.4rem", width: "auto", objectFit: "contain", marginBottom: "2rem" }}
            />

            <p
              style={{
                fontSize: "clamp(1.6rem, 3.2vw, 2.6rem)",
                fontWeight: 600,
                lineHeight: 1.15,
                letterSpacing: "-0.04em",
                color: "#ffffff",
                maxWidth: "520px",
                marginBottom: "2rem",
              }}
            >
              Built for researchers
              <br />
              who think{" "}
              <span style={{ color: "#facc15" }}>in systems.</span>
            </p>

            {/* Meta badges */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginBottom: "2.5rem" }}>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  fontSize: "11px",
                  letterSpacing: "0.02em",
                  color: "rgba(255,255,255,0.38)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "999px",
                  padding: "0.3rem 0.75rem",
                }}
              >
                <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#4ade80", flexShrink: 0 }} />
                Free plan available
              </span>
              <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.18)", letterSpacing: "0.02em" }}>
                Chrome Extension · MV3 · v0.1.0
              </span>
            </div>

            {/* CTA */}
            <a
              href={CHROME_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.55rem",
                background: "#facc15",
                color: "#000",
                borderRadius: "999px",
                padding: "0.7rem 1.3rem",
                fontSize: "13px",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
                <path d="M12 2a10 10 0 0 1 8.66 5H12Z" fill="#EA4335" />
                <path d="M3.34 7A10 10 0 0 0 7.5 21.33L12 13Z" fill="#34A853" />
                <path d="M12 22a10 10 0 0 0 8.66-15H12l-4.5 7.33Z" fill="#FBBC05" />
                <circle cx="12" cy="12" r="5" fill="#fff" />
                <circle cx="12" cy="12" r="3.5" fill="#4285F4" />
              </svg>
              Add to Chrome — it's free
            </a>
          </div>

          {/* Right — nav columns */}
          <div style={{ display: "flex", gap: "3.5rem", paddingTop: "0.25rem" }}>
            {nav.map((col) => (
              <div key={col.heading}>
                <p
                  style={{
                    fontSize: "10px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.22em",
                    color: "rgba(255,255,255,0.22)",
                    marginBottom: "1.1rem",
                  }}
                >
                  {col.heading}
                </p>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.9rem" }}>
                  {col.links.map((link) => (
                    <li key={link.label}>
                      <a
                        href={link.href}
                        target={"external" in link && link.external ? "_blank" : undefined}
                        rel={"external" in link && link.external ? "noopener noreferrer" : undefined}
                        style={{
                          fontSize: "13px",
                          color: "rgba(255,255,255,0.42)",
                          textDecoration: "none",
                        }}
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* ── Bottom bar ─────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "1.25rem 0 2rem",
            borderTop: "1px solid rgba(255,255,255,0.05)",
            flexWrap: "wrap",
            gap: "0.5rem",
          }}
        >
          <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.18)", margin: 0 }}>
            © {year} MindDock. All rights reserved.
          </p>
          <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.12)", margin: 0, letterSpacing: "0.02em" }}>
            Supercharging NotebookLM since 2024.
          </p>
        </div>

      </div>
    </footer>
  )
}
