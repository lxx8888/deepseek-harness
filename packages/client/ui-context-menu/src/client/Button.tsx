/** Shared ellipsis control for explicit context-menu targets. */
import { Button, IconEllipsisOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import { useId } from 'react'
import type { MouseEvent, PointerEvent } from 'react'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ContextMenus, ContextMenuTarget, MenuPoint } from './types.ts'

/** Menu facts and the per-button toggle, bound by the factory registration. */
export interface ContextMenuButtonInjected {
  hooks: {
    /** Instance id of the shared button that opened the current popup; null for gestures and after dismissal. */
    opener: ObservableSnapshot<string | null>
    registeredKinds: ContextMenus['registeredKinds']
  }
  /**
   * Close the popup this button opened, or open a new one for its target.
   * @param button - instance id of the activated button.
   * @param target - captured object.
   * @param point - viewport anchor below the button.
   */
  toggle: (button: string, target: ContextMenuTarget, point: MenuPoint) => void
}

/**
 * Render the menu trigger while its target kind has a registered contribution.
 * @param props - Localized owner data and framework-bound menu facts.
 * @returns An available target's menu trigger.
 */
export function ContextMenuButton({ target, label, className, size, useOpener, useRegisteredKinds, toggle }: FactoryComponentPropsOf<'contextMenu.button'>) {
  const id = useId()
  const expanded = useOpener(opener => opener === id)
  const available = useRegisteredKinds(kinds => kinds.includes(target.kind))
  if (!available) return null
  const attributes = {
    className,
    'data-context-menu-trigger': '',
    'aria-label': label,
    'aria-haspopup': 'menu' as const,
    'aria-expanded': expanded,
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => { event.stopPropagation() },
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation()
      event.currentTarget.focus({ preventScroll: true })
      const rect = event.currentTarget.getBoundingClientRect()
      // 本地修正（2026-11-05）：会话头部「…」在右缘，以 rect.left 作锚点时菜单放不下，
      // 会回落到视口左侧 12px（现象：popup 弹到内容区最左）。把锚点横向坐标夹到
      // 「菜单至少放得下 MENU_MIN_WIDTH」的范围内，菜单就会贴在按钮下方而不是跑到左边。
      const MENU_MIN_WIDTH = 300
      const maxLeft = Math.max(12, window.innerWidth - MENU_MIN_WIDTH)
      toggle(id, target, { x: Math.min(rect.left, maxLeft), y: rect.bottom })
    },
  }
  return <Tooltip label={label} side="bottom" align="end" portal>
    {size === 'sm'
      ? <Button {...attributes} size="sm" icon={<IconEllipsisOutlineRegular />} />
      : <button {...attributes} type="button"><IconEllipsisOutlineRegular /></button>}
  </Tooltip>
}
