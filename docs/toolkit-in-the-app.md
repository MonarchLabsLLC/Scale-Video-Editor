# The toolkit website, inside the desktop app

The Scale Video Toolkit page in the Scale Plus dashboard has eleven tabs and a chat guide. The page was built for someone who reads, copies a prompt and pastes it into their agent somewhere else. In the desktop app the agent is already one click away, the app can see what is installed on the computer, and it can run the work itself. So most tabs should not be copied as pages. They should become actions.

This is a proposal. Nothing below is built yet except where it says **Done**.

## Tab by tab

| Website tab | What it is for on the web | In the app | Why |
|---|---|---|---|
| Home | Explain the toolkit, show categories and all kinds of video | **Done.** Home has the prompt box, your projects, the category tiles and every kind of video, in the dashboard's card design. | The app's home is where you start a video, so the prompt box stays on top. |
| Marketing, Social media, Animation, Explainers, Viral, Editing studio | One page per category, with its opener band and cards | **Done.** The Formats page has the same tabs, the coloured opener band, "Pick one and say the sentence under it." and the same cards. | Same content, same look. |
| Prompts | A quick ask and a full brief for each video, to copy | **No separate page.** Each card has **Use this sentence** (the quick ask, sent straight to the agent) and **Answer the questions** (the full brief as an interview; "See the prompt your agent gets" shows the brief). Add later: **My prompts**, a list of your own saved prompts and briefs you can reuse. | Copying and pasting is the step the app removes. Saved personal prompts are something only the app can do well. |
| Docs | 21 entries: what each tool does, why it is in the kit, what it needs | **A Tools page that checks this computer.** Each tool shows what it does (from the same docs) plus a live status: ready, not installed, or needs a key or account. A **Set it up** button sends your agent a setup prompt for that one tool. The cards' tool pills open the tool's entry. | The website cannot know what you have. The app can, and "what do I still need for this video?" is the real question. |
| How it works | The four steps, the six production stages, the house rules | **Two small pieces, not a page.** 1) A first-run tour of three screens: describe or pick, watch it build, find the file. 2) While a video is being made, the project shows which stage it is on (voice, picture, music, check, export). The house rules are already in the agent's instructions; Settings gets a short "What every video is held to" list. | People read "how it works" once. Showing the stage while it happens teaches more than a page. |
| Install | The requirements and one install prompt | **A Setup checklist.** On first start, and in Settings: agent installed and signed in, FilmCraft installed and connected, Scale Video Toolkit installed, optional accounts (for example ElevenLabs for voice). Each line has a **Fix** button that runs the install step through your agent. The sidebar status rows open it. | The app is already installed, so the page becomes "what is still missing", with a button for each gap. |
| Ask the Toolkit Guide | A chat that recommends the right video and helps write the prompt | **A Guide panel beside every page**, with **Chat about this video** on each card. The open question is what answers it; see below. | Same feature. The answer engine is the decision. |

## Updates

**Done.** The app checks for a new version on every start and every six hours, has **Check for updates** in Settings and in the app menu, updates with one click, and asks you to restart. See the README for how source and release installs differ.

## The Toolkit Guide: one decision for Mike

On the dashboard, the guide is a ChatBaser agent. The ChatBaser key stays on the dashboard's server, and only signed-in Pro Max members can use it. The desktop app is open source and has no sign-in, so it cannot hold that key: anyone could read it from the code.

| Option | How it works | Cost and risk |
|---|---|---|
| **A. Your own agent answers (recommended)** | The guide panel runs the person's own Claude Code or Codex in a read-only "guide" mode, with the toolkit's knowledge base shipped inside the app. It can also start the project for you when you say yes. | No key, no server, no cost to Scale.gg. Uses the person's own plan. Answers are as good as their agent. |
| B. ChatBaser through a new public endpoint | A new scale.gg endpoint, with no sign-in, holds the key and limits how many messages each computer can send. | Scale.gg pays for every message from every user of a free, open-source app. Needs server work, rate limiting and abuse checks. |
| C. ChatBaser with Scale Plus sign-in | The app signs in to Scale Plus, and the dashboard's existing guide route answers. | Adds sign-in, which you said to leave out for now. Only Pro Max members could use the guide. |

## Suggested order

1. Toolkit Guide (after the decision above).
2. Setup checklist (replaces Install and makes first start smooth).
3. Tools page with live status (replaces Docs).
4. First-run tour and the stage strip in projects (replaces How it works).
5. My prompts.
