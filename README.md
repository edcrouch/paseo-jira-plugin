# Paseo Jira plugin

Jira Cloud inside [Paseo](https://paseo.sh). Browse and look up issues, read descriptions and comments, post comments, move issues through their workflow, and turn any issue into a git worktree with a coding agent already working from a prompt built from the issue.

Inspired by the Jira integration in [Orca](https://www.onorca.dev/docs/review/jira).

## Features

- **Jira sidebar.** Filters for *My open* (configurable JQL), *Recent*, and custom JQL, with paginated results and a detail pane. It's side by side on desktop and stacked on mobile.
- **Go to issue.** Type any key (`abc-123`) or paste a `…/browse/ABC-123` URL to open that issue directly.
- **Issue detail.** Shows summary, status, type, priority, assignee, labels, the description, and comments, all rendered from Atlassian Document Format to readable text. You can post comments, apply any available workflow transition, and open the issue on Jira.
- **Create worktree from an issue.** A confirm dialog prefills everything and lets you edit it first:
  - Paseo project (remembered per Jira project)
  - Branch name (`ABC-123-short-summary`) and base ref
  - Agent provider, model, reasoning level, and mode (your last pick is remembered)
  - The prompt: issue text, comments, and an instruction to implement it

  The worktree is titled `ABC-123 Summary` so it stays tied to the issue. You can also skip starting an agent and just draft the prompt in the composer.
- **Jira issue workspace panel.** Shows the issue whose key appears in the current workspace's title.
- **Attach Jira issue.** A composer attachment source. Search by key, URL, or text to send an issue snapshot to the agent with your message.
- **`/jira` slash command.** `/jira ABC-123` (or a URL) opens the issue panel. `/jira` on its own opens the sidebar.
- **Command Center (⌘K).** *Jira: browse issues* and *Jira: show linked issue*.

## Requirements

- Paseo **0.8.0 or later**. Loads on 0.8.0 and 0.10.1.
- **Jira Cloud** (`*.atlassian.net`) and an Atlassian API token. Jira Server and Data Center aren't supported.
- Plugins enabled on the Paseo daemon: **Settings → Plugins → Enable plugins**.

## Install

```bash
paseo plugin add edcrouch/paseo-jira-plugin
```

To pin a version, add `--ref <tag or commit>`. No build step or `npm install` is needed; Paseo compiles the plugin and supplies its runtime modules.

Keep the default plugin ID `jira`, which means don't pass `--id`. See [Known limitations](#known-limitations).

## Configure

Open **Settings → Plugins → Jira**:

| Field | Value |
| --- | --- |
| Site URL | `https://your-site.atlassian.net` |
| Email | Your Atlassian account email |
| API token | Create one at [id.atlassian.com → Security → API tokens](https://id.atlassian.com/manage-profile/security/api-tokens) |

Press **Test connection**. It should report *Connected as …*.

Optional defaults on the same screen:

- **Default JQL** drives the *My open* filter.
- **Default provider, reasoning, and mode** preselect the worktree dialog. They update automatically to your last pick.
- **Default base branch** is `main` unless you change it.

## Security

Paseo plugins are trusted, unsandboxed code, so review the source before installing any plugin.

- The API token is stored as plain JSON on the machine running the Paseo daemon, at `$PASEO_HOME/plugin-settings/jira/connection.json` with file mode `0600`. `$PASEO_HOME` defaults to `~/.paseo`. It isn't encrypted. Use a token you can revoke.
- All Jira requests go from the daemon to the site URL you configure. The token never reaches the Paseo app or any other host.
- The plugin reads and writes only what you do in the UI: searches, issue reads, comments, and transitions. It sends nothing in the background.

## Known limitations

- **Plugin ID must be `jira`.** Paseo 0.8's server API can't read plugin settings, so the daemon side reads the settings file from its known path. That path includes the plugin ID.
- **Comments:** only the most recent ~20 comments per issue are shown.
- **Issue link:** a worktree is linked to its issue by the key in the workspace title. Renaming the workspace so the key is gone breaks the link.
- **Single site:** one Jira site per Paseo daemon.

## Development

```bash
git clone https://github.com/edcrouch/paseo-jira-plugin.git
cd paseo-jira-plugin
npm install
npm run typecheck
npm test
paseo plugin install "$PWD"
```

After editing source, run `paseo plugin reload jira` and check `paseo plugin logs jira`. Don't restart the daemon to pick up changes.

```text
paseo-plugin.json   manifest (id, Paseo version range)
index.client.tsx    app entry: sidebar, panel, settings screen, commands, attachment source
index.server.ts     daemon entry: RPC handlers
shared/             zod RPC contracts, settings schema, prompt and branch-name builders
server/             Jira REST client and ADF-to-Markdown converter
client/             React Native UI (works on desktop, web, and mobile)
docs/ROADMAP.md     planned features with implementation notes
```

Client code must use React Native primitives and take every color from `theme.colors`. See the [Paseo plugin docs](https://paseo.sh/docs/plugins).

## Roadmap

Planned features include posting agent results back to Jira, auto-transition on worktree create, assignee and priority editing, full comment paging, issue creation, and linking PRs. Implementation notes for each are in [docs/ROADMAP.md](docs/ROADMAP.md).

## License

[MIT](LICENSE)
