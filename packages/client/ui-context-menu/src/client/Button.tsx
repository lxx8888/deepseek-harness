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
      // 本地修正（2026-11-05 续）：锚点 x 硬夹到 innerWidth-300 只是把溢出挪到别处，
      // 菜单宽度未知时依然会触发 position-try-fallbacks 回落到视口左侧。真正的判据是
      // 「卡片从锚点的哪一边展开」：触发器在右半屏就必须右对齐（align: end，卡片右缘
      // 贴按钮右缘向左展开），左半屏保持左对齐。这样两侧都不会溢出，也不需要猜宽度。
      const align = rect.left + rect.width / 2 > window.innerWidth / 2 ? 'end' as const : 'start' as const
      const x = align === 'end' ? rect.right : rect.left
      toggle(id, target, { x, y: rect.bottom, align })
    },
  }
  if (size !== 'sm') return <button {...attributes} type="button"><IconEllipsisOutlineRegular /></button>
  return <Tooltip label={label} side="bottom" align="end" portal>
    <Button {...attributes} size="sm" icon={<IconEllipsisOutlineRegular />} />
  </Tooltip>
}
