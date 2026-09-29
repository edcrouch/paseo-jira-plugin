import type { PluginServerContext } from "@getpaseo/plugin/server";
import { Jira } from "./server/jira";
import { issueText } from "./shared/prompt";
import {
  addCommentRpc,
  attachSearchRpc,
  issueRpc,
  myselfRpc,
  parseIssueKey,
  searchRpc,
  transitionRpc,
} from "./shared/rpc";
import { jiraSettings } from "./shared/settings";

function jqlEscape(text: string): string {
  return text.replace(/["\\]/g, " ").trim();
}

export default function contribute(server: PluginServerContext) {
  server.registerSettings(jiraSettings);

  server.handle(searchRpc, async ({ jql, nextPageToken }) =>
    (await Jira.load()).searchRows(jql, nextPageToken),
  );

  server.handle(issueRpc, async ({ key }) => (await Jira.load()).issue(key));

  server.handle(addCommentRpc, async ({ key, body }) => (await Jira.load()).addComment(key, body));

  server.handle(transitionRpc, async ({ key, transitionId }) => {
    await (await Jira.load()).transition(key, transitionId);
    return {};
  });

  server.handle(myselfRpc, async () => (await Jira.load()).myself());

  server.handle(attachSearchRpc, async ({ query }) => {
    const jira = await Jira.load();
    const q = query.trim();
    const key = parseIssueKey(q);
    const jql = key
      ? `key = ${key}`
      : q
        ? `text ~ "${jqlEscape(q)}*" ORDER BY updated DESC`
        : "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC";
    const issues = await jira.searchIssues(jql, 10);
    return {
      items: issues.map((issue) => ({
        id: issue.key,
        identifier: issue.key,
        title: issue.summary,
        subtitle: `${issue.status} · ${issue.issuetype}`,
        url: issue.url,
        text: issueText(issue),
        resourceType: "jira-issue",
      })),
    };
  });

  return () => {};
}
