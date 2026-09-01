/**
 * Conventional Commits, enforced locally by the commit-msg hook in .githooks/
 * and in CI by .github/workflows/ci.yml.
 *
 * Format: <type>(<optional scope>): <subject>
 * Example: feat(chat): stream answers with inline citations
 */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "perf",
        "refactor",
        "docs",
        "test",
        "build",
        "ci",
        "chore",
        "style",
        "revert",
      ],
    ],
    "scope-enum": [
      2,
      "always",
      [
        "api",
        "web",
        "shared",
        "demo",
        "db",
        "auth",
        "chat",
        "ingest",
        "providers",
        "quota",
        "deploy",
        "docs",
        "ci",
        "deps",
        "repo",
      ],
    ],
    "scope-empty": [0],
    "subject-case": [2, "always", "lower-case"],
    "header-max-length": [2, "always", 100],
    "body-max-line-length": [0],
  },
};
