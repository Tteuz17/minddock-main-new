import type { Metadata } from "next"
import { Fraunces, Manrope } from "next/font/google"
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
    "MindDock extends NotebookLM with Zettelkasten workflows, threads, graph view, smarter capture, and durable research structure."
}

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className={`${sansFont.variable} ${serifFont.variable}`}>{children}</body>
    </html>
  )
}
