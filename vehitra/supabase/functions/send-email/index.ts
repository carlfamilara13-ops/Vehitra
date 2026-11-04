/**
 * send-email — Supabase Send Email Auth Hook
 *
 * Receives the official Supabase "Send Email" hook payload, verifies the
 * webhook signature with standardwebhooks, builds a confirmation link that
 * preserves the existing vehitra://login-callback deep-link behaviour, and
 * delivers the message through Brevo's transactional email REST API.
 *
 * Deploy:
 *   supabase functions deploy send-email --no-verify-jwt --project-ref wklfjnoxglngpvphnezt
 *
 * Required secrets (set via `supabase secrets set` or the Dashboard):
 *   SEND_EMAIL_HOOK_SECRET   — from Auth → Hooks → Send Email; full "v1,whsec_…" string
 *                               (the "v1,whsec_" prefix is stripped before use)
 *   BREVO_API_KEY            — Brevo account API key
 *   BREVO_SENDER_EMAIL       — verified sender address in Brevo
 *   BREVO_SENDER_NAME        — display name for the sender
 */

import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Payload delivered by Supabase for every Send Email hook invocation. */
interface HookPayload {
  user: {
    id: string;
    email: string;
    new_email?: string;
  };
  email_data: {
    /** The action that triggered this email. */
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type:
      | "signup"
      | "recovery"
      | "invite"
      | "magiclink"
      | "email_change"
      | "email_change_new";
    site_url: string;
    token_new?: string;
    token_hash_new?: string;
  };
}

interface BrevoEmailPayload {
  sender: { name: string; email: string };
  to: Array<{ email: string }>;
  subject: string;
  htmlContent: string;
}

// ---------------------------------------------------------------------------
// Email content builders
// ---------------------------------------------------------------------------

/**
 * Build the Supabase verification URL.
 * Uses token_hash (not the raw OTP token) so the app's verifyEmailOtp()
 * call — which passes token_hash to supabase.auth.verifyOtp() — works
 * without any changes.
 */
function buildVerifyUrl(
  siteUrl: string,
  tokenHash: string,
  type: string,
  redirectTo: string,
): string {
  const base = siteUrl.replace(/\/$/, "");
  const params = new URLSearchParams({
    token_hash: tokenHash,
    type,
    redirect_to: redirectTo,
  });
  return `${base}/auth/v1/verify?${params.toString()}`;
}

interface EmailContent {
  subject: string;
  html: string;
}

function buildEmailContent(
  payload: HookPayload,
  senderName: string,
): EmailContent {
  const { email_data, user } = payload;
  const {
    email_action_type,
    token_hash,
    token_hash_new,
    redirect_to,
    site_url,
  } = email_data;

  switch (email_action_type) {
    case "signup": {
      const link = buildVerifyUrl(site_url, token_hash, "signup", redirect_to);
      return {
        subject: "Confirm your Vehitra account",
        html: confirmationHtml(link, senderName),
      };
    }

    case "recovery": {
      const link = buildVerifyUrl(site_url, token_hash, "recovery", redirect_to);
      return {
        subject: "Reset your Vehitra password",
        html: recoveryHtml(link, senderName),
      };
    }

    case "invite": {
      const link = buildVerifyUrl(site_url, token_hash, "invite", redirect_to);
      return {
        subject: "You've been invited to Vehitra",
        html: inviteHtml(link, senderName),
      };
    }

    case "magiclink": {
      const link = buildVerifyUrl(site_url, token_hash, "magiclink", redirect_to);
      return {
        subject: "Your Vehitra sign-in link",
        html: magiclinkHtml(link, senderName),
      };
    }

    case "email_change": {
      // Secure Email Change disabled: single confirmation to the current address.
      // token_hash verifies the current address; type must be "email_change".
      const link = buildVerifyUrl(site_url, token_hash, "email_change", redirect_to);
      return {
        subject: "Confirm your Vehitra email change",
        html: emailChangeCurrentHtml(link, user.email, senderName),
      };
    }

    case "email_change_new": {
      // Secure Email Change enabled: second confirmation sent to the new address.
      // token_hash_new verifies the new address; fall back to token_hash if absent.
      const hash = token_hash_new ?? token_hash;
      const link = buildVerifyUrl(site_url, hash, "email_change_new", redirect_to);
      return {
        subject: "Confirm your new Vehitra email address",
        html: emailChangeHtml(link, user.new_email ?? user.email, senderName),
      };
    }

    default: {
      // Unknown future action type — send a safe generic link.
      const link = buildVerifyUrl(
        site_url,
        token_hash,
        email_action_type,
        redirect_to,
      );
      return {
        subject: "Action required for your Vehitra account",
        html: genericHtml(link, senderName),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// HTML templates — minimal, inline-styled for email client compatibility.
// These preserve the same confirmation-link behaviour the app already handles.
// ---------------------------------------------------------------------------

const BRAND_COLOR = "#2563EB";
const FONT = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif";

function wrapper(body: string, senderName: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;${FONT}">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:8px;overflow:hidden">
        <tr><td style="background:${BRAND_COLOR};padding:24px 32px">
          <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.5px">Vehitra</span>
        </td></tr>
        <tr><td style="padding:32px">${body}</td></tr>
        <tr><td style="padding:16px 32px 24px;border-top:1px solid #e5e7eb">
          <p style="margin:0;font-size:12px;color:#9ca3af;text-align:center">
            Sent by ${escHtml(senderName)} · If you did not request this, you can safely ignore it.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function ctaButton(href: string, label: string): string {
  return `<p style="margin:24px 0 0">
    <a href="${escHtml(href)}" style="display:inline-block;background:${BRAND_COLOR};color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:15px;font-weight:600">${label}</a>
  </p>
  <p style="margin:16px 0 0;font-size:12px;color:#6b7280">
    Or copy this link into your browser:<br>
    <span style="word-break:break-all;color:#374151">${escHtml(href)}</span>
  </p>`;
}

function h1(text: string): string {
  return `<h1 style="margin:0 0 12px;font-size:20px;font-weight:700;color:#111827">${escHtml(text)}</h1>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 8px;font-size:15px;color:#374151;line-height:1.6">${text}</p>`;
}

function confirmationHtml(link: string, senderName: string): string {
  return wrapper(
    h1("Confirm your email address") +
      p("Thanks for signing up for Vehitra. Tap the button below to confirm your email address and activate your account.") +
      ctaButton(link, "Confirm email address") +
      p("This link expires in 24 hours."),
    senderName,
  );
}

function recoveryHtml(link: string, senderName: string): string {
  return wrapper(
    h1("Reset your password") +
      p("We received a request to reset the password for your Vehitra account. Tap the button below to choose a new password.") +
      ctaButton(link, "Reset password") +
      p("This link expires in 1 hour. If you did not request a password reset, no action is needed."),
    senderName,
  );
}

function inviteHtml(link: string, senderName: string): string {
  return wrapper(
    h1("You've been invited to Vehitra") +
      p("You have been invited to create a Vehitra account. Tap the button below to accept the invitation and set your password.") +
      ctaButton(link, "Accept invitation") +
      p("This invitation link expires in 24 hours."),
    senderName,
  );
}

function magiclinkHtml(link: string, senderName: string): string {
  return wrapper(
    h1("Your sign-in link") +
      p("Tap the button below to sign in to your Vehitra account. This link can only be used once.") +
      ctaButton(link, "Sign in to Vehitra") +
      p("This link expires in 1 hour."),
    senderName,
  );
}

function emailChangeHtml(
  link: string,
  newEmail: string,
  senderName: string,
): string {
  return wrapper(
    h1("Confirm your new email address") +
      p(`Tap the button below to confirm <strong>${escHtml(newEmail)}</strong> as your new Vehitra email address.`) +
      ctaButton(link, "Confirm new email address") +
      p("This link expires in 24 hours. Your email address will not change until both confirmation links are clicked."),
    senderName,
  );
}

function emailChangeCurrentHtml(
  link: string,
  currentEmail: string,
  senderName: string,
): string {
  return wrapper(
    h1("Confirm your email change") +
      p(`A request was made to change the email address on your Vehitra account away from <strong>${escHtml(currentEmail)}</strong>. Tap the button below to authorise this change.`) +
      ctaButton(link, "Authorise email change") +
      p("If you did not request this change, tap the link and then cancel immediately."),
    senderName,
  );
}

function genericHtml(link: string, senderName: string): string {
  return wrapper(
    h1("Action required for your Vehitra account") +
      p("Tap the button below to complete the requested action on your Vehitra account.") +
      ctaButton(link, "Continue"),
    senderName,
  );
}

/** Strip newlines and carriage returns from a string before writing it to a log. */
function sanitizeLog(s: string): string {
  return s.replace(/[\r\n]/g, " ");
}

/** Minimal HTML entity escaping for values interpolated into HTML. */
function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Brevo delivery
// ---------------------------------------------------------------------------

async function sendViaBrevo(
  apiKey: string,
  emailPayload: BrevoEmailPayload,
): Promise<void> {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(emailPayload),
  });

  if (!res.ok) {
    // Surface the Brevo error message without leaking the API key.
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json() as { message?: string; code?: string };
      if (body.message) detail = `${detail} — ${body.message}`;
      if (body.code) detail = `${detail} (${body.code})`;
    } catch {
      // Response body was not JSON; keep the status-only message.
    }
    throw new Error(`Brevo delivery failed: ${detail}`);
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request): Promise<Response> => {
  // Supabase hooks always use POST.
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // --- Read required secrets ---
  // Trim every value: a trailing newline or carriage return introduced during
  // secret storage (e.g. shell $() expansion, copy-paste) would otherwise
  // corrupt the base64 decode of SEND_EMAIL_HOOK_SECRET or be rejected by
  // Deno's fetch header validation when BREVO_API_KEY is used as a header value.
  const hookSecret = Deno.env.get("SEND_EMAIL_HOOK_SECRET")?.trim();
  const brevoApiKey = Deno.env.get("BREVO_API_KEY")?.trim();
  const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL")?.trim();
  const senderName = (Deno.env.get("BREVO_SENDER_NAME")?.trim()) ?? "Vehitra";

  if (!hookSecret || !brevoApiKey || !senderEmail) {
    console.error(
      "send-email: missing required secret(s). " +
        "Ensure SEND_EMAIL_HOOK_SECRET, BREVO_API_KEY, and BREVO_SENDER_EMAIL are set.",
    );
    return new Response(
      JSON.stringify({ error: "Server configuration error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  // --- Diagnose BREVO_API_KEY for internal control characters ---
  // .trim() only removes leading/trailing whitespace. A \r, \n, or \0 embedded
  // in the middle of the stored value survives trim and causes Deno's fetch to
  // throw "failed to parse header value" when the key is used as a header.
  const apiKeyHasCR = brevoApiKey.includes("\r");
  const apiKeyHasLF = brevoApiKey.includes("\n");
  const apiKeyHasNull = brevoApiKey.includes("\0");
  const apiKeyHasControlChars = apiKeyHasCR || apiKeyHasLF || apiKeyHasNull;
  console.log(
    `send-email: BREVO_API_KEY present=true length=${brevoApiKey.length}` +
      ` hasCR=${apiKeyHasCR} hasLF=${apiKeyHasLF} hasNull=${apiKeyHasNull}`,
  );
  if (apiKeyHasControlChars) {
    console.error(
      "send-email: BREVO_API_KEY contains internal control characters (\\r, \\n, or \\0). " +
        "Re-set the secret in the Supabase Dashboard, ensuring no embedded newlines.",
    );
    return new Response(
      JSON.stringify({ error: "Server configuration error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  // --- Read and verify the webhook signature ---
  const rawBody = await req.text();

  // The Dashboard issues the secret as "v1,whsec_<base64>". The Webhook
  // constructor's built-in prefix stripping only removes "whsec_", leaving
  // "v1," prepended to the base64 string, which breaks decoding. Strip the
  // full "v1,whsec_" prefix explicitly, matching the official Supabase example.
  const base64Secret = hookSecret.replace("v1,whsec_", "");
  const wh = new Webhook(base64Secret);
  try {
    wh.verify(rawBody, Object.fromEntries(req.headers.entries()));
  } catch (err) {
    // Log the class of error only — never log the secret or the raw body.
    console.warn(
      "send-email: webhook signature verification failed —",
      err instanceof Error ? err.message : String(err),
    );
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  // --- Parse payload ---
  let payload: HookPayload;
  try {
    payload = JSON.parse(rawBody) as HookPayload;
  } catch {
    console.error("send-email: payload is not valid JSON");
    return new Response(
      JSON.stringify({ error: "Bad request" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const { user, email_data } = payload;

  // Determine the recipient:
  // email_change_new sends to the new address; all other types send to user.email.
  const recipientEmail =
    email_data.email_action_type === "email_change_new" && user.new_email
      ? user.new_email
      : user.email;

  // Safe log — action type and masked recipient only, never tokens or keys.
  const maskedRecipient = sanitizeLog(
    recipientEmail.replace(/^(.{2}).*(@.*)$/, "$1***$2"),
  );
  const safeActionType = sanitizeLog(email_data.email_action_type);
  console.log(`send-email: action=${safeActionType} to=${maskedRecipient}`);

  // --- Build email content ---
  const { subject, html } = buildEmailContent(payload, senderName);

  // --- Send via Brevo ---
  try {
    await sendViaBrevo(brevoApiKey, {
      sender: { name: senderName, email: senderEmail },
      to: [{ email: recipientEmail }],
      subject,
      htmlContent: html,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("send-email: delivery error —", message);
    // Return a non-2xx so Supabase knows the hook failed and can retry.
    return new Response(
      JSON.stringify({ error: message }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }

  console.log(`send-email: delivered action=${safeActionType} to=${maskedRecipient}`);

  // Supabase expects an empty 200 on success.
  return new Response(null, { status: 200 });
});
