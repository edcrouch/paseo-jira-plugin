import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useWorkspace } from "@getpaseo/plugin/client";
import { Text, View } from "react-native";
import { ISSUE_KEY_RE } from "../shared/rpc";
import { IssueDetail } from "./IssueDetail";
import { useFocusedKey } from "./state";
import { useStyles } from "./ui";

export function IssuePanel({ theme, layout, workspaceId, navigation }: PluginWorkspacePanelProps) {
  const s = useStyles(theme, layout.compact);
  const focused = useFocusedKey(workspaceId);
  const title = useWorkspace(workspaceId, (w) => `${w.title ?? ""} ${w.name}`);
  const key = focused ?? title?.match(ISSUE_KEY_RE)?.[1] ?? null;
  if (!key) {
    return (
      <View style={s.screen}>
        <Text style={s.text}>No Jira key in this workspace title.</Text>
        <Text style={s.muted}>Create the worktree from the Jira sidebar, or run /jira ABC-123 in the composer.</Text>
      </View>
    );
  }
  return (
    <View style={[s.screen, { padding: 0 }]}>
      <IssueDetail issueKey={key} theme={theme} compact={layout.compact} onWorkspaceCreated={(id) => navigation?.openWorkspace({ workspaceId: id })} />
    </View>
  );
}
