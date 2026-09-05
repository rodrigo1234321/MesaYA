// Cooperative exclusion for reviewed build/test runners inside the external Windows Job.
// A killed runner leaves the file for supervisor reconciliation; never infer a stale owner.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function acquireHeavyLock(projectRoot) {
  const lockPath = path.join(projectRoot, '.tmp', 'mesaya-heavy.lock');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const owner = JSON.stringify({ pid: process.pid, id: randomUUID(), created: new Date().toISOString() });
  const fd = fs.openSync(lockPath, 'wx');
  try { fs.writeFileSync(fd, owner); } finally { fs.closeSync(fd); }
  process.once('exit', () => {
    try {
      if (fs.readFileSync(lockPath, 'utf8') === owner) fs.unlinkSync(lockPath);
    } catch { /* Preserve unknown ownership or errors for manual reconciliation. */ }
  });
}

export function stopOnTimeout() {
  if (process.env.MESAYA_BOUNDED_CANCEL_FILE) {
    fs.writeFileSync(process.env.MESAYA_BOUNDED_CANCEL_FILE, 'reviewed runner timeout\n', { flag: 'a' });
  }
  process.exit(124);
}
