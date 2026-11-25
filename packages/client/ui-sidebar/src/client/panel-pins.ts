/**
 * Pin choices for the global panel launchers, kept in memory and mirrored into
 * `localStorage` so an unpinned launcher stays out of the sidebar across plugin
 * reloads and host restarts. The stored value is the unpinned id list alone:
 * membership of the pin section is derived from it on every render.
 */
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'

/** Panel whose launcher always shows and never enters the customization list. */
export const FIXED_PANEL_ID = 'plugins'

/** Storage key holding the unpinned panel ids as a JSON string array. */
export const PANEL_PINS_STORAGE_KEY = 'dsh.sidebar.panel-pins.v1'

const NO_PANELS: readonly string[] = []

/** The browser's local storage, absent under a server render or a bare Node test. */
function localStore(): Storage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage
}

/**
 * Read the persisted unpinned ids, discarding anything the store cannot vouch for:
 * a malformed payload, a member that is not a string, or the fixed panel. A
 * payload holding any non-string member is dropped whole rather than partly
 * restored, so a corrupted entry resets to the default instead of silently
 * losing some pins. A store read that throws (private mode, quota) degrades to
 * the in-memory default rather than breaking the sidebar's first render.
 * @returns The stored unpinned ids, or none.
 */
function readUnpinned(): readonly string[] {
  const store = localStore()
  if (store === undefined) return NO_PANELS
  try {
    const raw = store.getItem(PANEL_PINS_STORAGE_KEY)
    if (raw === null) return NO_PANELS
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || !parsed.every((id): id is string => typeof id === 'string')) return NO_PANELS
    const kept = [...new Set(parsed.filter(id => id !== '' && id !== FIXED_PANEL_ID))]
    return kept.length === 0 ? NO_PANELS : kept
  } catch (error) {
    // Unreadable payload: treat it as no stored choice so the pin list stays usable.
    void error
    return NO_PANELS
  }
}

/**
 * Mirror the unpinned ids into local storage. A write that throws is dropped: the
 * choice already applies to this page, and losing it on the next start is better
 * than failing the toggle.
 * @param unpinned - Unpinned panel ids; an empty list clears the stored entry.
 */
function writeUnpinned(unpinned: readonly string[]): void {
  const store = localStore()
  if (store === undefined) return
  try {
    if (unpinned.length === 0) store.removeItem(PANEL_PINS_STORAGE_KEY)
    else store.setItem(PANEL_PINS_STORAGE_KEY, JSON.stringify(unpinned))
  } catch (error) {
    // Quota or a disabled store: the in-memory list remains the live truth.
    void error
  }
}

/** Unpinned panel ids and their only mutation. */
export interface PanelPins {
  /** Unpinned panel ids; ids of panels that are not registered stay listed. */
  readonly unpinned: ObservableSnapshot<readonly string[]>
  /**
   * Pin or unpin one panel launcher; the fixed panel is ignored.
   * @param id - Panel id.
   * @param pinned - Whether the launcher is manually pinned.
   */
  readonly setPinned: (id: string, pinned: boolean) => void
}

/**
 * Create the panel pin list, restored from local storage; the snapshot keeps its reference until the list changes.
 * @returns Unpinned panel ids and the pin mutation.
 */
export function createPanelPins(): PanelPins {
  const store = createSnapshotStore<{ readonly unpinned: readonly string[] }>({ unpinned: readUnpinned() })
  return {
    unpinned: { getSnapshot: () => store.getSnapshot().unpinned, subscribe: listener => store.subscribe(listener) },
    setPinned: (id, pinned) => {
      const current = store.getSnapshot().unpinned
      if (id === FIXED_PANEL_ID || pinned !== current.includes(id)) return
      const next = pinned ? current.filter(entry => entry !== id) : [...current, id]
      store.set({ unpinned: next })
      writeUnpinned(next)
    },
  }
}
