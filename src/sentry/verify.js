import crypto from "crypto";
import config from "../config.js";

/**
 * Express middleware to verify Sentry webhook HMAC signature.
 * Sentry signs payloads with the secret configured in the webhook settings.
 */
export function verifySentrySignature(req, res, next) {
  const secret = config.sentry.webhookSecret;
  if (!secret) {
    // Skip verification in dev if no secret configured
    return next();
  }

  const signature = req.headers["sentry-hook-signature"];
  if (!signature) {
    return res.status(401).json({ error: "Missing Sentry signature header" });
  }

  const hmac = crypto
    .createHmac("sha256", secret)
    .update(req.rawBody || JSON.stringify(req.body))
    .digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature))) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  next();
}
