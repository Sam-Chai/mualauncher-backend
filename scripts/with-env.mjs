import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { parse } from 'dotenv';

const databaseKeys = ['DATABASE_URL', 'DATABASE_AUTH_URL', 'DATABASE_PUBLIC_URL', 'DATABASE_WORKER_URL', 'DATABASE_MIGRATION_URL', 'DATABASE_ADMIN_URL', 'DATABASE_SCHEMA'];

export async function environmentFromFiles(files, inherited = process.env) {
  const env = { ...inherited };
  // Do not accidentally inherit a deployer's privileged database connection.
  for (const key of [...databaseKeys, 'DOTENV_CONFIG_PATH', 'DOTENV_CONFIG_OVERRIDE']) delete env[key];
  for (const file of files) Object.assign(env, parse(await readFile(resolve(file))));
  // Scripts importing dotenv/config must not subsequently load the checkout's .env.
  env.DOTENV_CONFIG_PATH = resolve(files.at(-1));
  return env;
}

async function main() {
  const args = process.argv.slice(2), separator = args.indexOf('--');
  if (separator < 1 || !args[separator + 1] || !process.env.npm_execpath) {
    throw new Error('Usage: npm run with-env -- <common.env> [<role.env>] -- <npm-script> [arguments]');
  }
  const script = args[separator + 1];
  const scripts = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).scripts;
  if (script === 'with-env' || !Object.hasOwn(scripts, script)) throw new Error('Choose an existing npm script other than with-env');
  const env = await environmentFromFiles(args.slice(0, separator));
  const child = spawn(process.execPath, [process.env.npm_execpath, 'run', script, '--', ...args.slice(separator + 2)], {
    env, stdio: 'inherit', shell: false, windowsHide: true,
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', () => { console.error('Unable to launch npm script'); process.exitCode = 1; });
  child.on('exit', (code) => { process.exitCode = code ?? 1; });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Environment runner failed; check file access, npm script and command syntax. No credentials were printed.'); process.exitCode = 1; });
}
