import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { FlatList } from "@getpaseo/plugin/client/react-native";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { parseIssueKey, searchRpc, type IssueRow } from "../shared/rpc";
import { DEFAULT_JQL, jiraSettings } from "../shared/settings";
import { IssueDetail } from "./IssueDetail";
import { Button, Input, StatusPill, useStyles } from "./ui";

const RECENT_JQL = "updated >= -7d ORDER BY updated DESC";

export function IssuesSurface({ theme, layout, navigation }: PluginSurfaceProps) {
  const s = useStyles(theme, layout.compact);
  const search = useRpc(searchRpc);
  const settings = useSettings(jiraSettings);
  const myJql = settings.status === "ready" && settings.values.defaultJql ? settings.values.defaultJql : DEFAULT_JQL;
  const [filter, setFilter] = useState<"mine" | "recent" | "custom">("mine");
  const [custom, setCustom] = useState("");
  const [applied, setApplied] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [lookup, setLookup] = useState("");
  const [lookupError, setLookupError] = useState<string | null>(null);
  const goTo = () => {
    const key = parseIssueKey(lookup);
    if (!key) {
      setLookupError("Enter an issue key like ABC-123 or a Jira issue URL");
      return;
    }
    setLookupError(null);
    setLookup("");
    setSelected(key);
  };
  const jql = filter === "mine" ? myJql : filter === "recent" ? RECENT_JQL : applied;

  const issues = useInfiniteQuery({
    queryKey: ["jira", "search", jql],
    queryFn: ({ pageParam }) => search({ jql, nextPageToken: pageParam || undefined }),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextPageToken ?? null,
    enabled: !!jql,
  });
  const rows = issues.data?.pages.flatMap((p) => p.issues) ?? [];

  const chip = (id: typeof filter, label: string) => (
    <Pressable key={id} accessibilityRole="button" accessibilityLabel={label} onPress={() => setFilter(id)} style={[s.ghost, filter === id ? { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent } : null]}>
      <Text style={filter === id ? s.buttonText : s.ghostText}>{label}</Text>
    </Pressable>
  );

  const detail = selected ? (
    <IssueDetail
      issueKey={selected}
      theme={theme}
      compact={layout.compact}
      onBack={layout.compact ? () => setSelected(null) : undefined}
      onWorkspaceCreated={(workspaceId) => navigation?.openWorkspace({ workspaceId })}
    />
  ) : null;

  if (layout.compact && detail) return <View style={[s.screen, { padding: 0 }]}>{detail}</View>;

  const list = (
    <View style={{ flex: 1, gap: 10 }}>
      <View style={s.row}>
        <Input
          s={s}
          value={lookup}
          onChangeText={(text) => {
            setLookup(text);
            setLookupError(null);
          }}
          placeholder="Go to issue: ABC-123 or URL"
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={goTo}
          accessibilityLabel="Go to Jira issue by key or URL"
          style={{ flex: 1 }}
        />
        <Button s={s} label="Open" onPress={goTo} disabled={!lookup.trim()} />
      </View>
      {lookupError ? <Text style={s.error}>{lookupError}</Text> : null}
      <View style={s.row}>
        {chip("mine", "My open")}
        {chip("recent", "Recent")}
        {chip("custom", "JQL")}
        <Button s={s} ghost label="↻" onPress={() => void issues.refetch()} />
      </View>
      {filter === "custom" ? (
        <View style={s.row}>
          <Input s={s} value={custom} onChangeText={setCustom} placeholder='project = ABC AND status = "To Do"' autoCapitalize="none" autoCorrect={false} onSubmitEditing={() => setApplied(custom)} style={{ flex: 1 }} />
          <Button s={s} label="Run" onPress={() => setApplied(custom)} />
        </View>
      ) : null}
      {issues.error ? <Text style={s.error}>{issues.error instanceof Error ? issues.error.message : String(issues.error)}</Text> : null}
      <FlatList<IssueRow>
        data={rows}
        keyExtractor={(i) => i.key}
        ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" accessibilityLabel={`${item.key} ${item.summary}`} onPress={() => setSelected(item.key)} style={[s.card, selected === item.key ? { borderColor: theme.colors.accent } : null]}>
            <View style={s.row}>
              <Text style={[s.muted, { fontWeight: "600" }]}>{item.key}</Text>
              <StatusPill theme={theme} category={item.statusCategory} label={item.status} />
              <Text style={s.muted}>{item.issuetype}{item.priority ? ` · ${item.priority}` : ""}</Text>
            </View>
            <Text style={s.text} numberOfLines={2}>{item.summary}</Text>
            <Text style={s.muted}>{item.assignee ?? "Unassigned"} · {item.updated.slice(0, 10)}</Text>
          </Pressable>
        )}
        ListEmptyComponent={<Text style={s.muted}>{issues.isPending && jql ? "Loading…" : jql ? "No issues." : "Enter JQL and press Run."}</Text>}
        ListFooterComponent={issues.hasNextPage ? <View style={{ paddingTop: 8 }}><Button s={s} ghost label={issues.isFetchingNextPage ? "Loading…" : "Load more"} onPress={() => void issues.fetchNextPage()} /></View> : null}
      />
    </View>
  );

  return (
    <View style={[s.screen, { flexDirection: "row" }]}>
      <View style={{ flex: detail ? 2 : 1 }}>{list}</View>
      {detail ? <View style={{ flex: 3, borderLeftWidth: 1, borderLeftColor: theme.colors.border }}>{detail}</View> : null}
    </View>
  );
}
