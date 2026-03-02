/**
 * Instantly API v2 - add first-time signups as leads and assign to campaign.
 * Only called on first-time login (new account); does not block auth response.
 * @see https://developer.instantly.ai/api/v2
 */

import { env } from '../config/env';
import { logger } from '../config/logger';

const INSTANTLY_BASE = 'https://api.instantly.ai';

export interface AddLeadOptions {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}

/**
 * Resolve Signups campaign ID: use env if set, else GET /api/v2/campaigns and find by name "Signups".
 */
async function getSignupsCampaignId(): Promise<string | null> {
  const configured = env.instantly.signupsCampaignId?.trim();
  if (configured) return configured;

  const apiKey = env.instantly.apiKey?.trim();
  if (!apiKey) return null;

  try {
    const res = await fetch(
      `${INSTANTLY_BASE}/api/v2/campaigns?limit=100&status=0`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );
    if (!res.ok) {
      logger.warn(`Instantly list campaigns failed: ${res.status} ${res.statusText}`);
      return null;
    }
    const data = (await res.json()) as { name?: string; id?: string }[];
    const signups = Array.isArray(data) ? data.find((c) => c.name === 'Signups') : undefined;
    return signups?.id ?? null;
  } catch (e) {
    logger.warn('Instantly fetch campaigns error:', e);
    return null;
  }
}

/**
 * Add a lead to the Signups campaign (first-time login only).
 * No-op if INSTANTLY_API_KEY is not set. Does not throw; logs errors.
 */
export async function addLeadToSignupsCampaign(options: AddLeadOptions): Promise<void> {
  const apiKey = env.instantly.apiKey?.trim();
  if (!apiKey) {
    logger.debug('Instantly: API key not set, skipping add lead');
    return;
  }

  const { email, firstName, lastName } = options;
  const trimmedEmail = email?.trim();
  if (!trimmedEmail) {
    logger.warn('Instantly: cannot add lead without email');
    return;
  }

  let campaignId = env.instantly.signupsCampaignId?.trim() || null;
  if (!campaignId) {
    campaignId = await getSignupsCampaignId();
    if (!campaignId) {
      logger.warn('Instantly: could not resolve Signups campaign id');
      return;
    }
  }

  try {
    const body: Record<string, unknown> = {
      campaign: campaignId,
      email: trimmedEmail,
      skip_if_in_campaign: true,
    };
    if (firstName != null && String(firstName).trim()) body.first_name = String(firstName).trim();
    if (lastName != null && String(lastName).trim()) body.last_name = String(lastName).trim();

    const res = await fetch(`${INSTANTLY_BASE}/api/v2/leads`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      logger.info(`Instantly: lead added to Signups campaign for ${trimmedEmail}`);
      return;
    }

    const text = await res.text();
    logger.warn(`Instantly add lead failed: ${res.status} ${res.statusText} - ${text}`);
  } catch (e) {
    logger.warn('Instantly add lead error:', e);
  }
}
