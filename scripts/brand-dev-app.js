#!/usr/bin/env node
// Runs after `npm install` on macOS. When the editor runs from source (`npm start`), macOS
// names the app after the Electron bundle in node_modules, so the Dock and the menu bar say
// "Electron" with Electron's icon. This renames that local development copy to
// "Scale Video Editor" and gives it the Scale.gg icon. Installed builds are named by
// electron-builder and do not need this. It changes only node_modules/electron.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

if (process.platform !== 'darwin') process.exit(0);
const root = path.join(__dirname, '..');
const bundle = path.join(root, 'node_modules', 'electron', 'dist', 'Electron.app');
const plist = path.join(bundle, 'Contents', 'Info.plist');
if (!fs.existsSync(plist)) { console.log('brand-dev-app: Electron is not downloaded yet; skipped.'); process.exit(0); }

const NAME = 'Scale Video Editor';
const set = (key, value) => {
  try { execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist]); }
  catch { execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, plist]); }
};
set('CFBundleName', NAME);
set('CFBundleDisplayName', NAME);

const icns = path.join(root, 'build', 'icon.icns');
const target = path.join(bundle, 'Contents', 'Resources', 'electron.icns');
if (fs.existsSync(icns)) fs.copyFileSync(icns, target);

// Editing Info.plist breaks the bundle's signature seal; sign it again locally (ad hoc).
try { execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'ignore' }); } catch {}

// Ask macOS to read the bundle again, so the Dock does not keep the old name and icon.
try { execFileSync('/usr/bin/touch', [bundle]); } catch {}
try {
  execFileSync('/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister', ['-f', bundle]);
} catch {}
console.log(`brand-dev-app: the development app is now named "${NAME}" with the Scale.gg icon.`);
