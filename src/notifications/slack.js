import config from "../config.js";
import logger from "../logger.js";

/**
 * Send a Slack notification via webhook.
 */
export async function notifySlack({ text, blocks }) {
  const url = config.slackWebhook;
  if (!url) {
    logger.warn("Slack webhook not configured, skipping notification");
    return;
  }

  try {
    const body = blocks ? { blocks } : { text };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      logger.error(`Slack notification failed: ${res.status}`);
    }
  } catch (err) {
    logger.error("Slack notification error", err);
  }
}

/**
 * Build a rich Slack message for a successful auto-fix PR.
 */
export function buildPRNotification({ error, pr, confidence }) {
  return {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🤖 Auto-Fix PR Created",
        },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Error:*\n${error.title}` },
          { type: "mrkdwn", text: `*Confidence:*\n${(confidence * 100).toFixed(0)}%` },
        ],
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `<${pr.links.html.href}|View Pull Request #${pr.id}>`,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Sentry Issue: <${error.url}|${error.issueId}>`,
          },
        ],
      },
    ],
  };
}

/**
 * Build a Slack message for when the agent skips / fails.
 */
export function buildSkipNotification({ error, reason }) {
  return {
    text: `⚠️ Auto-fix skipped for "${error.title}": ${reason}`,
  };
}
