import { createContext, useContext, useEffect, useState } from "react";
import type { NoteQueue, QueueState } from "../ai/queue";

/** Lets any screen see what the background AI work is doing. */
export const QueueContext = createContext<NoteQueue | null>(null);

const IDLE: QueueState = { running: null, waiting: [], lastError: null };

export function useQueueState(): QueueState {
  const queue = useContext(QueueContext);
  const [state, setState] = useState<QueueState>(queue?.getState() ?? IDLE);
  useEffect(() => {
    if (!queue) return;
    setState(queue.getState());
    return queue.subscribe(setState);
  }, [queue]);
  return state;
}
