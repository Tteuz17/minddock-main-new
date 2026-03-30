import { Resend } from "resend"
import { NextResponse } from "next/server"

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM = process.env.RESEND_FROM ?? "onboarding@resend.dev"
const NOTIFY_EMAIL = process.env.WAITLIST_NOTIFY_EMAIL ?? ""

export async function POST(req: Request) {
  try {
    const { email } = await req.json()

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Email inválido." }, { status: 400 })
    }

    // Confirmation email to user
    await resend.emails.send({
      from: FROM,
      to: email,
      subject: "Você está na lista — MindDock",
      html: `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#050608;color:#ffffff;padding:48px 32px;max-width:520px;margin:0 auto;border-radius:16px">
          <div style="margin-bottom:32px">
            <span style="display:inline-block;background:#facc15;color:#000;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;padding:6px 14px;border-radius:99px">
              Acesso antecipado
            </span>
          </div>
          <h1 style="font-size:26px;font-weight:600;letter-spacing:-0.04em;margin:0 0 16px">
            Você está na lista. 🎉
          </h1>
          <p style="font-size:15px;line-height:1.7;color:rgba(255,255,255,0.6);margin:0 0 24px">
            Obrigado por se inscrever no acesso antecipado ao MindDock.<br/>
            Assim que abrirmos vagas, você será um dos primeiros a saber.
          </p>
          <p style="font-size:13px;color:rgba(255,255,255,0.3);margin:0">
            — Time MindDock
          </p>
        </div>
      `
    })

    // Notification to owner
    if (NOTIFY_EMAIL) {
      await resend.emails.send({
        from: FROM,
        to: NOTIFY_EMAIL,
        subject: `[MindDock Waitlist] Novo cadastro: ${email}`,
        html: `<p>Novo email na waitlist: <strong>${email}</strong></p>`
      })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[Waitlist]", err)
    return NextResponse.json({ error: "Erro interno. Tente novamente." }, { status: 500 })
  }
}
