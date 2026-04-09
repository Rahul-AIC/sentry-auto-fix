import express from "express";
import config from "./config.js";
import logger from "./logger.js";
import { verifySentrySignature } from "./sentry/verify.js";
import { handleSentryEvent } from "./pipeline/orchestrator.js";

const app = express();

// ── Raw body capture (needed for HMAC verification) ──
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);

// ── Health check ──
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// ── Sentry Webhook Endpoint ──
app.post("/webhook/sentry", verifySentrySignature, async (req, res) => {
  const resource = req.headers["sentry-hook-resource"]; // "event_alert", "issue", "metric_alert"

  logger.info(`Received Sentry webhook: resource=${resource}`);

  // Respond immediately so Sentry doesn't timeout
  res.status(202).json({ accepted: true });

  // Process asynchronously
  try {
    const result = await handleSentryEvent(req.body);
    logger.info("Pipeline result", result);
  } catch (err) {
    logger.error("Pipeline failed", err);
  }
});

// ── Bitbucket Webhook callback (for pipeline result notifications) ──
app.post("/webhook/bitbucket", express.json(), async (req, res) => {
  const eventKey = req.headers["x-event-key"];
  const payload = req.body;

  // Handle pipeline build status updates
  if (eventKey === "repo:commit_status_updated") {
    const branch = payload.commit_status?.refname || "";
    const state = payload.commit_status?.state; // "SUCCESSFUL", "FAILED", "INPROGRESS"

    if (branch.startsWith("fix/sentry-")) {
      logger.info(`Pipeline ${state} on branch ${branch}`);

      if (state === "SUCCESSFUL" && config.safeguards.autoMergeEnabled) {
        logger.info(`Auto-merge is enabled — PR on ${branch} passed pipeline`);
        // Auto-merge logic would go here if enabled
        // For safety, this is off by default.
      }

      if (state === "FAILED") {
        // Import dynamically to keep top-level clean
        const { notifySlack } = await import("./notifications/slack.js");
        await notifySlack({
          text: `❌ Pipeline failed on auto-fix branch \`${branch}\`. Manual review needed.`,
        });
      }
    }
  }

  res.json({ ok: true });
});

// ── Start ──
app.listen(config.port, () => {
  logger.info(`🚀 Sentry Auto-Fix Agent running on port ${config.port}`);
  logger.info(`   Environment: ${config.nodeEnv}`);
  logger.info(`   Repo: ${config.bitbucket.workspace}/${config.bitbucket.repoSlug}`);
  logger.info(`   Auto-merge: ${config.safeguards.autoMergeEnabled ? "ON" : "OFF"}`);
  logger.info(`   Confidence threshold: ${config.safeguards.confidenceThreshold}`);
});

export default app;
