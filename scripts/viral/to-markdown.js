'use strict';
// Writes the Viral Videos playbook (text only: the kit's leak check keeps images of people out) as Markdown for the Scale Video Toolkit (docs/viral-videos.md).
// Run: node scripts/viral/to-markdown.js <kit folder>
const fs = require('node:fs');
const path = require('node:path');
const kit = process.argv[2];
if (!kit) { console.error('usage: node scripts/viral/to-markdown.js <kit folder>'); process.exit(1); }
const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'viral.json'), 'utf8'));
const L = [];
L.push(`# ${d.title}`, '', d.lede, '');
L.push('Text in [brackets] is a placeholder. Fill it from the owner\'s answers. Example stills for each format are shown in the Viral Videos tab of Scale Video Editor.', '');
L.push('## The rules behind every one', '', ...d.rules.map(r => `- ${r}`), '');
L.push('## How to make one', '', ...d.pipeline.map((p, i) => `${i + 1}. **${p.step}.** ${p.detail}`), '');
L.push('## Tools', '', ...d.tools.map(t => `- **${t.name}:** ${t.detail}`), '');
L.push('GenMedia endpoints: stills `google/nano-banana-2.1`; talking clips `fal-ai/veo3.1/image-to-video` (or `fal-ai/veo3.1/fast/image-to-video` for drafts); other motion `kling/v4/image-to-video`; songs `elevenlabs/music/v2.5`. Check `genmedia schema <endpoint>` for inputs and price before a run.', '');
L.push('Before generating video clips, show the owner the script and the stills, say roughly what the clips will cost, and wait for a go-ahead. Never publish or upload the finished video.', '');
L.push('## The formats', '', ...d.formats.map((f, i) => `${i + 1}. [${f.name}](#${f.id}): ${f.tag}`), '');
d.formats.forEach((f, i) => {
  L.push(`<a id="${f.id}"></a>`, `## ${i + 1}. ${f.name}`, '', `*${f.tag}*`, '');
  L.push(`**Use it when:** ${f.when}`, '');
  L.push('### How to run it', '', ...f.steps.map(x => `- ${x}`), '');
  L.push('### Why it works', '', ...f.why.map(x => `- ${x}`), '');
  L.push('### The beats', '', f.beats.join(' → '), '');
  L.push('### Ideas by niche', '', '| Business | Idea |', '|---|---|', ...f.ideas.map(n => `| ${n.who} | ${n.idea} |`), '');
  L.push('### Prompts', '');
  for (const p of f.prompts) L.push(`**${p.label}** (${p.tool})`, '', '```text', p.text, '```', '');
  L.push('### Brief the owner fills in', '', '```text', f.brief, '```', '');
});
const out = path.join(kit, 'docs', 'viral-videos.md');
fs.writeFileSync(out, L.join('\n'));
console.log('wrote', out);
