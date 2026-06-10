/**
 * Checkpointer selection — where the durable-HITL claim becomes true or false.
 *
 * DATABASE_URL set   -> PostgresSaver: a pending approval survives restarts,
 *                       deploys, and fresh serverless invocations. The reviewer
 *                       can come back tomorrow.
 * DATABASE_URL unset -> MemorySaver: the approval only survives while this
 *                       process lives. On serverless that means "usually not".
 *
 * The mode is reported in every assessment instead of being hidden, because an
 * ephemeral approval gate that looks durable is worse than no gate at all —
 * it manufactures false audit confidence. (This is the exact design gap this
 * project criticises in hosted agent platforms.)
 */

import { MemorySaver } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

export type HitlMode = 'durable-postgres' | 'ephemeral-memory';

let saver: MemorySaver | PostgresSaver | null = null;
let mode: HitlMode = 'ephemeral-memory';
let setupDone = false;

export async function getCheckpointer(): Promise<{ saver: MemorySaver | PostgresSaver; mode: HitlMode }> {
  if (!saver) {
    const url = process.env.DATABASE_URL;
    if (url) {
      saver = PostgresSaver.fromConnString(url);
      mode = 'durable-postgres';
    } else {
      saver = new MemorySaver();
      mode = 'ephemeral-memory';
    }
  }
  if (saver instanceof PostgresSaver && !setupDone) {
    await saver.setup();
    setupDone = true;
  }
  return { saver, mode };
}
