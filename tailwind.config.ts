import type { Config } from "tailwindcss"
import animate from "tailwindcss-animate"

const config: Config = {
  darkMode: ["class"],
  content: [
    "./popup.tsx",
    "./sidepanel.tsx",
    "./contents/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        // MindDock palette
        bg: {
          DEFAULT: "#000000",
          secondary: "#0a0a0a",
          tertiary: "#141414"
        },
        border: {
          DEFAULT: "rgba(255, 255, 255, 0.12)",
          light: "rgba(255, 255, 255, 0.08)",
          lighter: "rgba(255, 255, 255, 0.06)"
        },
        text: {
          DEFAULT: "#ffffff",
          secondary: "#a1a1aa",
          tertiary: "#71717a"
        },
        action: {
          DEFAULT: "#facc15",
          hover: "#eab308"
        },
        success: "#22c55e",
        error: "#ef4444",
        info: "#3b82f6",

        // shadcn/ui compat
        background: "#000000",
        foreground: "#ffffff",
        card: {
          DEFAULT: "#0a0a0a",
          foreground: "#ffffff"
        },
        popover: {
          DEFAULT: "#0a0a0a",
          foreground: "#ffffff"
        },
        primary: {
          DEFAULT: "#facc15",
          foreground: "#000000"
        },
        secondary: {
          DEFAULT: "#141414",
          foreground: "#ffffff"
        },
        muted: {
          DEFAULT: "#141414",
          foreground: "#71717a"
        },
        accent: {
          DEFAULT: "rgba(255, 255, 255, 0.08)",
          foreground: "#ffffff"
        },
        destructive: {
          DEFAULT: "#ef4444",
          foreground: "#ffffff"
        },
        input: "rgba(255, 255, 255, 0.08)",
        ring: "#facc15"
      },

      fontFamily: {
        sans: [
          "Plus Jakarta Sans",
          "-apple-system",
          "BlinkMacSystemFont",
          "sans-serif"
        ]
      },

      fontSize: {
        "h1": ["28px", { fontWeight: "700", letterSpacing: "-0.02em" }],
        "h2": ["22px", { fontWeight: "600", letterSpacing: "-0.01em" }],
        "h3": ["18px", { fontWeight: "600" }],
        "body": ["14px", { fontWeight: "400", lineHeight: "1.6" }],
        "body-sm": ["13px", { fontWeight: "400" }],
        "caption": ["11px", { fontWeight: "500", letterSpacing: "0.02em" }],
        "btn": ["14px", { fontWeight: "500", letterSpacing: "0.01em" }]
      },

      borderRadius: {
        sm: "6px",
        md: "10px",
        lg: "14px",
        xl: "20px",
        DEFAULT: "10px"
      },

      boxShadow: {
        "elevation-1": "0 2px 8px rgba(0, 0, 0, 0.4)",
        "elevation-2": "0 8px 32px rgba(0, 0, 0, 0.6)"
      },

      transitionTimingFunction: {
        "apple": "cubic-bezier(0.4, 0, 0.2, 1)"
      },

      backgroundImage: {
        "gradient-fade": "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.8) 100%)"
      },

      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" }
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" }
        },
        "fade-in": {
          from: { opacity: "0", transform: "scale(0.97)" },
          to: { opacity: "1", transform: "scale(1)" }
        },
        "fade-out": {
          from: { opacity: "1", transform: "scale(1)" },
          to: { opacity: "0", transform: "scale(0.97)" }
        },
        "slide-in-right": {
          from: { transform: "translateX(100%)", opacity: "0" },
          to: { transform: "translateX(0)", opacity: "1" }
        },
        "slide-in-bottom": {
          from: { transform: "translateY(12px)", opacity: "0" },
          to: { transform: "translateY(0)", opacity: "1" }
        },
        "stagger-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" }
        },
        "spin-slow": {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" }
        },
        "pulse-yellow": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(250, 204, 21, 0.4)" },
          "50%": { boxShadow: "0 0 0 6px rgba(250, 204, 21, 0)" }
        }
      },

      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
        "fade-out": "fade-out 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
        "slide-in-right": "slide-in-right 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        "slide-in-bottom": "slide-in-bottom 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
        "stagger-in": "stagger-in 0.3s cubic-bezier(0.4, 0, 0.2, 1) both",
        "spin-slow": "spin-slow 2s linear infinite",
        "pulse-yellow": "pulse-yellow 2s ease-in-out infinite"
      }
    }
  },
  plugins: [animate]
}

export default config
