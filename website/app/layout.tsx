import type { Metadata } from "next"
import { Fraunces, Manrope } from "next/font/google"
import { ThemeProvider } from "next-themes"
import "./globals.css"

const sansFont = Manrope({
  subsets: ["latin"],
  variable: "--font-sans"
})

const serifFont = Fraunces({
  subsets: ["latin"],
  variable: "--font-serif",
  weight: ["400", "500"]
})

export const metadata: Metadata = {
  title: "MindDock | NotebookLM for serious knowledge work",
  description:
    "MindDock extends NotebookLM with AI-powered prompts, smart capture, durable research structure, and advanced export tools."
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${sansFont.variable} ${serifFont.variable}`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
