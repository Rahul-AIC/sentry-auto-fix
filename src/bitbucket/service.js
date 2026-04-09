import config from "../config.js";
import logger from "../logger.js";

const WORKSPACE = config.bitbucket.workspace;
const REPO_SLUG = config.bitbucket.repoSlug;
const BASE = config.bitbucket.baseBranch;
const BASE_URL = `https://api.bitbucket.org/2.0/repositories/${WORKSPACE}/${REPO_SLUG}`;

const AUTH_HEADER =
  "Basic " +
  Buffer.from(
    `${config.bitbucket.username}:${config.bitbucket.appPassword}`
  ).toString("base64");

function headers(contentType = "application/json") {
  const h = { Authorization: AUTH_HEADER };
  if (contentType) h["Content-Type"] = contentType;
  return h;
}

// ─── Read files from repo ────────────────────────────────────────────

/**
 * Fetch a single file's content from the repo.
 * Returns { content, path } or null if not found.
 */
export async function getFileContent(path, ref = BASE) {
  try {
    const res = await fetch(`${BASE_URL}/src/${ref}/${path}`, {
      headers: headers(null),
    });

    if (!res.ok) {
      if (res.status === 404) {
        logger.warn(`File not found in repo: ${path}`);
        return null;
      }
      throw new Error(`Bitbucket API error ${res.status}: ${await res.text()}`);
    }

    const content = await res.text();
    return { content, path };
  } catch (err) {
    if (err.message?.includes("404")) return null;
    throw err;
  }
}

/**
 * Fetch multiple files in parallel.
 * Returns a Map<path, { content }>.
 */
export async function getMultipleFiles(paths, ref = BASE) {
  const results = new Map();
  const fetches = paths.map(async (p) => {
    const file = await getFileContent(p, ref);
    if (file) results.set(p, file);
  });
  await Promise.all(fetches);
  return results;
}

// ─── Branch, commit, and PR ──────────────────────────────────────────

/**
 * Create a new branch from the base branch HEAD.
 */
export async function createBranch(branchName) {
  // Get the base branch hash
  const branchRes = await fetch(`${BASE_URL}/refs/branches/${BASE}`, {
    headers: headers(null),
  });
  if (!branchRes.ok) {
    throw new Error(`Failed to get base branch: ${await branchRes.text()}`);
  }
  const branchData = await branchRes.json();
  const baseHash = branchData.target.hash;

  const res = await fetch(`${BASE_URL}/refs/branches`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      name: branchName,
      target: { hash: baseHash },
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to create branch: ${await res.text()}`);
  }

  logger.info(`Created branch ${branchName} from ${BASE} @ ${baseHash.slice(0, 7)}`);
  return baseHash;
}

/**
 * Commit one or more file changes to an existing branch.
 *
 * @param {string} branchName
 * @param {Array<{ path: string, content: string }>} files
 * @param {string} message - commit message
 */
export async function commitFiles(branchName, files, message) {
  // Bitbucket uses multipart form data for committing files
  const formData = new FormData();
  formData.append("branch", branchName);
  formData.append("message", message);

  for (const file of files) {
    formData.append(file.path, new Blob([file.content]), file.path);
  }

  const res = await fetch(`${BASE_URL}/src`, {
    method: "POST",
    headers: { Authorization: AUTH_HEADER },
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`Failed to commit files: ${await res.text()}`);
  }

  logger.info(`Committed ${files.length} file(s) to ${branchName}`);
}

/**
 * Open a Pull Request.
 */
export async function createPullRequest({ title, body, branchName, draft = false, labels = [] }) {
  // Bitbucket has no native labels — encode confidence signal in description
  let description = body;
  if (labels.length > 0) {
    description += `\n\n**Tags:** ${labels.join(", ")}`;
  }

  const payload = {
    title,
    description,
    source: { branch: { name: branchName } },
    destination: { branch: { name: BASE } },
    close_source_branch: true,
  };

  const res = await fetch(`${BASE_URL}/pullrequests`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Failed to create PR: ${await res.text()}`);
  }

  const pr = await res.json();
  logger.info(`Opened PR #${pr.id}: ${title}`);
  return pr;
}

/**
 * Check if a branch already exists (to prevent duplicate fix attempts).
 */
export async function branchExists(branchName) {
  const res = await fetch(`${BASE_URL}/refs/branches/${branchName}`, {
    headers: headers(null),
  });
  return res.ok;
}
