import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { addCommentRpc, issueRpc, transitionRpc } from "../shared/rpc";
import { CreateWorktreeModal } from "./CreateWorktreeModal";
import { Button, Input, StatusPill, useStyles } from "./ui";

interface Props {
  issueKey: string;
  theme: PluginTheme;
  compact: boolean;
  onBack?(): void;
  onWorkspaceCreated?(workspaceId: string): void;
}

export function IssueDetail({ issueKey, theme, compact, onBack, onWorkspaceCreated }: Props) {
  const s = useStyles(theme, compact);
  const toast = useToast();
  const qc = useQueryClient();
  const getIssue = useRpc(issueRpc);
  const addComment = useRpc(addCommentRpc);
  const transition = useRpc(transitionRpc);
  const [comment, setComment] = useState("");
  const [worktreeOpen, setWorktreeOpen] = useState(false);

  const issue = useQuery({ queryKey: ["jira", "issue", issueKey], queryFn: () => getIssue({ key: issueKey }) });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["jira", "issue", issueKey] });
    void qc.invalidateQueries({ queryKey: ["jira", "search"] });
  };
  const fail = (error: unknown) => toast.error(error instanceof Error ? error.message : String(error));

  const post = useMutation({
    mutationFn: () => addComment({ key: issueKey, body: comment.trim() }),
    onSuccess: () => {
      setComment("");
      toast.show("Comment posted", { variant: "success" });
      refresh();
    },
    onError: fail,
  });
  const move = useMutation({
    mutationFn: (transitionId: string) => transition({ key: issueKey, transitionId }),
    onSuccess: () => {
      toast.show("Status updated", { variant: "success" });
      refresh();
    },
    onError: fail,
  });

  if (issue.isPending) return <Text style={[s.muted, { padding: 12 }]}>Loading {issueKey}…</Text>;
  if (issue.error || !issue.data) {
    return (
      <View style={{ padding: 12, gap: 8 }}>
        {onBack ? <Button s={s} ghost label="← Back" onPress={onBack} /> : null}
        <Text style={s.error}>{issue.error instanceof Error ? issue.error.message : "Failed to load issue"}</Text>
      </View>
    );
  }
  const d = issue.data;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: compact ? 12 : 16, gap: 12 }}>
      <View style={s.row}>
        {onBack ? <Button s={s} ghost label="← Back" onPress={onBack} /> : null}
        <Text style={[s.muted, { fontWeight: "600" }]}>{d.key}</Text>
        <StatusPill theme={theme} category={d.statusCategory} label={d.status} />
        <Text style={s.muted}>{d.issuetype}</Text>
        {d.priority ? <Text style={s.muted}>· {d.priority}</Text> : null}
      </View>
      <Text style={s.title} selectable>{d.summary}</Text>
      <Text style={s.muted}>
        Assignee: {d.assignee ?? "unassigned"} · Reporter: {d.reporter ?? "unknown"} · Updated {d.updated.slice(0, 10)}
        {d.labels.length ? ` · ${d.labels.join(", ")}` : ""}
      </Text>

      <View style={s.row}>
        <Button s={s} label="Create worktree" onPress={() => setWorktreeOpen(true)} />
        <Pressable accessibilityRole="link" accessibilityLabel="View on Jira" onPress={() => void Linking.openURL(d.url)} style={s.ghost}>
          <Text style={s.ghostText}>View on Jira ↗</Text>
        </Pressable>
        <Button s={s} ghost label="Refresh" onPress={refresh} />
      </View>

      {d.transitions.length ? (
        <View style={s.card}>
          <Text style={s.muted}>Move to</Text>
          <View style={s.row}>
            {d.transitions.map((t) => (
              <Button key={t.id} s={s} ghost label={t.name === t.to ? t.name : `${t.name} → ${t.to}`} onPress={() => move.mutate(t.id)} disabled={move.isPending} />
            ))}
          </View>
        </View>
      ) : null}

      <View style={s.card}>
        <Text style={s.muted}>Description</Text>
        <Text style={s.text} selectable>{d.description || "No description."}</Text>
      </View>

      <View style={s.card}>
        <Text style={s.muted}>Comments ({d.comments.length})</Text>
        {d.comments.map((c) => (
          <View key={c.id} style={{ gap: 2, paddingTop: 6, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
            <Text style={s.muted}>{c.author} · {c.created.slice(0, 16).replace("T", " ")}</Text>
            <Text style={s.text} selectable>{c.body}</Text>
          </View>
        ))}
        <Input s={s} value={comment} onChangeText={setComment} placeholder="Add a comment" multiline style={{ minHeight: 72 }} />
        <View style={[s.row, { justifyContent: "flex-end" }]}>
          <Button s={s} label={post.isPending ? "Posting…" : "Post comment"} onPress={() => post.mutate()} disabled={post.isPending || !comment.trim()} />
        </View>
      </View>

      <CreateWorktreeModal issue={d} theme={theme} compact={compact} open={worktreeOpen} onOpenChange={setWorktreeOpen} onCreated={onWorkspaceCreated} />
    </ScrollView>
  );
}
