// In-app confirmation dialog: `await ask("…")` instead of the browser's confirm(), so it looks like the rest of Shoal.
import { create } from "zustand";

export interface AskOptions { title?: string; ok?: string; cancel?: string; danger?: boolean }
interface Pending extends AskOptions { message: string; resolve: (v: boolean) => void }

export const useDialog = create<{ pending: Pending | null; open: (p: Pending) => void; close: (v: boolean) => void }>((set, get) => ({
  pending: null,
  open: (p) => { get().pending?.resolve(false); set({ pending: p }); },
  close: (v) => { const p = get().pending; set({ pending: null }); p?.resolve(v); },
}));

/** Ask the user to confirm; resolves true on the confirm button, false on cancel, Esc or a click outside. */
export function ask(message: string, opts: AskOptions = {}): Promise<boolean> {
  return new Promise((resolve) => useDialog.getState().open({ message, resolve, ...opts }));
}
