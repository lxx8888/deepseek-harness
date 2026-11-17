import { describe, expect, it } from 'vitest'
import { comparePrices, renderPrice, routeKey, sortedPrices } from '../src/pricing.ts'
import type { ModelPrice } from '../src/pricing.ts'

const FLASH: ModelPrice = {
  provider: 'deepseek-official',
  model: 'deepseek-flash',
  inputPerMillion: 0.051,
  outputPerMillion: 0.567,
  currency: 'USD',
}

const PRO: ModelPrice = {
  provider: 'deepseek-official',
  model: 'deepseek-v4-pro',
  inputPerMillion: 1.32,
  outputPerMillion: 3.96,
  currency: 'USD',
}

describe('team model pricing', () => {
  it('builds a stable key for one provider/model pair', () => {
    expect(routeKey(FLASH)).toBe(routeKey({ ...FLASH }))
    expect(routeKey(FLASH)).not.toBe(routeKey(PRO))
  })

  it('orders the cheaper route first and keeps equal prices stable', () => {
    expect(comparePrices(FLASH, PRO)).toBeLessThan(0)
    expect(comparePrices(PRO, FLASH)).toBeGreaterThan(0)
    expect(comparePrices(FLASH, { ...FLASH })).toBe(0)
  })

  it('sorts prices cheapest-first and removes duplicate routes', () => {
    const sorted = sortedPrices([PRO, FLASH, { ...FLASH }, PRO])
    expect(sorted).toHaveLength(2)
    expect(sorted[0]?.model).toBe('deepseek-flash')
    expect(sorted[1]?.model).toBe('deepseek-v4-pro')
  })

  it('renders one price as a single comparison cell', () => {
    expect(renderPrice(FLASH)).toBe('in 0.051/USD/Mtok, out 0.567/USD/Mtok')
  })
})
