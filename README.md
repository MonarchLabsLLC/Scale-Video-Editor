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

**Download an installer.** Each [release](https://github.com/MonarchLabsLLC/Scale-Video-Editor/releases/latest) has these files. The links always point to the newest release:

| Computer | File |
|---|---|
| Mac (Apple silicon and Intel) | [Scale-Video-Editor-mac.dmg](https://github.com/MonarchLabsLLC/Scale-Video-Editor/releases/latest/download/Scale-Video-Editor-mac.dmg) |
| Windows 10 or 11 (x64) | [Scale-Video-Editor-Setup.exe](https://github.com/MonarchLabsLLC/Scale-Video-Editor/releases/latest/download/Scale-Video-Editor-Setup.exe) |
| Linux (x64) | [Scale-Video-Editor-linux.AppImage](https://github.com/MonarchLabsLLC/Scale-Video-Editor/releases/latest/download/Scale-Video-Editor-linux.AppImage) |

You still need an agent and FilmCraft (see the list below). The installer does not include them.

### First open: the installers are not code-signed yet

macOS and Windows show a warning the first time you open the app, because the files are not signed by an identified developer yet. The app is the same code as this repository.

**macOS.** Open the `.dmg` and drag **Scale Video Editor** to **Applications**. The first time you open it, macOS says *"Scale Video Editor" Not Opened: Apple could not verify "Scale Video Editor" is free of malware* (older macOS versions say it *cannot be opened because the developer cannot be verified*). To open it:

1. Click **Done** (not **Move to Trash**).
2. Open **System Settings → Privacy & Security**.
3. Scroll down to the message about Scale Video Editor and click **Open Anyway**.
4. Enter your Mac password, then click **Open Anyway** again.

You do this only once. On macOS 14 or older you can also Control-click the app in Applications, choose **Open**, then click **Open**. If macOS ever says the app *is damaged*, run `xattr -dr com.apple.quarantine "/Applications/Scale Video Editor.app"` in Terminal, then open it again.

**Windows.** When you run `Scale-Video-Editor-Setup.exe`, a blue window says *Windows protected your PC* (Microsoft Defender SmartScreen) and only shows **Don't run**. Click **More info**, check that the app is `Scale-Video-Editor-Setup.exe`, then click **Run anyway**. The installer sets the app up for your user account; you do not need to be an administrator. Your browser can also say the file *isn't commonly downloaded*: choose **Keep** (in Edge: **⋯ → Keep → Show more → Keep anyway**).

**Linux.** Make the file executable, then run it: `chmod +x Scale-Video-Editor-linux.AppImage && ./Scale-Video-Editor-linux.AppImage`. Ubuntu 22.04 and newer also need `sudo apt install libfuse2` once.

**Updates.** After the first open, you do not need to download anything again. The app downloads each new version by itself and the sidebar shows **Restart to finish**. On a Mac, keep the app in your **Applications** folder: a copy opened straight from the `.dmg` cannot replace itself, and the sidebar says so.

## How it works

| Part | What it does |
|---|---|
| **Home** | A prompt box and the format library. Each format has a fill-in brief. Click one and the editor asks you each blank as a question, then sends the finished brief. **Fast prompt** lets the agent choose the open options. |
| **Project** | Chat on the left, preview on the right. Every project is a normal folder in `Documents/Scale Video Editor/<name>` with `media`, `work` and `exports` inside. Anything the agent exports to `exports` plays in the preview. |
| **Agent** | The editor starts the agent's headless mode (`claude -p`, `codex exec`, `cursor-agent -p`, `grok -p`, `agy -p` or `opencode run`) in the project folder for each message and reads its JSON event stream. Conversations continue with the agent's own session id. Switch agents per project from the picker under the chat box. |
| **Connect** | **Settings → Agents** shows a green **Connected** dot for each signed-in agent, or a **Connect** button. Connect runs the agent's own sign-in: Claude Code, Codex, Cursor and Grok Build open their sign-in page in your browser (sign in, allow access, and you are sent back); Antigravity and OpenCode open a Terminal window with their sign-in. Either way the agent uses your own subscription, and the editor never sees a password or key. Grok Build, Antigravity and OpenCode are marked beta. |
| **Model and effort** | Next to the agent, choose the model and how hard it thinks (for example Opus 5.5 on Medium, or Fable 5.2 on High). The list comes from the agent you are signed in to on this computer (Claude Code, Codex, Cursor and others), and the app asks each agent for its newest models every time it starts. "Default" keeps the agent's own setting. |
| **Voices** | In Settings → Voices, save your ElevenLabs voices: a Default (No. 1) and two alternates, each with a name and a voice ID. Pick the voice under the prompt box; the agent uses that voice for the voiceover. The voice IDs go in the toolkit's `voice.json`; your ElevenLabs key stays in the Keychain. |
| **Already installed?** | On Setup, click **I have it: find it** on any part (or **Let the agent find them** for all). Choose a folder or search the whole computer. Your agent finds the part and links it where the toolkit looks. It never moves, deletes or downloads anything and never reads your keys. Parts it cannot find keep their Install button. |
| **Brand Guides** | Your brands' design guides (DESIGN.md), kept on this computer in `Documents/Scale Video Editor/Brand Guides`. Upload a `.md`, `.txt`, `.rtf`, `.doc`, `.docx`, `.pdf` or `.html` file, paste a link to a DESIGN.md (getdesign.md links work), or type your website and the editor makes a DESIGN.md from the live page (colors, fonts, button shape and logo). Pick a guide under the prompt box, and the agent makes that video in the style of the guide. It works best for motion graphics: title cards, lower thirds, captions, charts and end cards. Only the design guide is needed, not a brand knowledge document. Get one from BrandBaser or [ClickCampaigns](https://clickcampaigns.ai/welcome) (Brand Kits → Download DESIGN.md file), PageBuilder templates or getdesign.md. |
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
- Installed from a `.dmg`, `.exe` or `.AppImage`: it downloads the new release in the background and installs it on restart. On Windows and Linux this is electron-updater. macOS's own updater accepts only apps signed with a Developer ID, so the unsigned Mac app updates itself (`main/mac-install.js`): it downloads the new `.zip`, checks its SHA-512 from `latest-mac.yml`, the bundle id, the version and the code signature, then swaps the app after it quits and opens the new version. If anything fails, the old version stays. It never sends you to a web page unless a newer release exists and the app cannot replace itself (for example, it runs from the `.dmg`).

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

### Releases

1. Change `"version"` in `package.json` (for example `0.2.0`), merge it to `main`.
2. Tag that commit and push the tag: `git tag v0.2.0 && git push origin v0.2.0`.
3. The **Release** workflow (`.github/workflows/release.yml`) builds the Mac `.dmg` and `.zip` (universal), the Windows `.exe` and the Linux `.AppImage`, and attaches them with the `latest*.yml` files the updater reads to a **draft** release.
4. Open the draft on GitHub, check the files, and click **Publish release**. Until then, the download links above and the in-app updater do not see the new version.

The builds are not code-signed. The Mac app has an ad hoc signature only (`"identity": "-"` in `package.json`), which gives the standard "Open Anyway" warning instead of "is damaged". To sign later: remove `"identity": "-"`, set `"hardenedRuntime": true`, add the Developer ID certificate and notarization secrets to the workflow, and add a Windows signing certificate. Signed Mac builds then update by themselves.

`SVE_SNAPSHOT=<folder> npm start` renders each screen in a hidden window, saves PNGs to the folder, and quits. `SVE_PROJECTS_ROOT=<folder>` uses another projects folder.

| Folder | Contents |
|---|---|
| `main/` | Electron main process: `agents.js` (agent runner), `brands.js` (brand guides: import, site scan, DESIGN.md), `filmcraft.js` (bridge, status, frames, updates), `filmcraft-mcp.js` (MCP launcher), `projects.js` |
| `renderer/` | The window: plain HTML, CSS and JavaScript, no build step |
| `renderer/data/formats.js` | The 15 formats and their fill-in briefs |
| `test/` | Node unit tests |

## License

MIT. FilmCraft is a separate project under the Apache-2.0 license by its authors, and it is not bundled with this app.
