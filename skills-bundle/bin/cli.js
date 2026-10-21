#!/usr/bin/env node
// doris.kolly@unifr.ch
const fs = require('fs');
const path = require('path');

const PACKAGE_ROOT = path.join(__dirname, '..');
const MANIFEST_PATH = path.join(PACKAGE_ROOT, 'bundle.json');

function showHelp() {
    console.log(`Usage: skills <command> [options]

Commands:
  init    Install all skills from the bundle into the workspace

Options:
  -t, --target <dir>  Target skills folder (default: .agents/skills)
  -h, --help          Show this help message
`);
}

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === '-h' || command === '--help') {
    showHelp();
    process.exit(command ? 0 : 1);
}

if (command === 'init') {
    let targetDir = '.agents/skills';

    const targetIdx = args.indexOf('-t');
    if (targetIdx === -1) {
        const longIdx = args.indexOf('--target');
        if (longIdx !== -1 && longIdx + 1 < args.length) {
            targetDir = args[longIdx + 1];
        }
    } else if (targetIdx + 1 < args.length) {
        targetDir = args[targetIdx + 1];
    }

    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const resolvedTarget = path.resolve(process.cwd(), targetDir);

    console.log(`Syncing bundle "${manifest.name}" (v${manifest.version})...`);

    manifest.skills.forEach((skillName) => {
        const src = path.join(PACKAGE_ROOT, 'skills', skillName);
        const dest = path.join(resolvedTarget, skillName);

        if (fs.existsSync(src)) {
            fs.cpSync(src, dest, { recursive: true });
            console.log(`  ✓ Installed skill: ${skillName}`);
        } else {
            console.warn(`  ⚠️ Skill "${skillName}" defined in manifest but missing on disk.`);
        }
    });

    console.log(`\nSkills successfully hydrated into: ${resolvedTarget}`);
} else {
    console.error(`Unknown command: ${command}`);
    showHelp();
    process.exit(1);
}
