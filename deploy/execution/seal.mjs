import { readdirSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
const processes = () => readdirSync('/proc').filter(name => /^\d+$/.test(name)).flatMap(name => {
  try {
    const status = readFileSync(`/proc/${name}/status`, 'utf8');
    if (!/^Uid:\s+65532\s+65532\s+65532\s+65532\s*$/m.test(status) || /^State:\s+Z/m.test(status)) return [];
    return [{ id: Number(name), stopped: /^State:\s+[Tt]/m.test(status) }];
  } catch { return []; }
});
let frozen = false;
for (let round = 0; round < 100; round++) {
  const found = processes();
  for (const { id } of found) { try { process.kill(id, 'SIGSTOP'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
  await delay(10);
  if (processes().every(p => p.stopped)) { frozen = true; break; }
}
if (!frozen) throw new Error('Cannot freeze installer descendants');
for (const { id } of processes()) { try { process.kill(id, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
for (let round = 0; round < 200; round++) { if (!processes().length) { process.stdout.write('SEALED\n'); process.exit(0); } await delay(10); }
throw new Error('Installer descendants remain alive');
