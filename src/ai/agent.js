import OpenAI from "openai";
import config from "../config.js";
import logger from "../logger.js";

const openai = new OpenAI({ apiKey: config.openai.apiKey });

/**
 * Ask the AI to analyze a Sentry error and propose a code fix.
 *
 * @param {object} params
 * @param {object} params.error     - { title, message, culprit }
 * @param {Array}  params.frames    - stack frames from Sentry
 * @param {Map}    params.fileContents - Map<path, { content }>
 *
 * @returns {object} { fixes: [{ path, original, fixed }], explanation, confidence }
 */
export async function proposeCodeFix({ error, frames, fileContents }) {
  const filesContext = buildFilesContext(frames, fileContents);

  const systemPrompt = `You are a senior Flutter/Dart developer acting as an automated bug-fix agent.

RULES:
1. You receive a runtime error from Sentry plus the source files involved.
2. Propose the MINIMAL fix — change as few lines as possible.
3. Do NOT refactor unrelated code.
4. Do NOT add new dependencies unless absolutely necessary.
5. Preserve existing code style (indentation, naming conventions).
6. If you are not confident, say so — do not guess.

RESPONSE FORMAT (strict JSON, no markdown fences):
{
  "confidence": 0.0 to 1.0,
  "explanation": "One-paragraph explanation of what went wrong and what the fix does.",
  "fixes": [
    {
      "path": "lib/relative/path.dart",
      "fixed_content": "...entire corrected file content..."
    }
  ]
}

If you cannot determine a fix, return:
{
  "confidence": 0,
  "explanation": "Reason you cannot fix it.",
  "fixes": []
}`;

  const userPrompt = `## Error from Sentry

**Title:** ${error.title}
**Message:** ${error.message}
**Culprit:** ${error.culprit}

## Stack Trace (top = crash point)
${frames
  .slice(0, 10)
  .map(
    (f, i) =>
      `#${i} ${f.function} (${f.filename}:${f.lineNo}:${f.colNo})`
  )
  .join("\n")}

## Source Files
${filesContext}

Analyze the error, identify the root cause, and return a JSON fix.`;

  logger.debug("Sending prompt to OpenAI", { model: config.openai.model });

  const response = await openai.chat.completions.create({
    model: config.openai.model,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 8192,
  });

  const raw = response.choices[0]?.message?.content || "{}";
  logger.debug("AI raw response length", { length: raw.length });

  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    logger.error("AI returned invalid JSON", { raw: raw.slice(0, 500) });
    return { confidence: 0, explanation: "AI returned unparseable response", fixes: [] };
  }

  // Validate shape
  if (typeof result.confidence !== "number") result.confidence = 0;
  if (!Array.isArray(result.fixes)) result.fixes = [];

  logger.info("AI fix proposal", {
    confidence: result.confidence,
    fileCount: result.fixes.length,
  });

  return result;
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Build a context string of all relevant source files for the prompt.
 */
function buildFilesContext(frames, fileContents) {
  const sections = [];

  for (const [path, { content }] of fileContents) {
    // Find the frame(s) for this file to highlight the error location
    const relatedFrames = frames.filter((f) => {
      const normFramePath = normalizeFilePath(f.filename);
      const normPath = normalizeFilePath(path);
      return normFramePath === normPath || normFramePath.endsWith(normPath) || normPath.endsWith(normFramePath);
    });

    let annotation = "";
    if (relatedFrames.length > 0) {
      const locs = relatedFrames
        .map((f) => `line ${f.lineNo} in ${f.function}`)
        .join(", ");
      annotation = ` ← ERROR at ${locs}`;
    }

    sections.push(
      `### ${path}${annotation}\n\`\`\`dart\n${content}\n\`\`\``
    );
  }

  return sections.join("\n\n");
}

/**
 * Normalize file paths for comparison.
 * Sentry might report "package:myapp/foo.dart" while the repo has "lib/foo.dart".
 */
function normalizeFilePath(filepath) {
  return filepath
    .replace(/^package:[^/]+\//, "lib/")
    .replace(/^\/+/, "");
}
