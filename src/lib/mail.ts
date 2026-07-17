// Transactional email via SMTP (nodemailer). v1 sends exactly one message type:
// the invite email. Sending NEVER throws — callers always get a structured result
// so they can fall back to surfacing a copyable invite link when SMTP is down or
// unconfigured (common in local dev).

import nodemailer, { type Transporter } from "nodemailer";

let cachedTransport: Transporter | null = null;

function getTransport(): Transporter | null {
  const host = process.env.SMTP_HOST;
  if (!host) return null; // SMTP not configured — caller shows the link instead.
  if (cachedTransport) return cachedTransport;

  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  cachedTransport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // implicit TLS on 465; STARTTLS on 587/25
    auth: user ? { user, pass } : undefined,
  });
  return cachedTransport;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface SendInviteEmailParams {
  to: string;
  inviteUrl: string;
  invitedByName: string;
}

export interface SendResult {
  sent: boolean;
  /** Present when not sent because SMTP is unconfigured. */
  reason?: string;
  /** Present when a send was attempted but failed. */
  error?: string;
}

// Email context is standalone HTML with no access to the app's CSS tokens, so the
// Flux brand orange (#FF6B35) is inlined here by design — this is the one place a
// raw hex is acceptable.
function buildInviteHtml({ inviteUrl, invitedByName }: SendInviteEmailParams): string {
  const who = escapeHtml(invitedByName);
  const url = escapeHtml(inviteUrl);
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0a0a0a;font-family:'Outfit',Arial,Helvetica,sans-serif;color:#f5f5f7;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#141414;border:1px solid #2a2a2a;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 8px 32px;">
                <div style="font-size:22px;font-weight:700;color:#f5f5f7;">Flux<span style="color:#ff6b35;">.</span></div>
                <h1 style="font-size:20px;font-weight:600;margin:20px 0 8px 0;color:#f5f5f7;">You've been invited</h1>
                <p style="font-size:15px;line-height:1.6;color:#9a9a9a;margin:0 0 24px 0;">
                  ${who} has invited you to join Flux, the Foodverse task &amp; project workspace.
                  Set up your account to get started.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 8px 32px;">
                <a href="${url}" style="display:inline-block;background:#ff6b35;color:#0a0a0a;font-weight:600;font-size:15px;text-decoration:none;padding:12px 24px;border-radius:10px;">
                  Accept invite
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 32px 32px;">
                <p style="font-size:12px;line-height:1.6;color:#9a9a9a;margin:0;">
                  Or paste this link into your browser:<br />
                  <span style="color:#5b8def;word-break:break-all;">${url}</span>
                </p>
                <p style="font-size:12px;color:#6a6a6a;margin:16px 0 0 0;">
                  If you weren't expecting this invite, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildInviteText({ inviteUrl, invitedByName }: SendInviteEmailParams): string {
  return [
    `${invitedByName} has invited you to join Flux, the Foodverse task & project workspace.`,
    "",
    "Accept your invite:",
    inviteUrl,
    "",
    "If you weren't expecting this invite, you can safely ignore this email.",
  ].join("\n");
}

export interface SendTaskAssignedEmailParams {
  to: string;
  taskKey: string;
  taskTitle: string;
  projectName: string;
  assignedByName: string;
  taskUrl: string;
}

function buildTaskAssignedHtml({
  taskKey,
  taskTitle,
  projectName,
  assignedByName,
  taskUrl,
}: SendTaskAssignedEmailParams): string {
  const key = escapeHtml(taskKey);
  const title = escapeHtml(taskTitle);
  const project = escapeHtml(projectName);
  const who = escapeHtml(assignedByName);
  const url = escapeHtml(taskUrl);
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0a0a0a;font-family:'Outfit',Arial,Helvetica,sans-serif;color:#f5f5f7;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#141414;border:1px solid #2a2a2a;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 8px 32px;">
                <div style="font-size:22px;font-weight:700;color:#f5f5f7;">Flux<span style="color:#ff6b35;">.</span></div>
                <h1 style="font-size:20px;font-weight:600;margin:20px 0 8px 0;color:#f5f5f7;">A task was assigned to you</h1>
                <p style="font-size:15px;line-height:1.6;color:#9a9a9a;margin:0 0 20px 0;">
                  ${who} assigned you a task in <strong style="color:#f5f5f7;">${project}</strong>.
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1f1f1f;border:1px solid #2a2a2a;border-radius:10px;">
                  <tr>
                    <td style="padding:14px 16px;">
                      <div style="font-family:Menlo,Consolas,monospace;font-size:12px;color:#9a9a9a;margin-bottom:4px;">${key}</div>
                      <div style="font-size:15px;font-weight:600;color:#f5f5f7;">${title}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 8px 32px;">
                <a href="${url}" style="display:inline-block;background:#ff6b35;color:#0a0a0a;font-weight:600;font-size:15px;text-decoration:none;padding:12px 24px;border-radius:10px;">
                  Open task
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 32px 32px;">
                <p style="font-size:12px;line-height:1.6;color:#9a9a9a;margin:0;">
                  Or paste this link into your browser:<br />
                  <span style="color:#5b8def;word-break:break-all;">${url}</span>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildTaskAssignedText({
  taskKey,
  taskTitle,
  projectName,
  assignedByName,
  taskUrl,
}: SendTaskAssignedEmailParams): string {
  return [
    `${assignedByName} assigned you a task in ${projectName}:`,
    "",
    `${taskKey} — ${taskTitle}`,
    "",
    "Open it:",
    taskUrl,
  ].join("\n");
}

/**
 * Send a "task assigned to you" notification. Same contract as
 * sendInviteEmail — never throws; unconfigured SMTP just logs the intent.
 */
export async function sendTaskAssignedEmail(
  params: SendTaskAssignedEmailParams,
): Promise<SendResult> {
  const transport = getTransport();

  if (!transport) {
    console.info(
      `[mail] SMTP not configured — task-assigned mail for ${params.to}: ${params.taskKey}`,
    );
    return { sent: false, reason: "smtp-unconfigured" };
  }

  const from = process.env.SMTP_FROM ?? "Flux <no-reply@foodverse.io>";

  try {
    await transport.sendMail({
      from,
      to: params.to,
      subject: `[${params.taskKey}] ${params.taskTitle} — assigned to you`,
      text: buildTaskAssignedText(params),
      html: buildTaskAssignedHtml(params),
    });
    return { sent: true };
  } catch (err) {
    console.error("[mail] task-assigned send failed", err);
    return {
      sent: false,
      error: err instanceof Error ? err.message : "unknown-error",
    };
  }
}

export interface SendMentionEmailParams {
  to: string;
  taskKey: string;
  taskTitle: string;
  projectName: string;
  mentionedByName: string;
  taskUrl: string;
}

function buildMentionHtml({
  taskKey,
  taskTitle,
  projectName,
  mentionedByName,
  taskUrl,
}: SendMentionEmailParams): string {
  const key = escapeHtml(taskKey);
  const title = escapeHtml(taskTitle);
  const project = escapeHtml(projectName);
  const who = escapeHtml(mentionedByName);
  const url = escapeHtml(taskUrl);
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0a0a0a;font-family:'Outfit',Arial,Helvetica,sans-serif;color:#f5f5f7;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#141414;border:1px solid #2a2a2a;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:32px 32px 8px 32px;">
                <div style="font-size:22px;font-weight:700;color:#f5f5f7;">Flux<span style="color:#ff6b35;">.</span></div>
                <h1 style="font-size:20px;font-weight:600;margin:20px 0 8px 0;color:#f5f5f7;">${who} mentioned you</h1>
                <p style="font-size:15px;line-height:1.6;color:#9a9a9a;margin:0 0 20px 0;">
                  You were mentioned in a comment on <strong style="color:#f5f5f7;">${project}</strong>.
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#1f1f1f;border:1px solid #2a2a2a;border-radius:10px;">
                  <tr>
                    <td style="padding:14px 16px;">
                      <div style="font-family:Menlo,Consolas,monospace;font-size:12px;color:#9a9a9a;margin-bottom:4px;">${key}</div>
                      <div style="font-size:15px;font-weight:600;color:#f5f5f7;">${title}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 32px 32px 32px;">
                <a href="${url}" style="display:inline-block;background:#ff6b35;color:#0a0a0a;font-weight:600;font-size:15px;text-decoration:none;padding:12px 24px;border-radius:10px;">
                  View comment
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildMentionText({
  taskKey,
  taskTitle,
  projectName,
  mentionedByName,
  taskUrl,
}: SendMentionEmailParams): string {
  return [
    `${mentionedByName} mentioned you in a comment on ${projectName}:`,
    "",
    `${taskKey} — ${taskTitle}`,
    "",
    "View it:",
    taskUrl,
  ].join("\n");
}

/** "You were mentioned" notification. Same never-throw contract as the rest. */
export async function sendMentionEmail(
  params: SendMentionEmailParams,
): Promise<SendResult> {
  const transport = getTransport();
  if (!transport) {
    console.info(
      `[mail] SMTP not configured — mention mail for ${params.to}: ${params.taskKey}`,
    );
    return { sent: false, reason: "smtp-unconfigured" };
  }
  const from = process.env.SMTP_FROM ?? "Flux <no-reply@foodverse.io>";
  try {
    await transport.sendMail({
      from,
      to: params.to,
      subject: `${params.mentionedByName} mentioned you — [${params.taskKey}] ${params.taskTitle}`,
      text: buildMentionText(params),
      html: buildMentionHtml(params),
    });
    return { sent: true };
  } catch (err) {
    console.error("[mail] mention send failed", err);
    return {
      sent: false,
      error: err instanceof Error ? err.message : "unknown-error",
    };
  }
}

/**
 * Send an invite email. Returns:
 *   { sent: true }                                    — delivered to SMTP
 *   { sent: false, reason: "smtp-unconfigured" }      — no SMTP_HOST; link logged
 *   { sent: false, error }                            — attempted, transport failed
 * Never throws.
 */
export async function sendInviteEmail(
  params: SendInviteEmailParams,
): Promise<SendResult> {
  const transport = getTransport();

  if (!transport) {
    // Dev / unconfigured: surface the link so onboarding still works.
    console.info(
      `[mail] SMTP not configured — invite link for ${params.to}: ${params.inviteUrl}`,
    );
    return { sent: false, reason: "smtp-unconfigured" };
  }

  const from = process.env.SMTP_FROM ?? "Flux <no-reply@foodverse.io>";

  try {
    await transport.sendMail({
      from,
      to: params.to,
      subject: "You've been invited to Flux",
      text: buildInviteText(params),
      html: buildInviteHtml(params),
    });
    return { sent: true };
  } catch (err) {
    console.error("[mail] invite send failed", err);
    return {
      sent: false,
      error: err instanceof Error ? err.message : "unknown-error",
    };
  }
}
