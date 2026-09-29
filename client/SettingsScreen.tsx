import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { SettingsAction, SettingsInput, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Text } from "react-native";
import { myselfRpc } from "../shared/rpc";
import { jiraSettings, type JiraSettings } from "../shared/settings";
import { useStyles } from "./ui";

export function SettingsScreen({ theme, layout }: PluginSurfaceProps) {
  const s = useStyles(theme, layout.compact);
  const settings = useSettings(jiraSettings);
  const toast = useToast();
  const myself = useRpc(myselfRpc);
  const [draft, setDraft] = useState<Partial<JiraSettings>>({});

  if (settings.status === "loading") return <Text style={[s.muted, { padding: 16 }]}>Loading…</Text>;
  if (settings.status !== "ready") {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={s.error}>{settings.error}</Text>
        <SettingsAction label="Reset settings" actionLabel="Reset" onPress={() => void settings.reset()} />
      </ScrollView>
    );
  }
  const v = settings.values;
  const merged = { ...v, ...draft };
  const dirty = Object.keys(draft).length > 0;
  const field = (key: keyof JiraSettings) => (text: string) => setDraft((d) => ({ ...d, [key]: text }));

  const save = async () => {
    const ok = await settings.save(merged, settings.revision);
    if (ok) {
      setDraft({});
      toast.show("Jira settings saved", { variant: "success" });
    } else toast.error(settings.saveError ?? "Save failed");
  };
  const test = async () => {
    if (dirty) await save();
    try {
      const me = await myself({});
      toast.show(`Connected as ${me.displayName}`, { variant: "success" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: layout.compact ? 12 : 20, gap: 16 }}>
      <SettingsSection title="Connection" info="Jira Cloud. Create an API token at id.atlassian.com → Security → API tokens. Stored as plain JSON on the daemon host.">
        <SettingsInput label="Site URL" placeholder="https://your-site.atlassian.net" initialValue={v.siteUrl} onChangeText={field("siteUrl")} />
        <SettingsInput label="Email" placeholder="you@example.com" initialValue={v.email} onChangeText={field("email")} />
        <SettingsInput label="API token" initialValue={v.apiToken} onChangeText={field("apiToken")} secureTextEntry />
        <SettingsAction label="Test connection" hint={dirty ? "Saves first" : undefined} actionLabel="Test" onPress={() => void test()} />
      </SettingsSection>
      <SettingsSection title="Defaults">
        <SettingsInput label="Default JQL" hint="Used by the 'My open' filter" initialValue={v.defaultJql} onChangeText={field("defaultJql")} />
        <SettingsInput label="Default provider" hint="provider/model, e.g. claude/claude-opus-5-5. Updated to your last pick on each worktree create." initialValue={v.defaultProvider} onChangeText={field("defaultProvider")} />
        <SettingsInput label="Default reasoning" hint="Reasoning level id, e.g. high. Empty uses the model default." initialValue={v.defaultThinkingOptionId} onChangeText={field("defaultThinkingOptionId")} />
        <SettingsInput label="Default mode" hint="Provider mode id, e.g. acceptEdits" initialValue={v.defaultModeId} onChangeText={field("defaultModeId")} />
        <SettingsInput label="Default base branch" initialValue={v.defaultBaseBranch} onChangeText={field("defaultBaseBranch")} />
      </SettingsSection>
      <SettingsAction label={dirty ? "Unsaved changes" : "All changes saved"} actionLabel={settings.saving ? "Saving…" : "Save"} onPress={() => void save()} disabled={!dirty || settings.saving} />
      {settings.saveError ? <Text style={s.error}>{settings.saveError}</Text> : null}
    </ScrollView>
  );
}
