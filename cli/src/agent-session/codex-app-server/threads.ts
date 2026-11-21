import { safeText } from '@overlord/core/service/agent-session/pure/text';

/**
 * The Codex thread tree behind one Overlord session.
 *
 * An Overlord session binds one Codex *root* thread (ADR 0092). The agent can spawn subagents
 * (child threads), and a person at an attached TUI can fork a thread; all of that is work done
 * for the same objective, so it is attributed to the same Overlord session. Anything else on the
 * private server — a thread a person started from scratch in an attached TUI — is not, and the
 * supervisor ignores it.
 *
 * What Codex tells a client, verified live on 0.170.0 (plan
 * `planning/feature-plans/codex-app-server-control-plane.md` §3.6, coo:1325.nagv probe):
 *  - The server attaches every initialized connection to every thread it creates, so a spawned
 *    child's notifications *and its approval requests* reach the Overlord connection, carrying
 *    the child's `threadId`.
 *  - There is no `thread/started` for a spawned child. The parent announces it first, with a
 *    `subAgentActivity` item (`kind: "started"`, `agentThreadId`, `agentPath`); in other
 *    multi-agent modes a `collabAgentToolCall` (`spawnAgent`, `receiverThreadIds`) does.
 *  - `thread/read` on a child returns `parentThreadId`, `source.subAgent.thread_spawn`
 *    (`parent_thread_id`, `depth`, `agent_path`) and the root's `sessionId` (root-session
 *    inheritance). `thread/list` reports the child's own id as its `sessionId`, so `sessionId` is
 *    only trusted from `thread/read`.
 *  - `thread/fork` sends `thread/started` for the fork with `forkedFromId`; on 0.170 the fork has
 *    a new `sessionId` and no `parentThreadId`. A child also reports `forkedFromId` (its parent),
 *    so `parentThreadId` is checked first.
 *
 * Admission is monotonic: a thread that joined the tree stays in it. Membership is decided only
 * from lineage that points at a thread already in the tree (or the root's session id), never
 * from a working directory or a name.
 */

export type ThreadRelation = 'root' | 'subagent' | 'fork';

export type ThreadNode = {
  id: string;
  relation: ThreadRelation;
  /** The tree thread that spawned (subagent) or was forked into (fork) this one. */
  parentId: string | null;
  depth: number;
  /** Codex `agent_path` for a subagent, for example `/root/child`. */
  agentPath: string | null;
  nickname: string | null;
  role: string | null;
};

/** What the transport adds to a projected frame about the thread it came from. */
export type ThreadFrameContext = {
  rootThreadId: string;
  /** Set for every thread other than the root: the codec's `subagentId`. */
  subagentThreadId?: string;
  parentThreadId?: string;
  /** One bounded line describing how the thread joined the session, for its start event. */
  lineage?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** The thread a notification or server request belongs to, if it names one. */
export function threadIdOf(params: unknown): string | null {
  const record = asRecord(params);
  return str(record?.threadId) ?? str(asRecord(record?.thread)?.id);
}

function threadSpawnSource(thread: Record<string, unknown>): Record<string, unknown> | null {
  const subAgent = asRecord(asRecord(thread.source)?.subAgent);
  return asRecord(subAgent?.thread_spawn);
}

export class ThreadTree {
  private root: string | null;
  private readonly nodes = new Map<string, ThreadNode>();
  /** Threads looked up and found not to belong (foreign); never re-asked. */
  private readonly foreign = new Set<string>();
  private readonly pending = new Map<string, Promise<ThreadNode | null>>();

  constructor(rootId: string | null = null) {
    this.root = null;
    if (rootId) this.setRoot(rootId);
  }

  get rootId(): string | null {
    return this.root;
  }

  setRoot(id: string): void {
    if (this.root === id) return;
    this.root = id;
    this.nodes.set(id, {
      id,
      relation: 'root',
      parentId: null,
      depth: 0,
      agentPath: null,
      nickname: null,
      role: null
    });
  }

  get(id: string | null | undefined): ThreadNode | null {
    return id ? (this.nodes.get(id) ?? null) : null;
  }

  has(id: string | null | undefined): boolean {
    return Boolean(id && this.nodes.has(id));
  }

  isForeign(id: string): boolean {
    return this.foreign.has(id);
  }

  /** Every thread in the tree, root first, in admission order. */
  threads(): ThreadNode[] {
    return [...this.nodes.values()];
  }

  /** Threads other than the root. */
  get childCount(): number {
    return Math.max(0, this.nodes.size - 1);
  }

  private admit(node: ThreadNode): ThreadNode {
    const existing = this.nodes.get(node.id);
    if (existing) return existing;
    this.foreign.delete(node.id);
    this.nodes.set(node.id, node);
    return node;
  }

  /**
   * Admit a child announced by an item of a tree thread: `subAgentActivity` (`agentThreadId`)
   * or `collabAgentToolCall` (`receiverThreadIds` of a `spawnAgent` call). Returns the admitted
   * children; an item from a thread outside the tree admits nothing.
   */
  admitFromItem(emitterThreadId: string | null, item: unknown): ThreadNode[] {
    const parent = this.get(emitterThreadId);
    const record = asRecord(item);
    if (!parent || !record) return [];
    const childIds: { id: string; agentPath: string | null }[] = [];
    if (record.type === 'subAgentActivity') {
      const id = str(record.agentThreadId);
      if (id) childIds.push({ id, agentPath: str(record.agentPath) });
    } else if (record.type === 'collabAgentToolCall' && record.tool === 'spawnAgent') {
      for (const id of Array.isArray(record.receiverThreadIds) ? record.receiverThreadIds : []) {
        if (str(id)) childIds.push({ id: id as string, agentPath: null });
      }
    }
    return childIds
      .filter(child => child.id !== parent.id && child.id !== this.root)
      .map(child =>
        this.admit({
          id: child.id,
          relation: 'subagent',
          parentId: parent.id,
          depth: parent.depth + 1,
          agentPath: child.agentPath,
          nickname: null,
          role: null
        })
      );
  }

  /**
   * Admit a Codex `Thread` object (`thread/started`, `thread/read`, `thread/list`) when its
   * lineage points into the tree. Returns the node (existing nodes are enriched with nickname
   * and role), or `null` when the thread does not belong to this session.
   */
  admitThread(thread: unknown): ThreadNode | null {
    const record = asRecord(thread);
    const id = str(record?.id);
    if (!record || !id) return null;
    const known = this.nodes.get(id);
    const spawn = threadSpawnSource(record);
    const nickname = str(record.agentNickname) ?? str(spawn?.agent_nickname);
    const role = str(record.agentRole) ?? str(spawn?.agent_role);
    if (known) {
      known.nickname ??= nickname;
      known.role ??= role;
      known.agentPath ??= str(spawn?.agent_path);
      return known;
    }
    const parentThreadId = str(record.parentThreadId) ?? str(spawn?.parent_thread_id);
    const forkedFromId = str(record.forkedFromId);
    const sessionId = str(record.sessionId);
    const depthValue = typeof spawn?.depth === 'number' ? spawn.depth : null;
    const parent = this.get(parentThreadId);
    if (parent) {
      return this.admit({
        id,
        relation: 'subagent',
        parentId: parent.id,
        depth: depthValue ?? parent.depth + 1,
        agentPath: str(spawn?.agent_path),
        nickname,
        role
      });
    }
    const source = this.get(forkedFromId);
    if (source && !parentThreadId) {
      return this.admit({
        id,
        relation: 'fork',
        parentId: source.id,
        depth: source.depth,
        agentPath: null,
        nickname,
        role
      });
    }
    // Root-session inheritance: a thread whose (thread/read) session id is the root's belongs to
    // the root's session tree even when its parent is not known yet.
    if (this.root && sessionId === this.root && id !== this.root) {
      return this.admit({
        id,
        relation: 'subagent',
        parentId: this.root,
        depth: depthValue ?? 1,
        agentPath: str(spawn?.agent_path),
        nickname,
        role
      });
    }
    return null;
  }

  /**
   * Decide whether an unknown thread belongs to the session, asking Codex (`thread/read`).
   * Concurrent callers share one lookup; a thread Codex described and that does not belong is
   * remembered as foreign.
   */
  async resolve(
    id: string,
    read: (threadId: string) => Promise<unknown>
  ): Promise<ThreadNode | null> {
    const known = this.nodes.get(id);
    if (known) return known;
    if (this.foreign.has(id)) return null;
    let lookup = this.pending.get(id);
    if (!lookup) {
      lookup = (async () => {
        let thread: unknown;
        try {
          thread = await read(id);
        } catch {
          // No answer (the connection dropped): undecided, so it is asked again next time.
          return null;
        }
        const node = this.admitThread(thread);
        if (!node) this.foreign.add(id);
        return node;
      })().finally(() => this.pending.delete(id));
      this.pending.set(id, lookup);
    }
    return lookup;
  }

  /** The context a projected frame from this thread carries. */
  frameContext(threadId: string | null): ThreadFrameContext | null {
    if (!this.root) return null;
    const node = this.get(threadId) ?? this.nodes.get(this.root)!;
    if (node.relation === 'root') return { rootThreadId: this.root };
    return {
      rootThreadId: this.root,
      subagentThreadId: node.id,
      ...(node.parentId ? { parentThreadId: node.parentId } : {}),
      lineage: describeLineage(node)
    };
  }

  /** Bounded identity of a child thread for an approval card; `null` for the root. */
  cardOrigin(threadId: string | null): Record<string, unknown> | null {
    const node = this.get(threadId);
    if (!node || node.relation === 'root') return null;
    return {
      threadId: node.id,
      relation: node.relation,
      ...(node.parentId ? { parentThreadId: node.parentId } : {}),
      depth: node.depth,
      ...(node.agentPath ? { agentPath: safeText(node.agentPath, 120).text } : {}),
      ...(node.nickname ? { nickname: safeText(node.nickname, 60).text } : {}),
      ...(node.role ? { role: safeText(node.role, 60).text } : {})
    };
  }
}

export function describeLineage(node: ThreadNode): string {
  if (node.relation === 'root') return 'root thread';
  const parent = node.parentId ? ` of ${node.parentId}` : '';
  if (node.relation === 'fork') return safeText(`fork${parent}`, 200).text;
  const label = node.agentPath ?? node.nickname ?? node.role;
  return safeText(`subagent${label ? ` ${label}` : ''}${parent} (depth ${node.depth})`, 200).text;
}
