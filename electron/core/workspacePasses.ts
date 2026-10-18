// Where a pass over every workspace outside a scan runs — one workspace at a
// time — so that removing a workspace, or quitting, can stop it and wait:
// such a pass writes into each workspace's database in turn, and that
// database is closed when the workspace is removed and on quit. "Apply to
// existing files" is one; a new pass of that kind belongs here too. The scans
// have their own (ScanManager).
interface Running {
  id: string;
  controller: AbortController;
  done: Promise<unknown>;
}

export class WorkspacePasses {
  /** Workspaces being removed: no pass starts on them. */
  private readonly held = new Map<string, number>();
  /** The workspace each pass under way is on (passes may overlap). */
  private readonly running = new Set<Running>();
  private readonly passes = new Set<Promise<void>>();
  /** Quitting: no pass goes on to another workspace, nor starts. */
  private stopped = false;

  /**
   * Runs `fn` for each workspace `list()` names, in its order. Each is looked
   * up again just before its turn, so one removed meanwhile is skipped and
   * the rest carry on; `fn` gets a signal that a removal of its workspace, or
   * quitting, aborts, and is expected to stop writing once it is.
   */
  forEachWorkspace<T extends { id: string }>(
    list: () => readonly T[],
    fn: (item: T, signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    const pass = this.walk(list, fn);
    this.passes.add(pass);
    void pass.catch(() => {}).finally(() => this.passes.delete(pass));
    return pass;
  }

  private async walk<T extends { id: string }>(
    list: () => readonly T[],
    fn: (item: T, signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    const ids = list().map((item) => item.id);
    for (const id of ids) {
      if (this.stopped) return;
      if (this.held.has(id)) continue;
      const item = list().find((candidate) => candidate.id === id);
      if (!item) continue;
      const controller = new AbortController();
      const running: Running = {
        id,
        controller,
        done: fn(item, controller.signal),
      };
      this.running.add(running);
      try {
        await running.done;
      } finally {
        this.running.delete(running);
      }
    }
  }

  /**
   * Runs `fn` — the removal of workspace `id` — once no pass is on that
   * workspace, the one that was stopped and waited for; no pass starts on it
   * until `fn` is done.
   */
  async holding<T>(id: string, fn: () => Promise<T>): Promise<T> {
    this.held.set(id, (this.held.get(id) ?? 0) + 1);
    try {
      const on = [...this.running].filter((running) => running.id === id);
      for (const running of on) running.controller.abort();
      await Promise.all(on.map((running) => running.done.catch(() => {})));
      return await fn();
    } finally {
      const left = (this.held.get(id) ?? 1) - 1;
      if (left > 0) this.held.set(id, left);
      else this.held.delete(id);
    }
  }

  /** On quit: stops every pass, and waits for them to have stopped. */
  async abortAll(): Promise<void> {
    this.stopped = true;
    for (const running of this.running) running.controller.abort();
    await Promise.all([...this.passes].map((pass) => pass.catch(() => {})));
  }
}
