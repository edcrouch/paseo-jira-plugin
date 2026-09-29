import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const DEFAULT_JQL =
  "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";

export const jiraSettings = defineSettings({
  id: "connection",
  scope: "host",
  version: 1,
  schema: z.object({
    siteUrl: z.string().default(""),
    email: z.string().default(""),
    apiToken: z.string().default(""),
    defaultJql: z.string().default(DEFAULT_JQL),
    /** provider/model, e.g. claude/claude-opus-5-5 */
    defaultProvider: z.string().default(""),
    defaultModeId: z.string().default(""),
    /** Reasoning level id; ignored when the model has no reasoning options */
    defaultThinkingOptionId: z.string().default(""),
    defaultBaseBranch: z.string().default("main"),
    /** Jira project key -> Paseo projectId last used for a worktree */
    lastProjectByJiraKey: z.record(z.string(), z.string()).default({}),
  }),
});

export type JiraSettings = z.infer<typeof jiraSettings.schema>;
