# Roadmap

Planned features beyond the current release, with enough implementation detail to pick any item up directly. Code snippets are written against the Paseo 0.8.0 SDK types and have not been compiled; expect small type fixes.

Contributions welcome. Open an issue first for anything in items 8–9, since they reshape settings.

## Conventions

- Server-side Jira calls live in `server/jira.ts` as methods on `Jira` (one per endpoint, all through `this.call<T>(method, route, body?)`). Contracts live in `shared/rpc.ts`; handlers are wired in `index.server.ts` as `server.handle(rpc, async (input) => (await Jira.load()).method(...))`.
- Client reads via `useRpc(contract)` + TanStack Query. After any write, invalidate `["jira","issue",key]` and `["jira","search"]` (see `refresh()` in `client/IssueDetail.tsx`).
- Settings fields go in `shared/settings.ts` with `.default(...)` so older documents still parse. Bump `version` and add `migrate` only when a field changes meaning (item 8).
- Jira Cloud v3 rich text is ADF. Use v2 (`/rest/api/2/...`) for plain-text writes (comments, descriptions). Use v3 for everything else.
- Shared UI helpers: `useStyles`, `Button`, `Input`, `Field`, `StatusPill` in `client/ui.tsx`. Host UI: `Modal`, `useToast`, `ScrollView`, `FlatList`, `TextInput` from `@getpaseo/plugin/client/react-native`; `SettingsSelect`, `SettingsSwitch`, `SettingsInput`, `SettingsAction`, `SettingsSection` from `@getpaseo/plugin/client/ui`.
- React Native primitives only in `client/`. Colors from `theme.colors`. Check compact layout.
- Loop after each item:

  ```bash
  npm run typecheck && npm test
  paseo plugin reload jira
  paseo plugin logs jira
  ```

Suggested order: 1, 2, 3, 4, then 10, then 5, 6, 7. 8 and 9 on demand. 11 as SDK releases land.

---

## 1. Post agent result back to Jira

Goal: when an agent turn completes in a workspace tied to an issue, add a Jira comment with the agent's final message.

### Settings

`shared/settings.ts`, inside the schema object:

```ts
/** Comment on the issue when an agent turn finishes in a linked workspace */
postResultsToJira: z.boolean().default(false),
```

`client/SettingsScreen.tsx`, in the "Defaults" section (needs `SettingsSwitch` import and a draft setter for booleans):

```tsx
<SettingsSwitch
  label="Post agent results to Jira"
  hint="Adds a comment with the agent's final message when a turn finishes in a workspace titled with an issue key"
  value={merged.postResultsToJira}
  onValueChange={(v) => setDraft((d) => ({ ...d, postResultsToJira: v }))}
/>
```

### Server

New file `server/turn-ended.ts`:

```ts
import type { PluginLifecycleEvents, PluginHookContext } from "@getpaseo/plugin/server";
import { ISSUE_KEY_RE } from "../shared/rpc";
import { Jira, loadSettings } from "./jira";

const MAX_CHARS = 4000;
const recent = new Map<string, number>(); // agentId -> last post time; avoid comment storms

export async function onTurnEnded(
  { agent, outcome, timeline }: PluginLifecycleEvents["agent.turn_ended"],
  { paseo }: PluginHookContext,
) {
  if (outcome.kind !== "completed" || !agent.workspaceId) return;
  if (!(await loadSettings()).postResultsToJira) return;
  if (Date.now() - (recent.get(agent.id) ?? 0) < 60_000) return;

  const ws = await paseo.workspaces.ref(agent.workspaceId).refresh();
  const haystack = `${ws?.title ?? ""} ${ws?.name ?? ""} ${agent.title ?? ""}`.toUpperCase();
  const key = haystack.match(ISSUE_KEY_RE)?.[1];
  if (!key) return;

  const last = [...timeline].reverse().find((item) => item.type === "assistant_message");
  if (!last || last.type !== "assistant_message" || !last.text.trim()) return;
  const text = last.text.length > MAX_CHARS ? `${last.text.slice(0, MAX_CHARS)}\n\n[truncated]` : last.text;

  const jira = await Jira.load();
  await jira.addComment(
    key,
    `Paseo agent (${agent.provider}) finished a turn in workspace "${ws?.title ?? ws?.name ?? agent.workspaceId}".\n\n${text}`,
  );
  recent.set(agent.id, Date.now());
}
```

`index.server.ts`:

```ts
import { onTurnEnded } from "./server/turn-ended";
// inside contribute():
const offTurnEnded = server.on("agent.turn_ended", (event, ctx) =>
  onTurnEnded(event, ctx).catch((error) => console.error("[jira] turn_ended:", error)),
);
// cleanup:
return () => { offTurnEnded(); };
```

Notes: `PluginLifecycleEvents` and `PluginHookContext` are exported from `@getpaseo/plugin/server` (see `node_modules/@getpaseo/plugin/dist/server/lifecycle.d.ts`). The `timeline` array contains `AgentTimelineItem`; `assistant_message` items have `text`. Errors must be caught inside the hook; a throwing hook is logged by Paseo but we want our own message in `plugin logs`.

### Verify

Toggle on; create a worktree from an issue with "Start agent" on; after the first turn, the issue has a comment. Toggle off → no comment. Two turns within 60s → one comment.

---

## 2. Auto-transition on worktree create

Goal: optionally move the issue when a worktree is created from it.

### Settings

```ts
/** Transition name (or target status name) to apply on worktree create; empty disables */
transitionOnWorktree: z.string().default(""),
```

`client/SettingsScreen.tsx`, "Defaults" section:

```tsx
<SettingsInput
  label="Transition on worktree create"
  hint='Transition or status name, e.g. "In Progress". Empty disables.'
  initialValue={v.transitionOnWorktree}
  onChangeText={field("transitionOnWorktree")}
/>
```

### Client

`client/CreateWorktreeModal.tsx`: add `const transition = useRpc(transitionRpc);` and `const qc = useQueryClient();` (imports: `useRpc` from `@getpaseo/plugin/client`, `transitionRpc` from `../shared/rpc`, `useQueryClient` from `@tanstack/react-query`). In `create.mutationFn`, after the workspace and agent are created and before `return workspace.id`:

```ts
const wanted = values?.transitionOnWorktree.trim().toLowerCase();
if (wanted) {
  const match = issue.transitions.find(
    (t) => t.name.toLowerCase() === wanted || t.to.toLowerCase() === wanted,
  );
  if (!match) {
    toast.show(`No transition "${values.transitionOnWorktree}" on ${issue.key}`, { variant: "warning" });
  } else {
    try {
      await transition({ key: issue.key, transitionId: match.id });
      void qc.invalidateQueries({ queryKey: ["jira", "issue", issue.key] });
      void qc.invalidateQueries({ queryKey: ["jira", "search"] });
    } catch (error) {
      toast.show(`Worktree created; transition failed: ${String(error)}`, { variant: "warning" });
    }
  }
}
```

The worktree must never fail because of the transition, hence the inner try/catch.

### Verify

Setting "In Progress" → create worktree → status changes. Unknown name → warning toast, worktree still created.

---

## 3. Assign to me / change assignee

### Jira endpoints

- `GET /rest/api/3/user/assignable/search?issueKey=ABC-1&query=<text>&maxResults=20` → `[{ accountId, displayName }]`
- `PUT /rest/api/3/issue/{key}/assignee` body `{ "accountId": "<id>" | null }` → 204

### Contracts (`shared/rpc.ts`)

```ts
export const UserSchema = z.object({ accountId: z.string(), displayName: z.string() });

export const assignableUsersRpc = defineRpc({
  name: "jira.assignable-users",
  input: z.object({ key: z.string(), query: z.string() }),
  output: z.object({ users: z.array(UserSchema) }),
});

export const assignRpc = defineRpc({
  name: "jira.assign",
  input: z.object({ key: z.string(), accountId: z.string().nullable() }),
  output: z.object({}),
});
```

Extend `IssueSchema` with `assigneeAccountId: z.string().nullable()`. In `server/jira.ts` add `accountId?: string` to `RawIssue.fields.assignee` and map `assigneeAccountId: f.assignee?.accountId ?? null` in `full()`.

### Server (`server/jira.ts`)

```ts
async assignableUsers(key: string, query: string) {
  const q = new URLSearchParams({ issueKey: key, query, maxResults: "20" });
  const users = await this.call<{ accountId: string; displayName: string }[]>(
    "GET",
    `/rest/api/3/user/assignable/search?${q}`,
  );
  return { users: users.map((u) => ({ accountId: u.accountId, displayName: u.displayName })) };
}

async assign(key: string, accountId: string | null) {
  await this.call<void>("PUT", `/rest/api/3/issue/${key}/assignee`, { accountId });
}
```

`index.server.ts`:

```ts
server.handle(assignableUsersRpc, async ({ key, query }) => (await Jira.load()).assignableUsers(key, query));
server.handle(assignRpc, async ({ key, accountId }) => {
  await (await Jira.load()).assign(key, accountId);
  return {};
});
```

### Client

New `client/AssigneeModal.tsx`:

```tsx
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { FlatList, Modal } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { assignableUsersRpc } from "../shared/rpc";
import { Button, Input, useStyles } from "./ui";

interface Props {
  issueKey: string;
  theme: PluginTheme;
  compact: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  onPick(accountId: string | null): void;
}

export function AssigneeModal({ issueKey, theme, compact, open, onOpenChange, onPick }: Props) {
  const s = useStyles(theme, compact);
  const search = useRpc(assignableUsersRpc);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(text), 300);
    return () => clearTimeout(t);
  }, [text]);
  const users = useQuery({
    queryKey: ["jira", "assignable", issueKey, query],
    queryFn: () => search({ key: issueKey, query }),
    enabled: open,
  });
  return (
    <Modal title={`Assign ${issueKey}`} open={open} onOpenChange={onOpenChange}>
      <Modal.Content scrollable={false}>
        <Input s={s} value={text} onChangeText={setText} placeholder="Search people" autoFocus />
        <Button s={s} ghost label="Unassign" onPress={() => onPick(null)} />
        {users.error ? <Text style={s.error}>{String(users.error)}</Text> : null}
        <FlatList
          data={users.data?.users ?? []}
          keyExtractor={(u) => u.accountId}
          style={{ maxHeight: 320 }}
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" accessibilityLabel={item.displayName} onPress={() => onPick(item.accountId)} style={{ paddingVertical: 10 }}>
              <Text style={s.text}>{item.displayName}</Text>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={s.muted}>{users.isPending ? "Loading…" : "No matches."}</Text>}
        />
        <View style={{ height: 4 }} />
      </Modal.Content>
    </Modal>
  );
}
```

`client/IssueDetail.tsx`: add state `const [assignOpen, setAssignOpen] = useState(false);`, RPCs `const me = useRpc(myselfRpc); const assign = useRpc(assignRpc);`, and mutation:

```ts
const setAssignee = useMutation({
  mutationFn: (accountId: string | null) => assign({ key: issueKey, accountId }),
  onSuccess: () => { setAssignOpen(false); toast.show("Assignee updated", { variant: "success" }); refresh(); },
  onError: fail,
});
const assignToMe = async () => setAssignee.mutate((await me({})).accountId);
```

In the action row add:

```tsx
<Button s={s} ghost label="Assign to me" onPress={() => void assignToMe()} disabled={setAssignee.isPending} />
<Button s={s} ghost label="Assignee…" onPress={() => setAssignOpen(true)} />
```

and render `<AssigneeModal issueKey={issueKey} theme={theme} compact={compact} open={assignOpen} onOpenChange={setAssignOpen} onPick={(id) => setAssignee.mutate(id)} />` next to the worktree modal. Hide "Assign to me" when `d.assigneeAccountId` equals the cached `myself` accountId (fetch once with `useQuery({ queryKey: ["jira","me"], queryFn: () => me({}), staleTime: Infinity })`).

### Verify

Assign to me updates the header after refetch. Picker search returns people; pick assigns; Unassign clears.

---

## 4. Full comment paging

### Jira endpoint

`GET /rest/api/3/issue/{key}/comment?startAt=<n>&maxResults=100&orderBy=created` → `{ startAt, maxResults, total, comments[] }`.

### Contract

```ts
export const commentsRpc = defineRpc({
  name: "jira.comments",
  input: z.object({ key: z.string(), startAt: z.number().int().min(0) }),
  output: z.object({ comments: z.array(CommentSchema), total: z.number(), nextStartAt: z.number().nullable() }),
});
```

Extend `IssueSchema` with `commentsTotal: z.number()`; in `server/jira.ts` add `total?: number` to `RawIssue.fields.comment` and map `commentsTotal: f.comment?.total ?? comments.length`.

### Server

```ts
async comments(key: string, startAt: number) {
  const page = await this.call<{
    startAt: number; maxResults: number; total: number;
    comments: { id: string; author?: { displayName: string }; created: string; body: unknown }[];
  }>("GET", `/rest/api/3/issue/${key}/comment?startAt=${startAt}&maxResults=100&orderBy=created`);
  const comments = page.comments.map((c) => this.comment(c));
  const next = page.startAt + page.comments.length;
  return { comments, total: page.total, nextStartAt: next < page.total ? next : null };
}
```

Extract the comment mapping already inside `full()` into `private comment(c) { ... }` and reuse it. Remove the `NOTE:` about the comment cap in `full()`.

### Client (`client/IssueDetail.tsx`)

```ts
const listComments = useRpc(commentsRpc);
const [showAll, setShowAll] = useState(false);
const all = useInfiniteQuery({
  queryKey: ["jira", "comments", issueKey],
  queryFn: ({ pageParam }) => listComments({ key: issueKey, startAt: pageParam }),
  initialPageParam: 0,
  getNextPageParam: (last) => last.nextStartAt,
  enabled: showAll,
});
const comments = showAll ? (all.data?.pages.flatMap((p) => p.comments) ?? []) : d.comments;
```

Render `comments` instead of `d.comments`. Below the list:

```tsx
{!showAll && d.commentsTotal > d.comments.length ? (
  <Button s={s} ghost label={`Load all ${d.commentsTotal} comments`} onPress={() => setShowAll(true)} />
) : null}
{showAll && all.hasNextPage ? (
  <Button s={s} ghost label={all.isFetchingNextPage ? "Loading…" : "Load more"} onPress={() => void all.fetchNextPage()} />
) : null}
```

Add `["jira","comments",issueKey]` to `refresh()`.

### Verify

Issue with >20 comments shows the button; loading yields all comments in created order; posting a new comment refreshes both views.

---

## 5. Priority edit

### Jira endpoints

- `GET /rest/api/3/priority` → `[{ id, name }]`
- `PUT /rest/api/3/issue/{key}` body `{ "fields": { "priority": { "id": "<id>" } } }` → 204

### Contracts

```ts
export const prioritiesRpc = defineRpc({
  name: "jira.priorities",
  input: z.object({}),
  output: z.object({ priorities: z.array(z.object({ id: z.string(), name: z.string() })) }),
});
export const setPriorityRpc = defineRpc({
  name: "jira.set-priority",
  input: z.object({ key: z.string(), priorityId: z.string() }),
  output: z.object({}),
});
```

Extend `IssueSchema` with `priorityId: z.string().nullable()`; add `id: string` to `RawIssue.fields.priority` and map `priorityId: f.priority?.id ?? null`.

### Server

```ts
async priorities() {
  const list = await this.call<{ id: string; name: string }[]>("GET", "/rest/api/3/priority");
  return { priorities: list.map((p) => ({ id: p.id, name: p.name })) };
}
async setPriority(key: string, priorityId: string) {
  await this.call<void>("PUT", `/rest/api/3/issue/${key}`, { fields: { priority: { id: priorityId } } });
}
```

### Client (`client/IssueDetail.tsx`)

```tsx
const getPriorities = useRpc(prioritiesRpc);
const setPriority = useRpc(setPriorityRpc);
const priorities = useQuery({ queryKey: ["jira", "priorities"], queryFn: () => getPriorities({}), staleTime: 10 * 60_000 });
const changePriority = useMutation({
  mutationFn: (priorityId: string) => setPriority({ key: issueKey, priorityId }),
  onSuccess: () => { toast.show("Priority updated", { variant: "success" }); refresh(); },
  onError: fail,
});
// in the JSX, replace the priority text:
<SettingsSelect
  label="Priority"
  value={d.priorityId ?? ""}
  options={(priorities.data?.priorities ?? []).map((p) => ({ value: p.id, label: p.name }))}
  onValueChange={(id) => changePriority.mutate(id)}
  disabled={changePriority.isPending || priorities.isPending}
/>
```

Import `SettingsSelect` from `@getpaseo/plugin/client/ui`.

### Verify

Change priority; header and list row update.

---

## 6. Create issue

### Jira endpoints

- `GET /rest/api/3/project/search?maxResults=50&orderBy=name` → `{ values: [{ id, key, name }], isLast, nextPageToken? }`
- `GET /rest/api/3/issue/createmeta/{projectKey}/issuetypes` → `{ issueTypes: [{ id, name, subtask }] }`
- `POST /rest/api/2/issue` body `{ "fields": { "project": { "key": "ABC" }, "issuetype": { "id": "10001" }, "summary": "...", "description": "plain text" } }` → `{ id, key, self }`

### Contracts

```ts
export const projectsRpc = defineRpc({
  name: "jira.projects",
  input: z.object({}),
  output: z.object({ projects: z.array(z.object({ key: z.string(), name: z.string() })) }),
});
export const issueTypesRpc = defineRpc({
  name: "jira.issue-types",
  input: z.object({ projectKey: z.string() }),
  output: z.object({ types: z.array(z.object({ id: z.string(), name: z.string() })) }),
});
export const createIssueRpc = defineRpc({
  name: "jira.create-issue",
  input: z.object({
    projectKey: z.string().min(1),
    issueTypeId: z.string().min(1),
    summary: z.string().min(1),
    description: z.string(),
  }),
  output: z.object({ key: z.string(), url: z.string() }),
});
```

### Server

```ts
async projects() {
  const page = await this.call<{ values: { key: string; name: string }[] }>(
    "GET",
    "/rest/api/3/project/search?maxResults=50&orderBy=name",
  );
  return { projects: page.values.map((p) => ({ key: p.key, name: p.name })) };
}
async issueTypes(projectKey: string) {
  const meta = await this.call<{ issueTypes: { id: string; name: string; subtask: boolean }[] }>(
    "GET",
    `/rest/api/3/issue/createmeta/${projectKey}/issuetypes`,
  );
  return { types: meta.issueTypes.filter((t) => !t.subtask).map((t) => ({ id: t.id, name: t.name })) };
}
async createIssue(input: { projectKey: string; issueTypeId: string; summary: string; description: string }) {
  const created = await this.call<{ key: string }>("POST", "/rest/api/2/issue", {
    fields: {
      project: { key: input.projectKey },
      issuetype: { id: input.issueTypeId },
      summary: input.summary,
      ...(input.description.trim() ? { description: input.description } : {}),
    },
  });
  return { key: created.key, url: this.url(created.key) };
}
```

### Draft store (`client/state.ts`)

```ts
export interface IssueDraft { projectKey: string; issueTypeId: string; summary: string; description: string }
let draft: IssueDraft = { projectKey: "", issueTypeId: "", summary: "", description: "" };
const draftListeners = new Set<() => void>();
export function setIssueDraft(patch: Partial<IssueDraft>) {
  draft = { ...draft, ...patch };
  for (const l of draftListeners) l();
}
export function clearIssueDraft() {
  setIssueDraft({ summary: "", description: "" }); // keep project/type as next-time defaults
}
export function useIssueDraft(): IssueDraft {
  return useSyncExternalStore(
    (l) => { draftListeners.add(l); return () => draftListeners.delete(l); },
    () => draft,
  );
}
```

Module state survives dialog dismiss but not app restart, matching Orca's behavior.

### Client modal (`client/CreateIssueModal.tsx`)

```tsx
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { View } from "react-native";
import { createIssueRpc, issueTypesRpc, projectsRpc } from "../shared/rpc";
import { clearIssueDraft, setIssueDraft, useIssueDraft } from "./state";
import { Button, Field, Input, useStyles } from "./ui";

interface Props {
  theme: PluginTheme;
  compact: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  onCreated(key: string): void;
}

export function CreateIssueModal({ theme, compact, open, onOpenChange, onCreated }: Props) {
  const s = useStyles(theme, compact);
  const toast = useToast();
  const qc = useQueryClient();
  const draft = useIssueDraft();
  const listProjects = useRpc(projectsRpc);
  const listTypes = useRpc(issueTypesRpc);
  const createIssue = useRpc(createIssueRpc);

  const projects = useQuery({ queryKey: ["jira", "projects"], queryFn: () => listProjects({}), enabled: open, staleTime: 10 * 60_000 });
  const types = useQuery({
    queryKey: ["jira", "issue-types", draft.projectKey],
    queryFn: () => listTypes({ projectKey: draft.projectKey }),
    enabled: open && !!draft.projectKey,
    staleTime: 10 * 60_000,
  });
  useEffect(() => {
    if (!draft.projectKey && projects.data?.projects.length) setIssueDraft({ projectKey: projects.data.projects[0].key });
  }, [draft.projectKey, projects.data]);
  useEffect(() => {
    const list = types.data?.types ?? [];
    if (list.length && !list.some((t) => t.id === draft.issueTypeId)) setIssueDraft({ issueTypeId: list[0].id });
  }, [draft.issueTypeId, types.data]);

  const create = useMutation({
    mutationFn: () => createIssue(draft),
    onSuccess: ({ key }) => {
      clearIssueDraft();
      void qc.invalidateQueries({ queryKey: ["jira", "search"] });
      toast.show(`Created ${key}`, { variant: "success" });
      onOpenChange(false);
      onCreated(key);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  return (
    <Modal title="New Jira issue" open={open} onOpenChange={onOpenChange}>
      <Modal.Content>
        <SettingsSelect
          label="Project"
          value={draft.projectKey}
          options={(projects.data?.projects ?? []).map((p) => ({ value: p.key, label: `${p.key} · ${p.name}` }))}
          onValueChange={(projectKey) => setIssueDraft({ projectKey })}
          disabled={projects.isPending}
        />
        <SettingsSelect
          label="Type"
          value={draft.issueTypeId}
          options={(types.data?.types ?? []).map((t) => ({ value: t.id, label: t.name }))}
          onValueChange={(issueTypeId) => setIssueDraft({ issueTypeId })}
          disabled={types.isPending}
        />
        <Field s={s} label="Summary">
          <Input s={s} value={draft.summary} onChangeText={(summary) => setIssueDraft({ summary })} autoFocus />
        </Field>
        <Field s={s} label="Description">
          <Input s={s} value={draft.description} onChangeText={(description) => setIssueDraft({ description })} multiline style={{ minHeight: compact ? 120 : 180 }} />
        </Field>
        <View style={[s.row, { justifyContent: "flex-end" }]}>
          <Button s={s} ghost label="Cancel" onPress={() => onOpenChange(false)} />
          <Button s={s} label={create.isPending ? "Creating…" : "Create"} onPress={() => create.mutate()} disabled={create.isPending || !draft.summary.trim() || !draft.issueTypeId} />
        </View>
      </Modal.Content>
    </Modal>
  );
}
```

Cancel / Escape / backdrop all route through `onOpenChange(false)` and touch nothing, so the draft persists.

### Wiring

`client/IssuesSurface.tsx`: `const [newOpen, setNewOpen] = useState(false);`; add `<Button s={s} label="New issue" onPress={() => setNewOpen(true)} />` to the chip row; render `<CreateIssueModal theme={theme} compact={layout.compact} open={newOpen} onOpenChange={setNewOpen} onCreated={setSelected} />`.

Command Center entry in `index.client.tsx` (opens the surface; the user then presses "New issue" — 0.8.0 has no way to open a modal from a command directly, so keep it simple):

```ts
client.addCommandCenterItem({
  id: "new-issue",
  title: "Jira: new issue",
  icon: "CirclePlus",
  keywords: ["jira", "create", "ticket"],
  context: "global",
  onSelect: ({ openSurface }) => openSurface("issues"),
});
```

### Verify

Type text, dismiss, reopen → text restored. Create → toast, list refreshes, new issue opens in detail pane, summary/description cleared, project/type remembered.

---

## 7. Link PR to the issue

### Jira endpoint

`POST /rest/api/3/issue/{key}/remotelink` body `{ "globalId": "paseo:<workspaceId>", "object": { "url": "...", "title": "..." } }` → 201. Reusing the same `globalId` updates rather than duplicates.

### Server

`server/jira.ts`:

```ts
async addRemoteLink(key: string, globalId: string, url: string, title: string) {
  await this.call<unknown>("POST", `/rest/api/3/issue/${key}/remotelink`, { globalId, object: { url, title } });
}
```

`server/turn-ended.ts`, after the comment is posted (inside `onTurnEnded`, reuse `jira`, `key`, `agent`):

```ts
const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/;
const prUrl = [...timeline].reverse().flatMap((item) => {
  if (item.type === "assistant_message") return [item.text];
  if (item.type === "tool_call") return [JSON.stringify(item)];
  return [];
}).map((text) => text.match(PR_URL)?.[0]).find(Boolean);
if (prUrl) {
  await jira.addRemoteLink(key, `paseo:${agent.workspaceId}`, prUrl, `Pull request ${prUrl.split("/pull/")[1]}`);
}
```

Stringifying the tool call item is deliberate: tool result shapes differ per provider, and the URL is all we need. Check `ToolCallTimelineItem` in `@getpaseo/protocol/dist/agent-types.d.ts` if you want a narrower read.

### Verify

Agent runs `gh pr create`; after the turn, Jira's issue sidebar shows a web link "Pull request N".

---

## 8. Multi-site (only when a second Atlassian site is actually used)

### Settings migration

```ts
const SiteSchema = z.object({
  id: z.string(),
  label: z.string(),
  siteUrl: z.string(),
  email: z.string(),
  apiToken: z.string(),
});

export const jiraSettings = defineSettings({
  id: "connection",
  scope: "host",
  version: 2,
  schema: z.object({
    sites: z.array(SiteSchema).default([]),
    // defaults unchanged ...
  }),
  migrate: (values, fromVersion) => {
    if (fromVersion !== 1) return values;
    const v = values as { siteUrl?: string; email?: string; apiToken?: string };
    const { siteUrl, email, apiToken, ...rest } = v;
    return {
      ...rest,
      sites: siteUrl ? [{ id: "default", label: new URL(siteUrl).hostname, siteUrl, email: email ?? "", apiToken: apiToken ?? "" }] : [],
    };
  },
});
```

### Server

`Jira.load(siteId?: string)`: pick `sites.find((s) => s.id === siteId) ?? sites[0]`. Every RPC input gains `siteId: z.string().optional()`. Attachment search fans out: `Promise.allSettled(sites.map((s) => Jira.for(s).searchIssues(jql, 5)))`, subtitle prefixed with `site.label`, `id` becomes `${site.id}:${key}`.

### Client

- Surface: site chip row above the filters; selected site id kept in `useState`, threaded into every RPC call and query key.
- `IssuePanel`: try each site in order until one resolves (small `useQueries`), or store `siteId` in the workspace title suffix `[label]` when created from the modal. The title suffix is cheaper.
- Settings screen: list of site cards with add/remove; each card is the current three inputs plus a label.

Cost: touches every file. Defer until needed.

---

## 9. Custom fields (only if a specific field matters)

### Jira endpoints

- `GET /rest/api/3/issue/{key}/editmeta` → `{ fields: { [fieldId]: { name, schema: { type }, allowedValues?: [{ id, value|name }], operations } } }`
- `PUT /rest/api/3/issue/{key}` body `{ "fields": { "customfield_10042": <value> } }` → 204

### Plan

1. Settings: `visibleCustomFields: z.array(z.string()).default([])` (field ids) edited as a comma-separated `SettingsInput`.
2. `editMetaRpc { key } → { fields: [{ id, name, type, allowedValues?: [{ id, label }] }] }` filtered to the visible ids and to types `string | number | option | date`.
3. `setFieldRpc { key, fieldId, value: z.union([z.string(), z.number(), z.null()]) }`; for `option` type send `{ id }`.
4. Fetch the field values with the issue by adding the visible ids to `FULL_FIELDS` at request time (`Jira.issue(key, extraFields)`); expose them as `custom: z.record(z.string(), z.unknown())` on `IssueSchema`.
5. Render in `IssueDetail` under the description card: `SettingsSelect` for `option`, `Input` for `string`/`number`, `Input` with `YYYY-MM-DD` placeholder for `date`.

Hard-code the one field id first if only one matters; generalize after.

---

## 10. Jira URL or key in Paseo's Create workspace dialog

0.8.0 has no hook into the dialog UI, but `server.before("workspace.create")` sees the request. Rewrite the title and pre-fill the first prompt when the title is a Jira URL or bare key.

`server/workspace-create.ts`:

```ts
import type { PluginBeforeRequests } from "@getpaseo/plugin/server";
import { buildPrompt, workspaceTitle } from "../shared/prompt";
import { Jira } from "./jira";

const BROWSE_URL = /https?:\/\/[^\s/]+\/browse\/([A-Z][A-Z0-9_]+-\d+)/i;

export async function beforeWorkspaceCreate({ request }: { request: PluginBeforeRequests["workspace.create"] }) {
  const title = request.title?.trim() ?? "";
  // Only act when the whole title is a browse URL or a bare key; leave normal titles alone.
  const key = title.match(BROWSE_URL)?.[1]?.toUpperCase() ?? title.toUpperCase().match(/^([A-Z][A-Z0-9_]+-\d+)$/)?.[1];
  if (!key) return;
  const issue = await (await Jira.load()).issue(key);
  const source =
    request.source.kind === "worktree" && !request.source.branchName && request.source.action !== "checkout"
      ? { ...request.source, branchName: branchName(issue) }
      : request.source;
  return {
    ...request,
    title: workspaceTitle(issue),
    source,
    firstAgentContext: request.firstAgentContext?.prompt
      ? request.firstAgentContext
      : { ...request.firstAgentContext, prompt: buildPrompt(issue) },
  };
}
```

(Import `branchName` alongside `buildPrompt`/`workspaceTitle` from `../shared/prompt`.) Register in `index.server.ts`:

```ts
const offCreate = server.before("workspace.create", (input) =>
  beforeWorkspaceCreate(input).catch((error) => {
    console.error("[jira] workspace.create:", error);
    return undefined; // keep the original request on any failure
  }),
);
```

and call `offCreate()` in cleanup. `PluginBeforeRequests` is exported from `@getpaseo/plugin/server` (see `lifecycle.d.ts`). The hook must return `undefined` when it does not want to change anything.

### Verify

Paste `https://your-site.atlassian.net/browse/ABC-123` (or type `ABC-123`) as the name in Paseo's Create workspace dialog → workspace titled `ABC-123 Summary`, branch `ABC-123-slug` when worktree mode, composer pre-filled with the prompt. A normal title is untouched.

---

## 11. SDK cleanups as Paseo releases land

Check `node_modules/@getpaseo/plugin/dist` after each `npm update @getpaseo/plugin`:

- `registerSettings` returns a handle (`{ read(), subscribe() }`) → delete `loadSettings()` in `server/jira.ts`, have `Jira.load()` read from the handle, drop the install-id assumption and its `NOTE:` comment.
- Manifest accepts `description` → add `"description": "Browse Jira Cloud issues, comment, transition, and create worktrees from issues"` back to `paseo-plugin.json`.
- `ExternalLink` exported from `@getpaseo/plugin/client/ui` → replace the "View on Jira" `Pressable` + `Linking.openURL` in `client/IssueDetail.tsx`.
- A way to open a plugin modal from a Command Center item → make "Jira: new issue" open `CreateIssueModal` directly (item 6).
- Raise `requirements.paseo` in `paseo-plugin.json` when adopting any of these.
