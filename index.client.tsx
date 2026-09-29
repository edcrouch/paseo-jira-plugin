import type { PluginClientContext } from "@getpaseo/plugin/client";
import { IssuePanel } from "./client/IssuePanel";
import { IssuesSurface } from "./client/IssuesSurface";
import { SettingsScreen } from "./client/SettingsScreen";
import { setFocusedKey } from "./client/state";
import { issueAttachments, parseIssueKey } from "./shared/rpc";

export default function contribute(client: PluginClientContext) {
  client.addSurface("issues", IssuesSurface);
  client.addSidebarItem({ id: "issues", title: "Jira", icon: "CircleDot", surface: "issues" });
  client.addSettingsScreen({ id: "jira", title: "Jira", icon: "CircleDot", Component: SettingsScreen });
  client.addWorkspacePanel({ id: "issue", title: "Jira issue", icon: "CircleDot", context: "workspace", Component: IssuePanel });
  client.addAttachmentSource(issueAttachments);

  client.addCommandCenterItem({
    id: "open-issues",
    title: "Jira: browse issues",
    icon: "CircleDot",
    keywords: ["jira", "issues", "tickets"],
    context: "global",
    onSelect: ({ openSurface }) => openSurface("issues"),
  });
  client.addCommandCenterItem({
    id: "open-issue-panel",
    title: "Jira: show linked issue",
    icon: "CircleDot",
    keywords: ["jira", "issue"],
    context: "workspace",
    onSelect: ({ openPanel }) => openPanel("issue"),
  });

  client.addSlashCommand({
    name: "jira",
    description: "Open a Jira issue (or the issue list)",
    argumentHint: "[ABC-123 or issue URL]",
    context: "workspace",
    onSubmit({ args, workspace, openPanel, openSurface }) {
      const key = parseIssueKey(args);
      if (!key) {
        openSurface("issues");
        return;
      }
      setFocusedKey(workspace.id, key);
      openPanel("issue");
    },
  });

  return () => {};
}
