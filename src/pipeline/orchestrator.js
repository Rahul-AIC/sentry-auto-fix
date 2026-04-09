import { parseSentryPayload } from "../sentry/parser.js";
import { proposeCodeFix } from "../ai/agent.js";
import {
  getMultipleFiles,
  createBranch,
  commitFiles,
  createPullRequest,
  branchExists,
} from "../bitbucket/service.js";
import {
  notifySlack,
  buildPRNotification,
  buildSkipNotification,
} from "../notifications/slack.js";
import config from "../config.js";
import logger from "../logger.js";

// Track processed issues in memory (use Redis/DB in production)
const processedIssues = new Set();

/**
 * Main pipeline: receives raw Sentry webhook → outputs a GitHub PR.
 */
export async function handleSentryEvent(payload) {
  // ── 1. Parse ──────────────────────────────────────────────────
  const parsed = parseSentryPayload(payload);
  const { error, frames } = parsed;

  // ── 2. Deduplication guard ────────────────────────────────────
  if (processedIssues.has(error.issueId)) {
    logger.info(`Skipping already-processed issue ${error.issueId}`);
    return { status: "skipped", reason: "already_processed" };
  }
  processedIssues.add(error.issueId);

  // Evict old entries to prevent memory leak
  if (processedIssues.size > 10000) {
    const first = processedIssues.values().next().value;
    processedIssues.delete(first);
  }

  // ── 3. Check if we already created a branch for this issue ───
  const branchName = `fix/sentry-${error.issueId}`;
  if (await branchExists(branchName)) {
    logger.info(`Branch ${branchName} already exists, skipping`);
    return { status: "skipped", reason: "branch_exists" };
  }

  // ── 4. Resolve file paths ────────────────────────────────────
  if (frames.length === 0) {
    const reason = "No app-level stack frames found";
    logger.warn(reason);
    await notifySlack(buildSkipNotification({ error, reason }));
    return { status: "skipped", reason };
  }

  const filePaths = resolveFilePaths(frames);

  if (filePaths.length === 0) {
    const reason = "Could not map stack frames to repo files";
    logger.warn(reason);
    await notifySlack(buildSkipNotification({ error, reason }));
    return { status: "skipped", reason };
  }

  // Cap the number of files
  const cappedPaths = filePaths.slice(0, config.safeguards.maxFilesPerFix);

  // ── 5. Fetch source files from GitHub ────────────────────────
  const fileContents = await getMultipleFiles(cappedPaths);

  if (fileContents.size === 0) {
    const reason = "None of the implicated files exist in the repo";
    logger.warn(reason);
    await notifySlack(buildSkipNotification({ error, reason }));
    return { status: "skipped", reason };
  }

  // ── 6. Ask AI for a fix ──────────────────────────────────────
  logger.info("Requesting AI fix proposal...");
  const proposal = await proposeCodeFix({ error, frames, fileContents });

  if (proposal.fixes.length === 0) {
    const reason = `AI could not propose a fix: ${proposal.explanation}`;
    logger.warn(reason);
    await notifySlack(buildSkipNotification({ error, reason }));
    return { status: "skipped", reason };
  }

  // ── 7. Confidence gate ───────────────────────────────────────
  const isDraft = proposal.confidence < config.safeguards.confidenceThreshold;

  if (isDraft) {
    logger.info(
      `Confidence ${proposal.confidence} < threshold ${config.safeguards.confidenceThreshold}, creating DRAFT PR`
    );
  }

  // ── 8. Validate diff size ────────────────────────────────────
  for (const fix of proposal.fixes) {
    const original = fileContents.get(fix.path);
    if (original) {
      const diffLines = countDiffLines(original.content, fix.fixed_content);
      if (diffLines > config.safeguards.maxDiffLines) {
        const reason = `Diff too large (${diffLines} lines) for ${fix.path}`;
        logger.warn(reason);
        await notifySlack(buildSkipNotification({ error, reason }));
        return { status: "skipped", reason };
      }
    }
  }

  // ── 9. Create branch + commit + PR ───────────────────────────
  await createBranch(branchName);

  const commitMessage = [
    `fix: auto-fix Sentry issue ${error.issueId}`,
    "",
    `Error: ${error.title}`,
    `Culprit: ${error.culprit}`,
    "",
    `AI Explanation:`,
    proposal.explanation,
    "",
    `Confidence: ${(proposal.confidence * 100).toFixed(0)}%`,
    `Sentry URL: ${error.url}`,
  ].join("\n");

  const filesToCommit = proposal.fixes.map((f) => ({
    path: f.path,
    content: f.fixed_content,
  }));

  await commitFiles(branchName, filesToCommit, commitMessage);

  const prBody = buildPRBody(error, proposal);

  const pr = await createPullRequest({
    title: `🤖 Auto-fix: ${error.title}`,
    body: prBody,
    branchName,
    draft: isDraft,
    labels: ["auto-fix", "sentry", isDraft ? "needs-review" : "high-confidence"],
  });

  // ── 10. Notify ───────────────────────────────────────────────
  await notifySlack(
    buildPRNotification({ error, pr, confidence: proposal.confidence })
  );

  logger.info(`Pipeline complete for issue ${error.issueId} → PR #${pr.id}`);

  return {
    status: "success",
    pr: { number: pr.id, url: pr.links.html.href, draft: isDraft },
    confidence: proposal.confidence,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Convert Sentry stack frame paths to repo-relative paths.
 * e.g., "package:myapp/screens/home.dart" → "lib/screens/home.dart"
 */
function resolveFilePaths(frames) {
  const seen = new Set();
  const paths = [];

  for (const frame of frames) {
    let p = frame.filename;

    // Normalize Dart package URIs
    p = p.replace(/^package:[^/]+\//, "lib/");
    // Strip leading slashes
    p = p.replace(/^\/+/, "");
    // Skip frames that look like SDK paths
    if (p.startsWith("dart:") || p.includes("flutter/")) continue;

    if (!seen.has(p)) {
      seen.add(p);
      paths.push(p);
    }
  }

  return paths;
}

function countDiffLines(original, fixed) {
  const origLines = original.split("\n");
  const fixedLines = fixed.split("\n");
  let changes = 0;
  const maxLen = Math.max(origLines.length, fixedLines.length);

  for (let i = 0; i < maxLen; i++) {
    if (origLines[i] !== fixedLines[i]) changes++;
  }

  return changes;
}

function buildPRBody(error, proposal) {
  return `## 🤖 Automated Fix from Sentry

### Error Details
| Field | Value |
|-------|-------|
| **Title** | ${error.title} |
| **Issue ID** | ${error.issueId} |
| **Culprit** | \`${error.culprit}\` |
| **Level** | ${error.level} |
| **Sentry Link** | [View Issue](${error.url}) |

### AI Analysis
${proposal.explanation}

### Confidence: ${(proposal.confidence * 100).toFixed(0)}%
${"█".repeat(Math.round(proposal.confidence * 20))}${"░".repeat(20 - Math.round(proposal.confidence * 20))}

### Files Changed
${proposal.fixes.map((f) => `- \`${f.path}\``).join("\n")}

---
> ⚠️ **This PR was generated automatically.** Please review the changes carefully before merging.
> Generated by sentry-auto-fix-agent
`;
}
