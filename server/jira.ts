import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { Issue, IssueRow } from "../shared/rpc";
import { jiraSettings, type JiraSettings } from "../shared/settings";
import { adfToMarkdown } from "./adf";

const SETTINGS_HINT = "Configure Jira in Settings → Plugins → Jira.";

// NOTE: in Paseo 0.8.0 registerSettings() returns void, so the subprocess reads the host's settings
// file directly (<PASEO_HOME>/plugin-settings/<installId>/<settingsId>.json). Replace with the
// SDK settings handle when one exists. Install id is assumed to be the manifest id "jira".
export async function loadSettings(): Promise<JiraSettings> {
  const raw = process.env.PASEO_HOME ?? "~/.paseo";
  const home = raw.startsWith("~") ? path.join(homedir(), raw.slice(1)) : raw;
  const file = path.join(home, "plugin-settings", "jira", `${jiraSettings.id}.json`);
  let values: unknown = {};
  try {
    values = z.object({ values: z.unknown() }).parse(JSON.parse(await readFile(file, "utf8"))).values;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  return jiraSettings.schema.parse(values ?? {});
}

const ROW_FIELDS = ["summary", "status", "priority", "issuetype", "assignee", "updated"];
const FULL_FIELDS = [...ROW_FIELDS, "description", "created", "reporter", "labels", "comment"];

interface RawIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    status: { name: string; statusCategory?: { key?: string } };
    priority?: { name: string } | null;
    issuetype: { name: string };
    assignee?: { displayName: string } | null;
    reporter?: { displayName: string } | null;
    updated: string;
    created?: string;
    description?: unknown;
    labels?: string[];
    comment?: {
      comments: { id: string; author?: { displayName: string }; created: string; body: unknown }[];
    };
  };
}

export class Jira {
  private constructor(private readonly base: string, private readonly auth: string) {}

  static async load(): Promise<Jira> {
    const s = await loadSettings();
    if (!s.siteUrl || !s.email || !s.apiToken) throw new Error(SETTINGS_HINT);
    const auth = Buffer.from(`${s.email}:${s.apiToken}`).toString("base64");
    return new Jira(s.siteUrl.replace(/\/+$/, ""), `Basic ${auth}`);
  }

  private async call<T>(method: string, route: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}${route}`, {
      method,
      headers: {
        Authorization: this.auth,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(await describeFailure(res));
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async myself() {
    const me = await this.call<{ accountId: string; displayName: string }>("GET", "/rest/api/3/myself");
    return { accountId: me.accountId, displayName: me.displayName };
  }

  async search(jql: string, nextPageToken?: string, fields = ROW_FIELDS, maxResults = 50) {
    const page = await this.call<{ issues: RawIssue[]; nextPageToken?: string | null }>(
      "POST",
      "/rest/api/3/search/jql",
      { jql, fields, maxResults, nextPageToken },
    );
    return { issues: page.issues, nextPageToken: page.nextPageToken ?? undefined };
  }

  async searchRows(jql: string, nextPageToken?: string) {
    const page = await this.search(jql, nextPageToken);
    return { issues: page.issues.map((i) => this.row(i)), nextPageToken: page.nextPageToken };
  }

  /** Full issues from one search call (no transitions). */
  async searchIssues(jql: string, maxResults: number): Promise<Issue[]> {
    const page = await this.search(jql, undefined, FULL_FIELDS, maxResults);
    return page.issues.map((i) => this.full(i, []));
  }

  async issue(key: string): Promise<Issue> {
    const [raw, tr] = await Promise.all([
      this.call<RawIssue>("GET", `/rest/api/3/issue/${key}?fields=${FULL_FIELDS.join(",")}`),
      this.call<{ transitions: { id: string; name: string; to: { name: string } }[] }>(
        "GET",
        `/rest/api/3/issue/${key}/transitions`,
      ),
    ]);
    return this.full(raw, tr.transitions.map((t) => ({ id: t.id, name: t.name, to: t.to.name })));
  }

  /** v2 accepts plain text; v3 requires ADF. */
  async addComment(key: string, body: string) {
    const c = await this.call<{ id: string }>("POST", `/rest/api/2/issue/${key}/comment`, { body });
    return { id: c.id };
  }

  async transition(key: string, transitionId: string) {
    await this.call<void>("POST", `/rest/api/3/issue/${key}/transitions`, {
      transition: { id: transitionId },
    });
  }

  url(key: string) {
    return `${this.base}/browse/${key}`;
  }

  private row(i: RawIssue): IssueRow {
    const f = i.fields;
    return {
      key: i.key,
      summary: f.summary,
      status: f.status.name,
      statusCategory: f.status.statusCategory?.key ?? "new",
      priority: f.priority?.name ?? null,
      issuetype: f.issuetype.name,
      assignee: f.assignee?.displayName ?? null,
      updated: f.updated,
      url: this.url(i.key),
    };
  }

  private full(i: RawIssue, transitions: Issue["transitions"]): Issue {
    const f = i.fields;
    // NOTE: fields.comment caps at ~20 most recent comments; page GET /issue/{key}/comment if needed.
    return {
      ...this.row(i),
      description: adfToMarkdown(f.description),
      created: f.created ?? f.updated,
      reporter: f.reporter?.displayName ?? null,
      labels: f.labels ?? [],
      comments: (f.comment?.comments ?? []).map((c) => ({
        id: c.id,
        author: c.author?.displayName ?? "unknown",
        created: c.created,
        body: adfToMarkdown(c.body),
      })),
      transitions,
    };
  }
}

async function describeFailure(res: Response): Promise<string> {
  if (res.status === 401 || res.status === 403) return `Jira rejected the credentials. ${SETTINGS_HINT}`;
  if (res.status === 404) return "Jira issue not found.";
  if (res.status === 429) {
    const wait = res.headers.get("Retry-After");
    return `Jira rate limit reached.${wait ? ` Retry in ${wait}s.` : ""}`;
  }
  let detail = "";
  try {
    const body = (await res.json()) as { errorMessages?: string[]; errors?: Record<string, string> };
    detail = [...(body.errorMessages ?? []), ...Object.values(body.errors ?? {})].join("; ");
  } catch {
    // ignore non-JSON bodies
  }
  return `Jira request failed with HTTP ${res.status}${detail ? `: ${detail}` : ""}`;
}
