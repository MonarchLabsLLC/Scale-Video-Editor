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
- At least one agent, signed in: [Claude Code](https://docs.claude.com/en/docs/claude-code) (`npm install -g @anthropic-ai/claude-code`, then run `claude` and type `/login`) or [Codex](https://developers.openai.com/codex/cli) (`npm install -g @openai/codex`, then `codex login`).
- [FilmCraft](https://github.com/storytold/filmcraft/releases/latest): the app **and** its command-line tool `filmcraft-cli`, the same version. The chat works without FilmCraft, but the timeline needs it.

Ready-made `.dmg`, `.exe` and `.AppImage` files will be on the [Releases](https://github.com/MonarchLabsLLC/Scale-Video-Editor/releases) page when a version is tagged. They are not code-signed yet, so macOS and Windows show a warning the first time you open them.

## How it works

| Part | What it does |
|---|---|
| **Home** | A prompt box and the format library. Each format has a fill-in brief. Click one and the editor asks you each blank as a question, then sends the finished brief. **Fast prompt** lets the agent choose the open options. |
| **Project** | Chat on the left, preview on the right. Every project is a normal folder in `Documents/Scale Video Editor/<name>` with `media`, `work` and `exports` inside. Anything the agent exports to `exports` plays in the preview. |
| **Agent** | The editor starts `claude -p` or `codex exec` in the project folder for each message and reads its JSON event stream. Conversations continue with the agent's own session id. Switch agents per project from the picker under the chat box. |
| **FilmCraft** | **Connect FilmCraft** starts the FilmCraft app with its control bridge. The agent gets FilmCraft's MCP server (`filmcraft-cli mcp --bridge`) for that turn. The **FilmCraft timeline** tab renders the Program frame at any point of the sequence. |

The editor never modifies FilmCraft. It uses only FilmCraft's public CLI, control bridge and MCP server, so FilmCraft can update on its own schedule. The editor shows when a newer FilmCraft release is out.

The FilmCraft control token is kept in `~/.config/filmcraft/control.env` (owner-only). It is passed to FilmCraft and its CLI through the environment only. It never appears in an agent's configuration, on a command line or in the window.

### Access

- **Standard** (default): Codex runs in its workspace sandbox with network on. Claude Code runs with edits accepted and a fixed list of allowed tools (files, shell, web, FilmCraft).
- **Full access**: the agent runs any command without asking. Use it only when you trust the work.

### Scale Video Toolkit

If the [Scale Video Toolkit](https://scale.gg) is installed in `~/Scale-Video-Toolkit`, the agent reads its `CLAUDE.md` to choose the right specialist tool for each kind of video. Without it, the agent works with the tools it has.

## Develop

```bash
npm start      # run the app
npm test       # unit tests (brief parser, agent arguments and event parsing)
npm run dist   # build an installer for this platform into dist/
```

`SVE_SNAPSHOT=<folder> npm start` renders each screen in a hidden window, saves PNGs to the folder, and quits. `SVE_PROJECTS_ROOT=<folder>` uses another projects folder.

| Folder | Contents |
|---|---|
| `main/` | Electron main process: `agents.js` (Claude Code and Codex runner), `filmcraft.js` (bridge, status, frames, updates), `filmcraft-mcp.js` (MCP launcher), `projects.js` |
| `renderer/` | The window: plain HTML, CSS and JavaScript, no build step |
| `renderer/data/formats.js` | The 15 formats and their fill-in briefs |
| `test/` | Node unit tests |

## License

MIT. FilmCraft is a separate project under the Apache-2.0 license by its authors, and it is not bundled with this app.
