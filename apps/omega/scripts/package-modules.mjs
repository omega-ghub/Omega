// Packages every built module in dist-modules/<id>/ into <id>-<version>.zip and
// writes catalog.json (what the hub downloads to learn which apps exist).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { zipSync } from 'fflate';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist-modules');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

const META = {
  video: { name: 'Omega Video', description: 'Edit, color and finish video.' },
};

function walk(dir, base = '') {
  const files = {};
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (fs.statSync(full).isDirectory()) Object.assign(files, walk(full, rel));
    else files[rel] = new Uint8Array(fs.readFileSync(full));
  }
  return files;
}

const modules = [];
for (const id of fs.readdirSync(out)) {
  const dir = path.join(out, id);
  if (!fs.statSync(dir).isDirectory()) continue;
  const files = walk(dir);
  files['manifest.json'] = new TextEncoder().encode(JSON.stringify({ id, version, name: META[id]?.name ?? id, entry: 'index.html' }, null, 2));
  const zip = Buffer.from(zipSync(files, { level: 9 }));
  const file = `${id}-${version}.zip`;
  fs.writeFileSync(path.join(out, file), zip);
  modules.push({ id, name: META[id]?.name ?? id, description: META[id]?.description, version, size: zip.length, sha256: crypto.createHash('sha256').update(zip).digest('hex'), url: file });
  console.log(`packaged ${file} (${(zip.length / 1024).toFixed(0)} KB)`);
}
fs.writeFileSync(path.join(out, 'catalog.json'), JSON.stringify({ modules }, null, 2));
console.log('wrote catalog.json');
