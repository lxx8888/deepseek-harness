// @vitest-environment jsdom
/** Sidebar launcher pins persist across instances and ignore the fixed Plugins panel. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PANEL_PINS_STORAGE_KEY, createPanelPins } from '../src/client/panel-pins.ts'

const KEY = PANEL_PINS_STORAGE_KEY
const LEGACY_KEY = 'dsh.slot.manual-order.sidebar.panellist.v1'
afterEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('sidebar panel pins', () => {
  it('stores unpinned panel ids and restores them in a new instance', () => {
    const pins = createPanelPins()
    const listener = vi.fn()
    pins.unpinned.subscribe(listener)
    const initial = pins.unpinned.getSnapshot()
    expect(initial).toEqual([])
    expect(pins.unpinned.getSnapshot()).toBe(initial)
    pins.setPinned('notes', false)
    pins.setPinned('tasks', false)
    expect(pins.unpinned.getSnapshot()).toEqual(['notes', 'tasks'])
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual(['notes', 'tasks'])
    expect(listener).toHaveBeenCalledTimes(2)
    expect(createPanelPins().unpinned.getSnapshot()).toEqual(['notes', 'tasks'])
    pins.setPinned('notes', true)
    expect(pins.unpinned.getSnapshot()).toEqual(['tasks'])
    expect(JSON.parse(localStorage.getItem(KEY) ?? 'null')).toEqual(['tasks'])
  })

  it('clears the stored entry once every panel is pinned again', () => {
    const pins = createPanelPins()
    pins.setPinned('notes', false)
    pins.setPinned('notes', true)
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(createPanelPins().unpinned.getSnapshot()).toEqual([])
  })

  it('ignores Plugins and repeated choices without republishing', () => {
    const pins = createPanelPins()
    pins.setPinned('notes', false)
    const snapshot = pins.unpinned.getSnapshot()
    const listener = vi.fn()
    pins.unpinned.subscribe(listener)
    pins.setPinned('plugins', false)
    pins.setPinned('notes', false)
    pins.setPinned('absent', true)
    expect(pins.unpinned.getSnapshot()).toBe(snapshot)
    expect(listener).not.toHaveBeenCalled()
  })

  it('keeps ids of panels that are not registered', () => {
    const pins = createPanelPins()
    pins.setPinned('removed-plugin', false)
    pins.setPinned('notes', false)
    expect(pins.unpinned.getSnapshot()).toEqual(['removed-plugin', 'notes'])
    expect(createPanelPins().unpinned.getSnapshot()).toEqual(['removed-plugin', 'notes'])
  })

  it('drops a payload that is not a string array instead of restoring it', () => {
    for (const payload of ['{"unpinned":["notes"]}', JSON.stringify(['notes', 1]), '"notes"', 'not json']) {
      localStorage.setItem(KEY, payload)
      const pins = createPanelPins()
      const snapshot = pins.unpinned.getSnapshot()
      expect(snapshot).toEqual([])
      expect(pins.unpinned.getSnapshot()).toBe(snapshot)
    }
  })

  it('filters stored duplicates and the fixed panel', () => {
    localStorage.setItem(KEY, JSON.stringify(['notes', 'plugins', 'notes', '']))
    expect(createPanelPins().unpinned.getSnapshot()).toEqual(['notes'])
  })

  it('ignores the retired manual-order key', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ unpinned: ['notes'] }))
    expect(createPanelPins().unpinned.getSnapshot()).toEqual([])
  })
})
