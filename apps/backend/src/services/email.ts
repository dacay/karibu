import * as postmark from 'postmark';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Build a frontend URL scoped to a specific organization subdomain.
 *
 * Replaces the `{subdomain}` placeholder in FRONTEND_URL_TEMPLATE with the
 * given subdomain.  If the template has no placeholder (e.g. localhost in dev)
 * the subdomain is simply ignored.
 *
 * Examples:
 *   template "https://{subdomain}.karibu.ai", subdomain "demo"
 *     → "https://demo.karibu.ai/?token=abc"
 *   template "http://localhost:3001" (no placeholder)
 *     → "http://localhost:3001/?token=abc"
 */
export const buildOrgUrl = (
  subdomain: string,
  path: string = '/',
  params?: Record<string, string>
): string => {
  const base = new URL(
    path,
    env.FRONTEND_URL_TEMPLATE.replace('{subdomain}', subdomain)
  );

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      base.searchParams.set(key, value);
    }
  }

  return base.toString();
};

/**
 * Send a transactional email via the Postmark API.
 * Throws if POSTMARK_API_KEY is not configured.
 */
export const sendEmail = async (options: {
  to: string;
  subject: string;
  htmlBody: string;
  textBody: string;
}): Promise<void> => {
  if (!env.POSTMARK_API_KEY) {
    throw new Error('POSTMARK_API_KEY is not configured');
  }

  const client = new postmark.ServerClient(env.POSTMARK_API_KEY);

  const response = await client.sendEmail({
    From: env.POSTMARK_FROM,
    To: options.to,
    Subject: options.subject,
    HtmlBody: options.htmlBody,
    TextBody: options.textBody,
    MessageStream: 'outbound',
  });

  logger.debug({ messageId: response.MessageID, to: options.to }, 'Email sent successfully.');
};

/**
 * Send an invitation email to a new team member.
 * The sign-in link is built from FRONTEND_URL_TEMPLATE with the org subdomain
 * substituted in, so it cannot be reused on a different organization's domain.
 */
export const sendInvitationEmail = async (options: {
  to: string;
  organizationName: string;
  subdomain: string;
  token: string;
}): Promise<void> => {
  const signInUrl = buildOrgUrl(options.subdomain, '/', { token: options.token });

  await sendEmail({
    to: options.to,
    subject: `You have been invited to ${options.organizationName}`,
    htmlBody: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h2 style="margin: 0 0 16px;">You have been invited to ${options.organizationName}</h2>
        <p style="margin: 0 0 24px; color: #555;">
          Click the button below to sign in. This link is personal to you — do not share it.
        </p>
        <a href="${signInUrl}"
           style="display: inline-block; padding: 12px 24px; background: #000; color: #fff;
                  text-decoration: none; border-radius: 6px; font-weight: 600;">
          Sign in to ${options.organizationName}
        </a>
        <p style="margin: 24px 0 0; font-size: 12px; color: #999;">
          If the button does not work, copy and paste this link into your browser:<br>
          <a href="${signInUrl}" style="color: #999;">${signInUrl}</a>
        </p>
      </div>
    `.trim(),
    textBody: [
      `You have been invited to ${options.organizationName}.`,
      '',
      `Sign in here: ${signInUrl}`,
      '',
      'Do not share this link.',
    ].join('\n'),
  });

  logger.info({ to: options.to }, 'Invitation email sent.');
};
