import { useSyncExternalStore } from "react";

// Issue key focused via /jira <KEY>, per workspace. Tiny external store; no context plumbing.
const focus = new Map<string, string>();
const listeners = new Set<() => void>();

export function setFocusedKey(workspaceId: string, key: string | null) {
  if (key) focus.set(workspaceId, key);
  else focus.delete(workspaceId);
  for (const l of listeners) l();
}

export function useFocusedKey(workspaceId: string): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => focus.get(workspaceId) ?? null,
  );
}
