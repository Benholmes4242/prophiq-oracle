// Transactional email helper. Wraps Resend's HTTP API. Best-effort: never
// throws, returns false on failure so webhook handlers don't break when
// Resend is down or RESEND_API_KEY is not yet configured.

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
}

export async function sendEmail({
  to,
  subject,
  html,
  replyTo = "support@prophiq.io",
}: SendEmailOptions): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set, skipping email send");
    return false;
  }

  const from = Deno.env.get("EMAIL_FROM") ?? "Prophiq <noreply@prophiq.io>";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject,
        html,
        reply_to: replyTo,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "<no body>");
      console.warn(`[email] Resend returned ${res.status}: ${text}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[email] sendEmail threw: ${(err as Error).message}`);
    return false;
  }
}
