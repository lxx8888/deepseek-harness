/** Deployment-declared model prices and the bulk-work default route. */

/**
 * One exact provider/model route with its declared token prices.
 *
 * Prices are deployment-owned facts: the LLM model directory carries no price
 * fields, so a comparison tool needs them from configuration.
 */
export interface ModelPrice {
  /** Registered provider id. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
  /** Input price per million tokens, in the deployment's currency unit. */
  readonly inputPerMillion: number
  /** Output price per million tokens, in the deployment's currency unit. */
  readonly outputPerMillion: number
  /** Currency unit the two prices are denominated in. */
  readonly currency: string
}

/**
 * The route used for large-volume, repetitive child work.
 *
 * A child inherits nothing: the Lead names this route explicitly when the
 * delegated work is bulk and mechanical.
 */
export interface BulkRoute {
  /** Registered provider id. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
}

/** Stable identity for one provider/model pair. */
export function routeKey(route: { provider: string; model: string }): string {
  return `${route.provider}\0${route.model}`
}

/**
 * Compare two prices by their blended output-weighted cost.
 *
 * Output tokens cost more than input tokens on every priced route, so the
 * comparison weights output higher while still reading a pure-input route
 * correctly. Ties keep the cheaper input route first.
 * @param left - first price.
 * @param right - second price.
 * @returns a negative number when left is cheaper, positive when right is, zero when equal.
 */
export function comparePrices(left: ModelPrice, right: ModelPrice): number {
  const blended = (price: ModelPrice): number => price.inputPerMillion + price.outputPerMillion * 3
  const difference = blended(left) - blended(right)
  if (difference !== 0) return difference
  return left.inputPerMillion - right.inputPerMillion
}

/**
 * Render one price as a compact model-facing row.
 * @param price - price to render.
 * @returns a single-line comparison cell.
 */
export function renderPrice(price: ModelPrice): string {
  return `in ${price.inputPerMillion}/${price.currency}/Mtok, out ${price.outputPerMillion}/${price.currency}/Mtok`
}

/**
 * Build the sorted comparison rows for one set of prices.
 * @param prices - declared prices, possibly naming the same route twice.
 * @returns prices sorted cheapest-first with duplicate routes removed.
 */
export function sortedPrices(prices: readonly ModelPrice[]): ModelPrice[] {
  const seen = new Set<string>()
  const unique = prices.filter((price) => {
    const key = routeKey(price)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return unique.toSorted((left, right) => comparePrices(left, right))
}
