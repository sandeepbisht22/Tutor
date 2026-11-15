/**
 * Runs background jobs for notes one at a time (writing suggestions is slow on
 * a local model, and two requests at once would only make both slower).
 */

export interface QueueState {
  /** the note being worked on */
  running: string | null;
  waiting: string[];
  /** why the last job failed, until another job succeeds */
  lastError: string | null;
}

export class NoteQueue {
  private state: QueueState = { running: null, waiting: [], lastError: null };
  private listeners = new Set<(state: QueueState) => void>();

  constructor(private readonly work: (noteId: string) => Promise<void>) {}

  getState(): QueueState {
    return this.state;
  }

  subscribe(listener: (state: QueueState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Add a note. A note already waiting is not added twice. */
  enqueue(noteId: string): void {
    if (this.state.waiting.includes(noteId)) return;
    this.set({ waiting: [...this.state.waiting, noteId] });
    void this.pump();
  }

  /** Resolves when nothing is running or waiting. */
  async idle(): Promise<void> {
    while (this.state.running !== null || this.state.waiting.length > 0) {
      await new Promise<void>((resolve) => {
        const stop = this.subscribe(() => {
          stop();
          resolve();
        });
      });
    }
  }

  private async pump(): Promise<void> {
    if (this.state.running !== null) return;
    const [next, ...rest] = this.state.waiting;
    if (next === undefined) return;
    this.set({ running: next, waiting: rest });
    try {
      await this.work(next);
      this.set({ running: null, lastError: null });
    } catch (error) {
      this.set({ running: null, lastError: error instanceof Error ? error.message : "The request failed." });
    }
    void this.pump();
  }

  private set(change: Partial<QueueState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of [...this.listeners]) listener(this.state);
  }
}
