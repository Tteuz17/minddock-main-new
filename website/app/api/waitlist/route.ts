import { Resend } from "resend"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

export async function POST(req: Request) {
  try {
    const { email } = await req.json()

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email." }, { status: 400 })
    }

    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: "Service unavailable." }, { status: 503 })
    }

    const resend = new Resend(apiKey)
    const FROM = process.env.RESEND_FROM ?? "onboarding@resend.dev"
    const NOTIFY_EMAIL = process.env.WAITLIST_NOTIFY_EMAIL ?? ""

    await resend.emails.send({
      from: FROM,
      to: email,
      subject: "You're on the list — MindDock",
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#050608;color:#ffffff;padding:48px 32px;max-width:520px;margin:0 auto;border-radius:16px">
          <div style="margin-bottom:32px">
            <span style="display:inline-block;background:#facc15;color:#000;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;padding:6px 14px;border-radius:99px">
              Early Access
            </span>
          </div>
          <h1 style="font-size:26px;font-weight:600;letter-spacing:-0.04em;margin:0 0 16px">
            You're on the list.
          </h1>
          <p style="font-size:15px;line-height:1.7;color:rgba(255,255,255,0.6);margin:0 0 24px">
            Thanks for signing up for early access to MindDock.<br/>
            As soon as we open spots, you'll be one of the first to know.
          </p>
          <p style="font-size:13px;color:rgba(255,255,255,0.3);margin:0">
            — MindDock Team
          </p>
        </div>
      `
    })

    if (NOTIFY_EMAIL) {
      await resend.emails.send({
        from: FROM,
        to: NOTIFY_EMAIL,
        subject: `[MindDock Waitlist] New signup: ${email}`,
        html: `<p>New email on waitlist: <strong>${email}</strong></p>`
      })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[Waitlist]", err)
    return NextResponse.json({ error: "Internal error. Please try again." }, { status: 500 })
  }
}
