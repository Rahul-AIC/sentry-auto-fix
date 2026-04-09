import logger from "../logger.js";

/**
 * Parses a Sentry webhook payload and extracts structured error info.
 *
 * Sentry sends different shapes depending on the alert rule type.
 * We handle both "issue alerts" and "metric alerts / event payloads".
 */
export function parseSentryPayload(payload) {
  try {
    const action = payload.action;      // "triggered", "created", etc.
    const data = payload.data || {};
    const event = data.event || {};
    const issue = data.issue || {};

    // ── Basic error info ──
    const errorInfo = {
      issueId: issue.id || event.event_id || "unknown",
      title: issue.title || event.title || "Unknown error",
      culprit: issue.culprit || event.culprit || "",
      message: extractMessage(event),
      level: issue.level || event.level || "error",
      platform: issue.platform || event.platform || "dart",
      firstSeen: issue.firstSeen,
      url: issue.permalink || "",
    };

    // ── Stack trace extraction ──
    const frames = extractStackFrames(event);

    // ── Tags & context ──
    const tags = {};
    for (const tag of event.tags || []) {
      tags[tag.key || tag[0]] = tag.value || tag[1];
    }

    const result = {
      action,
      error: errorInfo,
      frames,
      tags,
      raw: payload,
    };

    logger.info(`Parsed Sentry event: ${errorInfo.title}`, {
      issueId: errorInfo.issueId,
      frameCount: frames.length,
    });

    return result;
  } catch (err) {
    logger.error("Failed to parse Sentry payload", err);
    throw err;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────

function extractMessage(event) {
  if (event.message) return event.message;
  if (event.logentry?.formatted) return event.logentry.formatted;
  if (event.metadata?.value) return event.metadata.value;

  // For exception-based events
  const exc = event.exception?.values?.[0];
  if (exc) return `${exc.type}: ${exc.value}`;

  return "No message available";
}

function extractStackFrames(event) {
  const frames = [];

  // Exception stack traces
  const exceptions = event.exception?.values || [];
  for (const exc of exceptions) {
    const rawFrames = exc.stacktrace?.frames || [];
    for (const f of rawFrames) {
      if (isAppFrame(f)) {
        frames.push(normalizeFrame(f));
      }
    }
  }

  // Thread stack traces (less common for Flutter)
  const threads = event.threads?.values || [];
  for (const thread of threads) {
    if (!thread.crashed) continue;
    const rawFrames = thread.stacktrace?.frames || [];
    for (const f of rawFrames) {
      if (isAppFrame(f)) {
        frames.push(normalizeFrame(f));
      }
    }
  }

  // Sentry puts the MOST relevant frame last in its array.
  // Reverse so the crash point is first.
  return frames.reverse();
}

/**
 * Returns true if the frame belongs to the user's app code
 * (not a Flutter SDK or dart:core frame).
 */
function isAppFrame(frame) {
  if (frame.in_app === true) return true;
  if (frame.in_app === false) return false;

  const filename = frame.filename || frame.abs_path || "";
  // Skip SDK / internal frames
  if (filename.startsWith("dart:")) return false;
  if (filename.includes("flutter/")) return false;
  if (filename.includes("packages/flutter")) return false;
  if (filename.includes("package:flutter/")) return false;

  return true;
}

function normalizeFrame(frame) {
  return {
    filename: frame.filename || frame.abs_path || "",
    function: frame.function || "unknown",
    lineNo: frame.lineno || 0,
    colNo: frame.colno || 0,
    context: frame.context_line || "",
    preContext: frame.pre_context || [],
    postContext: frame.post_context || [],
    module: frame.module || "",
  };
}
