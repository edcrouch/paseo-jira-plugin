import type { PluginTheme } from "@getpaseo/plugin";
import { usePaseo, useSettings } from "@getpaseo/plugin/client";
import { Modal, useToast } from "@getpaseo/plugin/client/react-native";
import { SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { branchName, buildPrompt, workspaceTitle } from "../shared/prompt";
import type { Issue } from "../shared/rpc";
import { jiraSettings } from "../shared/settings";
import { Button, Field, Input, useStyles } from "./ui";

type Snapshot = Awaited<ReturnType<ReturnType<typeof usePaseo>["providers"]["snapshot"]>>;
type ProviderEntry = Snapshot["entries"][number];
type ProviderModel = NonNullable<ProviderEntry["models"]>[number];

function pickModel(entry: ProviderEntry | undefined, preferred?: string): ProviderModel | undefined {
  const models = entry?.models ?? [];
  return models.find((m) => m.id === preferred) ?? models.find((m) => m.isDefault) ?? models[0];
}

function pickThinking(model: ProviderModel | undefined, preferred?: string): string {
  const options = model?.thinkingOptions ?? [];
  return (
    options.find((o) => o.id === preferred)?.id ??
    options.find((o) => o.id === model?.defaultThinkingOptionId)?.id ??
    options.find((o) => o.isDefault)?.id ??
    options[0]?.id ??
    ""
  );
}

function pickMode(entry: ProviderEntry | undefined, preferred?: string): string {
  return entry?.modes?.find((m) => m.id === preferred)?.id ?? entry?.defaultModeId ?? "";
}

interface Props {
  issue: Issue;
  theme: PluginTheme;
  compact: boolean;
  open: boolean;
  onOpenChange(open: boolean): void;
  onCreated?(workspaceId: string): void;
}

export function CreateWorktreeModal({ issue, theme, compact, open, onOpenChange, onCreated }: Props) {
  const s = useStyles(theme, compact);
  const paseo = usePaseo();
  const toast = useToast();
  const settings = useSettings(jiraSettings);
  const values = settings.status === "ready" ? settings.values : null;
  const jiraProject = issue.key.split("-")[0];

  const projects = useQuery({
    queryKey: ["paseo", "projects"],
    queryFn: async () => (await paseo.projects.list()).projects.filter((p) => p.projectKind === "git"),
    enabled: open,
  });
  const providers = useQuery({
    queryKey: ["paseo", "providers"],
    queryFn: async () => {
      const snapshot = await paseo.providers
        .waitForReady({ timeoutMs: 15_000 })
        .catch(() => paseo.providers.snapshot());
      return snapshot.entries.filter((e) => e.enabled && e.status === "ready" && (e.models?.length ?? 0) > 0);
    },
    enabled: open,
  });

  const [projectId, setProjectId] = useState("");
  const [branch, setBranch] = useState(branchName(issue));
  const [base, setBase] = useState("main");
  const [providerId, setProviderId] = useState("");
  const [modelId, setModelId] = useState("");
  const [thinkingId, setThinkingId] = useState("");
  const [modeId, setModeId] = useState("");
  const [prompt, setPrompt] = useState(buildPrompt(issue));
  const [startAgent, setStartAgent] = useState(true);

  useEffect(() => {
    if (!values) return;
    setBase(values.defaultBaseBranch || "main");
  }, [values]);
  useEffect(() => {
    if (projectId || !projects.data?.length) return;
    const remembered = values?.lastProjectByJiraKey[jiraProject];
    setProjectId(projects.data.find((p) => p.projectId === remembered)?.projectId ?? projects.data[0].projectId);
  }, [projects.data, values, jiraProject, projectId]);

  const entries = providers.data ?? [];
  const entry = entries.find((e) => e.provider === providerId);
  const model = entry?.models?.find((m) => m.id === modelId);

  /** Select a provider and reset model, reasoning, and mode to its defaults (or the given preferences). */
  const chooseProvider = (id: string, prefer: { model?: string; thinking?: string; mode?: string } = {}) => {
    const next = entries.find((e) => e.provider === id);
    const nextModel = pickModel(next, prefer.model);
    setProviderId(id);
    setModelId(nextModel?.id ?? "");
    setThinkingId(pickThinking(nextModel, prefer.thinking));
    setModeId(pickMode(next, prefer.mode));
  };
  const chooseModel = (id: string) => {
    setModelId(id);
    setThinkingId(pickThinking(entry?.models?.find((m) => m.id === id), thinkingId));
  };

  // Initial selection: last pick (stored as settings defaults) when still available, else first ready provider.
  useEffect(() => {
    if (providerId || !entries.length || settings.status === "loading") return;
    const [prefProvider, ...rest] = (values?.defaultProvider ?? "").split("/");
    const initial = entries.find((e) => e.provider === prefProvider) ?? entries[0];
    chooseProvider(initial.provider, {
      model: rest.join("/") || undefined,
      thinking: values?.defaultThinkingOptionId || undefined,
      mode: values?.defaultModeId || undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, providerId, settings.status]);

  const providerOptions = entries.map((e) => ({ value: e.provider, label: e.label ?? e.provider }));
  const modelOptions = (entry?.models ?? [])
    .filter((m) => m.isSelectable !== false)
    .map((m) => ({ value: m.id, label: m.label }));
  const thinkingOptions = (model?.thinkingOptions ?? []).map((o) => ({ value: o.id, label: o.label }));
  const modeOptions = [
    ...(entry?.defaultModeId ? [] : [{ value: "", label: "Provider default" }]),
    ...(entry?.modes ?? []).map((m) => ({ value: m.id, label: m.label })),
  ];

  const create = useMutation({
    mutationFn: async () => {
      const project = projects.data?.find((p) => p.projectId === projectId);
      if (!project) throw new Error("Pick a project");
      if (!branch.trim()) throw new Error("Branch name is required");
      if (startAgent && (!providerId || !modelId)) throw new Error("Pick a provider and model");
      const workspace = await paseo.workspaces.create({
        title: workspaceTitle(issue),
        source: {
          kind: "worktree",
          cwd: project.projectRootPath,
          projectId: project.projectId,
          action: "branch-off",
          branchName: branch.trim(),
          baseBranch: base.trim() || undefined,
        },
        ...(startAgent ? {} : { firstAgentContext: { prompt } }),
      });
      if (startAgent) {
        await workspace.agents.create({
          config: {
            provider: `${providerId}/${modelId}`,
            modeId: modeId || undefined,
            thinkingOptionId: thinkingId || undefined,
          },
          prompt,
          title: issue.key,
        });
      }
      if (settings.status === "ready") {
        const v = settings.values;
        void settings.save(
          {
            ...v,
            lastProjectByJiraKey: { ...v.lastProjectByJiraKey, [jiraProject]: project.projectId },
            // Remember the agent pick for next time; only when an agent was actually configured.
            ...(startAgent
              ? { defaultProvider: `${providerId}/${modelId}`, defaultThinkingOptionId: thinkingId, defaultModeId: modeId }
              : {}),
          },
          settings.revision,
        );
      }
      return workspace.id;
    },
    onSuccess: (workspaceId) => {
      toast.show(`Created worktree for ${issue.key}`, { variant: "success" });
      onOpenChange(false);
      onCreated?.(workspaceId);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });

  return (
    <Modal title={`Create worktree from ${issue.key}`} open={open} onOpenChange={onOpenChange}>
      <Modal.Content>
        <SettingsSelect
          label="Project"
          value={projectId}
          options={(projects.data ?? []).map((p) => ({ value: p.projectId, label: p.projectDisplayName }))}
          onValueChange={setProjectId}
          disabled={projects.isPending}
        />
        <Field s={s} label="Branch">
          <Input s={s} value={branch} onChangeText={setBranch} autoCapitalize="none" autoCorrect={false} />
        </Field>
        <Field s={s} label="Base ref">
          <Input s={s} value={base} onChangeText={setBase} autoCapitalize="none" autoCorrect={false} />
        </Field>
        <SettingsSwitch label="Start agent" hint="Off: open the worktree with the prompt drafted in the composer" value={startAgent} onValueChange={setStartAgent} />
        {startAgent ? (
          <>
            <SettingsSelect
              label="Provider"
              hint={providers.isPending ? "Loading providers…" : undefined}
              value={providerId}
              options={providerOptions}
              onValueChange={(id) => chooseProvider(id)}
              disabled={providers.isPending}
            />
            <SettingsSelect label="Model" value={modelId} options={modelOptions} onValueChange={chooseModel} disabled={!entry} />
            {thinkingOptions.length ? (
              <SettingsSelect label="Reasoning" value={thinkingId} options={thinkingOptions} onValueChange={setThinkingId} />
            ) : null}
            {modeOptions.length ? (
              <SettingsSelect label="Mode" value={modeId} options={modeOptions} onValueChange={setModeId} disabled={!entry} />
            ) : null}
          </>
        ) : null}
        <Field s={s} label="Prompt">
          <Input s={s} value={prompt} onChangeText={setPrompt} multiline style={{ minHeight: compact ? 140 : 220 }} />
        </Field>
        {providers.error || projects.error ? (
          <Text style={s.error}>{String((providers.error ?? projects.error) as Error)}</Text>
        ) : null}
        <View style={[s.row, { justifyContent: "flex-end" }]}>
          <Button s={s} ghost label="Cancel" onPress={() => onOpenChange(false)} />
          <Button s={s} label={create.isPending ? "Creating…" : "Create worktree"} onPress={() => create.mutate()} disabled={create.isPending} />
        </View>
      </Modal.Content>
    </Modal>
  );
}
