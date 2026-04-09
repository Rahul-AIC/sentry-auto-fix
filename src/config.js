import dotenv from "dotenv";
dotenv.config();

const config = {
  port: parseInt(process.env.PORT || "3000"),
  nodeEnv: process.env.NODE_ENV || "development",

  sentry: {
    webhookSecret: process.env.SENTRY_WEBHOOK_SECRET,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
  },

  bitbucket: {
    username: process.env.BITBUCKET_USERNAME,
    appPassword: process.env.BITBUCKET_APP_PASSWORD,
    workspace: process.env.BITBUCKET_WORKSPACE,
    repoSlug: process.env.BITBUCKET_REPO_SLUG,
    baseBranch: process.env.BITBUCKET_BASE_BRANCH || "main",
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || "gpt-4o",
  },

  safeguards: {
    maxFilesPerFix: parseInt(process.env.MAX_FILES_PER_FIX || "3"),
    maxDiffLines: parseInt(process.env.MAX_DIFF_LINES || "100"),
    autoMergeEnabled: process.env.AUTO_MERGE_ENABLED === "true",
    confidenceThreshold: parseFloat(process.env.CONFIDENCE_THRESHOLD || "0.8"),
  },

  slackWebhook: process.env.NOTIFY_SLACK_WEBHOOK,
};

export default config;
