// Development runner: starts the Vite dev server, then launches Electron against it.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { buildElectron } from './build-electron.mjs';

const require = createRequire(import.meta.url);
const electronPath = require('electron');

await buildElectron();

const server = await createServer({ configFile: 'vite.config.ts' });
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error('Vite did not report a local URL');
console.log(`[omega] Vite dev server at ${url}`);

const extraArgs = process.argv.slice(2);
const child = spawn(electronPath, ['.', ...extraArgs], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
