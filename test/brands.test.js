const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const brands = require('../main/brands');
const { systemPrompt } = require('../main/agents');

const GOOGLE_FORMAT = `---
version: alpha
name: Acme
description: A bold black-and-white look with a coral accent.

colors:
  primary: "#FF6F61"
  ink: "#050505"
  canvas: "#fcfcfa"

typography:
  display:
    fontFamily: "Geist, system-ui, sans-serif"
    fontWeight: 600
  body:
    fontFamily: "'Inter', sans-serif"
---

# Acme design guide

## Overview
Text.

## Colors
More.
`;

test('parseDesign reads Google DESIGN.md front matter', () => {
  const p = brands.parseDesign(GOOGLE_FORMAT);
  assert.equal(p.name, 'Acme');
  assert.match(p.description, /coral accent/);
  assert.deepEqual(p.colors, [{ name: 'primary', hex: '#ff6f61' }, { name: 'ink', hex: '#050505' }, { name: 'canvas', hex: '#fcfcfa' }]);
  assert.deepEqual(p.fonts, ['Geist', 'Inter']);
  assert.deepEqual(p.sections, ['Overview', 'Colors']);
  assert.equal(p.isDesign, true);
});

test('parseDesign falls back to hex colors and font lines in plain text', () => {
  const p = brands.parseDesign('Our brand\n\nPrimary #123ABC, background #fff, text #222222.\nHeading font: Poppins\nbody { font-family: "Lato", sans-serif; }');
  assert.deepEqual(p.colors.map(c => c.hex), ['#123abc', '#ffffff', '#222222']);
  assert.ok(p.fonts.includes('Poppins') && p.fonts.includes('Lato'));
  assert.equal(p.isDesign, true);
});

test('a brand knowledge document is saved but flagged', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sve-brand-'));
  brands.setRoot(root);
  const g = brands.saveText({ name: 'Story', text: 'We help coaches grow. Our audience is busy founders who want more clients.', source: { kind: 'file', label: 'story.txt' } });
  assert.equal(g.needsGuide, true);
  assert.match(g.warning, /brand knowledge document/);
  assert.match(fs.readFileSync(g.file, 'utf8'), /^# Story design guide/);
});

test('saving, renaming, duplicating and copying into a project', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sve-brand-'));
  brands.setRoot(root);
  const src = path.join(root, '..', `design-${Date.now()}.md`);
  fs.writeFileSync(src, GOOGLE_FORMAT);
  const g = await brands.importFile(src);
  assert.equal(g.name, path.basename(src, '.md'));
  assert.ok(g.uid);
  assert.equal(g.needsGuide, false);
  const r = brands.rename(g.id, 'Acme Inc');
  assert.equal(r.name, 'Acme Inc');
  assert.equal(r.uid, g.uid);
  const d = brands.duplicate(r.id);
  assert.notEqual(d.uid, g.uid);
  assert.throws(() => brands.rename(d.id, 'Acme Inc'), /already exists/);
  assert.equal(brands.list().length, 2);
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'sve-proj-'));
  const info = brands.copyInto(g.uid, proj);
  assert.equal(info.name, 'Acme Inc');
  assert.equal(fs.readFileSync(path.join(proj, 'brand', 'DESIGN.md'), 'utf8'), GOOGLE_FORMAT);
  assert.equal(brands.copyInto('missing', proj), null);
  fs.rmSync(src);
});

test('classifyUrl knows sites, DESIGN.md links and getdesign.md pages', () => {
  assert.deepEqual(brands.classifyUrl('acme.com'), { kind: 'site', url: 'https://acme.com/', page: 'https://acme.com/', host: 'acme.com' });
  assert.equal(brands.classifyUrl('https://getdesign.md/stripe/design-md').url, 'https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/stripe/DESIGN.md');
  assert.equal(brands.classifyUrl('https://github.com/a/b/blob/main/DESIGN.md').url, 'https://raw.githubusercontent.com/a/b/main/DESIGN.md');
  assert.equal(brands.classifyUrl('https://x.com/brand/DESIGN.md').kind, 'doc');
  assert.equal(brands.classifyUrl('https://x.com/guide.pdf').kind, 'pdf');
  assert.throws(() => brands.classifyUrl(''), /Type a website/);
  assert.throws(() => brands.classifyUrl('file:///etc/passwd'), /https/);
  assert.throws(() => brands.classifyUrl('localhost'), /web address/);
});

test('designFromScan writes a DESIGN.md the parser reads back', () => {
  const md = brands.designFromScan({
    url: 'https://acme.com/', host: 'acme.com', title: 'Acme | Home', siteName: 'Acme', description: 'We make rockets.',
    bg: '#ffffff', text: '#111111', headingFont: 'Poppins', headingWeight: '700', h1Size: '56px', bodyFont: 'Inter', bodyWeight: '400', bodySize: '16px',
    linkColor: '#ff5a1f', buttons: [{ bg: '#ff5a1f', color: '#ffffff', radius: '999px' }],
    areas: { '#ffffff': 900000, '#f4f4f4': 200000, '#0b2545': 150000 }, textColors: { '#111111': 4000, '#6b6b6b': 900 }, vars: {}, logoSaved: true
  }, new Date('2026-11-22T00:00:00Z'));
  const p = brands.parseDesign(md);
  assert.equal(p.name, 'Acme');
  const byName = Object.fromEntries(p.colors.map(c => [c.name, c.hex]));
  assert.equal(byName.canvas, '#ffffff');
  assert.equal(byName.ink, '#111111');
  assert.equal(byName.primary, '#ff5a1f');
  assert.equal(byName['on-primary'], '#ffffff');
  assert.equal(byName['ink-muted'], '#6b6b6b');
  assert.equal(byName['accent-1'], '#0b2545');
  assert.deepEqual(p.fonts, ['Poppins', 'Inter']);
  assert.match(md, /2026-11-22/);
  assert.match(md, /The logo is saved next to this file/);
});

test('HTML styles are kept when a file is read as text', () => {
  const extra = brands.stylesFound('<style>h1{color:#FF0000;font-family:"Oswald",sans-serif}</style>');
  assert.match(extra, /#ff0000/);
  assert.match(extra, /Oswald/);
});

test('the agent is told to use the brand guide', () => {
  const p = systemPrompt({ projectDir: '/p', brand: { name: 'Acme', file: 'brand/DESIGN.md', logo: 'brand/logo.png' } });
  assert.match(p, /"Acme" brand/);
  assert.match(p, /brand\/DESIGN\.md/);
  assert.match(p, /brand\/logo\.png/);
  assert.doesNotMatch(systemPrompt({ projectDir: '/p' }), /Brand:/);
});
