export interface Emitter<E> {
  on<K extends keyof E>(event: K, fn: (payload: E[K]) => void): () => void;
  emit<K extends keyof E>(event: K, payload: E[K]): void;
  clear(): void;
}

/** Tiny typed event emitter. A throwing listener never breaks the others. */
export function createEmitter<E>(): Emitter<E> {
  const map = new Map<keyof E, Set<(p: any) => void>>();
  return {
    on(event, fn) {
      let set = map.get(event);
      if (!set) map.set(event, (set = new Set()));
      set.add(fn);
      return () => {
        map.get(event)?.delete(fn);
      };
    },
    emit(event, payload) {
      map.get(event)?.forEach((fn) => {
        try {
          fn(payload);
        } catch (err) {
          console.error(err);
        }
      });
    },
    clear() {
      map.clear();
    },
  };
}
