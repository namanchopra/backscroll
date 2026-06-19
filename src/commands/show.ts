/**
 * `bsc show <id>` — print the full stored output of a past command. [TASK-023]
 */
import pc from 'picocolors';
import { getDb } from '../db/database';
import { Store } from '../db/store';
import { formatCommandHeader } from '../ui/format';

export function showCommand(idArg: string): number {
  if (!/^\d+$/.test(idArg.trim())) {
    process.stderr.write(`bsc: invalid command id "${idArg}" (expected a positive integer)\n`);
    return 1;
  }
  const id = parseInt(idArg.trim(), 10);

  const store = new Store(getDb());
  const rec = store.getCommandById(id);
  if (!rec) {
    process.stderr.write(`bsc: command #${id} not found\n`);
    return 1;
  }

  process.stdout.write(`${formatCommandHeader(rec)}\n`);
  const width = Math.min(60, process.stdout.columns ?? 60);
  process.stdout.write(pc.dim(`${'─'.repeat(width)}\n`));

  if (rec.output === null || rec.output === '') {
    process.stdout.write(pc.dim('(no output captured)\n'));
  } else {
    process.stdout.write(rec.output.endsWith('\n') ? rec.output : `${rec.output}\n`);
  }
  return 0;
}
