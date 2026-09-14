import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'extension');
const dist = path.join(root, 'dist');
const manifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8'));
const folderName = `ChudPresence-Solo-${manifest.version}-extension`;
const staged = path.join(dist, folderName);
const archive = path.join(dist, `${folderName}.zip`);

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });
await fs.cp(source, staged, { recursive: true });
execFileSync('tar', ['-a', '-cf', archive, '-C', dist, folderName], { stdio: 'inherit' });
console.log(`Built ${archive}`);
