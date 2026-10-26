import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { environmentFromFiles } from './with-env.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const [role, ...files] = process.argv.slice(2);
let child;
let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopping = true; child?.kill(signal); });
async function run(args, env) {
  if (stopping) return 0;
  return new Promise((yes, no) => {
    child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit', shell: false });
    child.once('error', no);
    child.once('exit', (code, signal) => yes(code ?? (stopping && signal ? 0 : 1)));
  });
}
try {
  if (!['web', 'worker', 'reap'].includes(role) || files.length < 2) throw Error('Invalid service role/configuration');
  const env = await environmentFromFiles(files);
  if (env.NODE_ENV !== 'production') throw Error('NODE_ENV must be production');
  const ts = ['--conditions=react-server', '--import', 'tsx'];
  const checked = role === 'reap' ? 0 : await run([...ts, 'scripts/check-deployment.ts', '--role', role], env);
  process.exitCode = checked || await run(role === 'web'
    ? ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3001']
    : [...ts, role === 'worker' ? 'scripts/client-worker.ts' : 'scripts/execution-admin.ts', ...(role === 'reap' ? ['reap'] : [])], env);
} catch { console.error('Service failed; check protected external configuration and deployment preflight.'); process.exitCode = 1; }
