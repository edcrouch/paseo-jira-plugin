import type { Issue } from "./rpc";

export function branchName(issue: Pick<Issue, "key" | "summary">): string {
  const slug = issue.summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return slug ? `${issue.key}-${slug}` : issue.key;
}

export function workspaceTitle(issue: Pick<Issue, "key" | "summary">): string {
  return `${issue.key} ${issue.summary}`;
}

/** Stable text snapshot of an issue; used for attachments and as the prompt body. */
export function issueText(issue: Issue): string {
  const lines = [
    `# ${issue.key}: ${issue.summary}`,
    issue.url,
    `Type: ${issue.issuetype} | Status: ${issue.status} | Priority: ${issue.priority ?? "none"}`,
    `Assignee: ${issue.assignee ?? "unassigned"} | Reporter: ${issue.reporter ?? "unknown"}`,
  ];
  if (issue.labels.length) lines.push(`Labels: ${issue.labels.join(", ")}`);
  lines.push("", "## Description", issue.description.trim() || "_No description._");
  if (issue.comments.length) {
    lines.push("", "## Comments");
    for (const c of issue.comments) {
      lines.push("", `**${c.author}** (${c.created.slice(0, 10)}):`, c.body.trim());
    }
  }
  return lines.join("\n");
}

export function buildPrompt(issue: Issue): string {
  return [
    issueText(issue),
    "",
    "---",
    `Implement Jira issue ${issue.key} in this worktree. Read the relevant code first, keep the change minimal, and ask before widening scope.`,
  ].join("\n");
}
