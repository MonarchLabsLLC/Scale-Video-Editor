# Scale Video Editor

Chat with your coding agent and watch your video get made.

Scale Video Editor is a free, open-source desktop app for macOS, Windows and Linux. You describe a video, or pick one of 15 formats and answer a few questions. Your own agent, **Claude Code** or **Codex**, does the production, and you watch the result in the preview beside the chat. The timeline lives in **[FilmCraft](https://github.com/storytold/filmcraft)**, an open-source video editor that the agent drives through its MCP server.

There is no account and no sign-in. The editor has no AI of its own: it runs the agent you already use, with your own plan.

## Install

**Easiest: give a prompt to your agent.** Open [INSTALL-PROMPT.md](INSTALL-PROMPT.md), copy the prompt, and paste it into Claude Code or Codex. It installs the editor and FilmCraft, checks them, and tells you how to open the editor.

**By hand:**

```bash
git clone https://github.com/MonarchLabsLLC/Scale-Video-Editor.git
cd Scale-Video-Editor
npm install
npm start
```

You also need:

- Node.js 20 or newer.
- At least one agent: [Claude Code](https://docs.claude.com/en/docs/claude-code) (`npm install -g @anthropic-ai/claude-code`, then run `claude` and type `/login`) or [Codex](https://developers.openai.com/codex/cli) (`npm install -g @openai/codex`). Cursor, Grok Build, Antigravity and OpenCode also work. Sign in from **Settings → Agents → Connect**.
- [FilmCraft](https://github.com/storytold/filmcraft/releases/latest): the app **and** its command-line tool `filmcraft-cli`, the same version. The chat works without FilmCraft, but the timeline needs it.

Ready-made `.dmg`, `.exe` and `.AppImage` files will be on the [Releases](https://github.com/MonarchLabsLLC/Scale-Video-Editor/releases) page when a version is tagged. They are not code-signed yet, so macOS and Windows show a warning the first time you open them.

## How it works

| Part | What it does |
|---|---|
| **Home** | A prompt box and the format library. Each format has a fill-in brief. Click one and the editor asks you each blank as a question, then sends the finished brief. **Fast prompt** lets the agent choose the open options. |
| **Project** | Chat on the left, preview on the right. Every project is a normal folder in `Documents/Scale Video Editor/<name>` with `media`, `work` and `exports` inside. Anything the agent exports to `exports` plays in the preview. |
| **Agent** | The editor starts the agent's headless mode (`claude -p`, `codex exec`, `cursor-agent -p`, `grok -p`, `agy -p` or `opencode run`) in the project folder for each message and reads its JSON event stream. Conversations continue with the agent's own session id. Switch agents per project from the picker under the chat box. |
| **Connect** | **Settings → Agents** shows a green **Connected** dot for each signed-in agent, or a **Connect** button. Connect runs the agent's own sign-in: Claude Code, Codex, Cursor and Grok Build open their sign-in page in your browser (sign in, allow access, and you are sent back); Antigravity and OpenCode open a Terminal window with their sign-in. Either way the agent uses your own subscription, and the editor never sees a password or key. Grok Build, Antigravity and OpenCode are marked beta. |
| **Tools** | Every tool in the Scale Video Toolkit, what it does and whether it is ready on this computer, read from the toolkit's own `tools/verify-install.sh`. |
| **Setup** | What this computer still needs. **Install** runs the toolkit's installer for that one part (only the known install steps) and shows the log. Keys you add yourself in Terminal. |
| **FilmCraft** | **Connect FilmCraft** starts the FilmCraft app with its control bridge. The agent gets FilmCraft's MCP server (`filmcraft-cli mcp --bridge`) for that turn. The **FilmCraft timeline** tab renders the Program frame at any point of the sequence. |

The editor never modifies FilmCraft. It uses only FilmCraft's public CLI, control bridge and MCP server, so FilmCraft can update on its own schedule. The editor shows when a newer FilmCraft release is out.

The FilmCraft control token is kept in `~/.config/filmcraft/control.env` (owner-only). It is passed to FilmCraft and its CLI through the environment only. It never appears in an agent's configuration, on a command line or in the window.

### Toolkit Guide

**Toolkit Guide** in the sidebar (or **Chat about this video** on a card) opens a chat that recommends the right kind of video and helps write the request. It is the same guide as on the Scale Plus dashboard, with the same knowledge base. Questions go to a Scale Plus route that holds the chat service's key, so no key is in this app. Set `SVE_GUIDE_URL` to point it at another server for testing.

### Updates

The editor checks GitHub for a new version every time it starts, and every six hours while it is open. **Settings → Check for updates** (or **Check for Updates…** in the app menu) checks at once. When a new version is out, a card in the sidebar says so: click **Update now**, then **Restart to finish**.

- Installed from source (the install prompt): it runs `git pull --ff-only` on `main`, and `npm install` when the dependencies changed. It does not update a copy that has uncommitted changes or is on another branch; it tells you why instead.
- Installed from a `.dmg`, `.exe` or `.AppImage`: it downloads the new release in the background and installs it on restart. macOS allows this only for a code-signed app, so until the releases are signed the Mac version offers the download page instead.

### Access

- **Standard** (default): Codex runs in its workspace sandbox with network on. Claude Code runs with edits accepted and a fixed list of allowed tools (files, shell, web, FilmCraft).
- **Full access**: the agent runs any command without asking. Use it only when you trust the work.

### Scale Video Toolkit

If the [Scale Video Toolkit](https://scale.gg) is installed in `~/Scale-Video-Toolkit`, the agent reads its `CLAUDE.md` to choose the right specialist tool for each kind of video. Without it, the agent works with the tools it has.

## Develop

```bash
npm start      # run the app
npm test       # unit tests (brief parser, agent arguments and event parsing, updater)
npm run dist   # build an installer for this platform into dist/
```

On macOS, `npm install` also renames the local Electron copy in `node_modules` to "Scale Video Editor" with the Scale.gg icon (`scripts/brand-dev-app.js`), so the Dock does not say Electron when you run from source.

`SVE_SNAPSHOT=<folder> npm start` renders each screen in a hidden window, saves PNGs to the folder, and quits. `SVE_PROJECTS_ROOT=<folder>` uses another projects folder.

| Folder | Contents |
|---|---|
| `main/` | Electron main process: `agents.js` (Claude Code and Codex runner), `filmcraft.js` (bridge, status, frames, updates), `filmcraft-mcp.js` (MCP launcher), `projects.js` |
| `renderer/` | The window: plain HTML, CSS and JavaScript, no build step |
| `renderer/data/formats.js` | The 15 formats and their fill-in briefs |
| `test/` | Node unit tests |

## License

MIT. FilmCraft is a separate project under the Apache-2.0 license by its authors, and it is not bundled with this app.
