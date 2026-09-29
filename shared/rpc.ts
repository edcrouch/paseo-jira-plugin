import { defineAttachmentSource, defineRpc, PluginAttachmentSearchPayloadSchema } from "@getpaseo/plugin";
import { z } from "zod";

export const IssueRowSchema = z.object({
  key: z.string(),
  summary: z.string(),
  status: z.string(),
  /** Jira statusCategory key: new | indeterminate | done */
  statusCategory: z.string(),
  priority: z.string().nullable(),
  issuetype: z.string(),
  assignee: z.string().nullable(),
  updated: z.string(),
  url: z.string(),
});
export type IssueRow = z.infer<typeof IssueRowSchema>;

export const CommentSchema = z.object({
  id: z.string(),
  author: z.string(),
  created: z.string(),
  body: z.string(),
});

export const TransitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  to: z.string(),
});

export const IssueSchema = IssueRowSchema.extend({
  description: z.string(),
  created: z.string(),
  reporter: z.string().nullable(),
  labels: z.array(z.string()),
  comments: z.array(CommentSchema),
  transitions: z.array(TransitionSchema),
});
export type Issue = z.infer<typeof IssueSchema>;

export const searchRpc = defineRpc({
  name: "jira.search",
  input: z.object({ jql: z.string(), nextPageToken: z.string().optional() }),
  output: z.object({ issues: z.array(IssueRowSchema), nextPageToken: z.string().optional() }),
});

export const issueRpc = defineRpc({
  name: "jira.issue",
  input: z.object({ key: z.string() }),
  output: IssueSchema,
});

export const addCommentRpc = defineRpc({
  name: "jira.add-comment",
  input: z.object({ key: z.string(), body: z.string().min(1) }),
  output: z.object({ id: z.string() }),
});

export const transitionRpc = defineRpc({
  name: "jira.transition",
  input: z.object({ key: z.string(), transitionId: z.string() }),
  output: z.object({}),
});

export const myselfRpc = defineRpc({
  name: "jira.myself",
  input: z.object({}),
  output: z.object({ accountId: z.string(), displayName: z.string() }),
});

export const attachSearchRpc = defineRpc({
  name: "jira.attach-search",
  input: z.object({ query: z.string() }),
  output: PluginAttachmentSearchPayloadSchema,
});

export const issueAttachments = defineAttachmentSource({
  id: "issues",
  title: "Jira issue",
  icon: "CircleDot",
  pickerTitle: "Attach Jira issue",
  searchPlaceholder: "Issue key or text",
  search: attachSearchRpc,
});

export const ISSUE_KEY_RE = /\b([A-Z][A-Z0-9_]+-\d+)\b/;

/** Issue key from "abc-123", "ABC-123", or a ".../browse/ABC-123" URL; null otherwise. */
export function parseIssueKey(input: string): string | null {
  const text = input.trim();
  const fromUrl = text.match(/\/browse\/([A-Za-z][A-Za-z0-9_]+-\d+)/)?.[1];
  const key = fromUrl ?? text.match(/^([A-Za-z][A-Za-z0-9_]+-\d+)$/)?.[1];
  return key ? key.toUpperCase() : null;
}
