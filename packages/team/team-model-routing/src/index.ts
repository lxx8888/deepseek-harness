/**
 * Team-mode model routing policy: price comparison, decision-node defaults,
 * and the explicit child-route requirement.
 *
 * The service answers three questions for a Team Session:
 *
 * 1. Which models are available and what do they cost (`prices`, `bulkRoute`).
 * 2. Which route a management/decision node should use (the Session's own
 *    route, never a cheaper child route).
 * 3. Whether a child delegation must name its route explicitly
 *    (`requiresExplicitChildRoute`).
 *
 * The Team mode is what turns the policy on. When Team mode is off — or when
 * no Team service is mounted at all — the policy reports itself inactive, so
 * ordinary Sessions keep their existing delegation behaviour.
 *
 * @module @deepseek-ai/dsh-team-model-routing
 */

import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { comparePrices, renderPrice, routeKey, sortedPrices } from './pricing.ts'
import type { BulkRoute, ModelPrice } from './pricing.ts'

export type { BulkRoute, ModelPrice } from './pricing.ts'
export { comparePrices, renderPrice, routeKey, sortedPrices } from './pricing.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Team-mode model routing policy shared by Team tools and delegation tools. */
    teamModelRouting: TeamModelRoutingService
  }
}

/**
 * The subset of the Team service this policy needs.
 *
 * Declared structurally so this package does not depend on the Team package:
 * the Team service is queried softly, and a deployment without Agent Teams
 * simply never answers.
 */
interface TeamModeProbe {
  /** Whether Team tools and guidance are enabled for the caller's tree. */
  isEnabled(caller: Agent): boolean
}

/** One model the catalog advertises, joined with its deployment-declared price. */
export interface ModelRoutingRow {
  /** Registered provider id. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
  /** Adapter-owned display name. */
  readonly name: string
  /** Maximum combined request and response context, when disclosed. */
  readonly contextWindow?: number
  /** Reasoning effort ids the route accepts, when it accepts any. */
  readonly reasoningEfforts?: readonly string[]
  /** Deployment-declared price, when the deployment prices this route. */
  readonly price?: ModelPrice
  /** Whether this route is the Session's own route, used by decision nodes. */
  readonly sessionRoute: boolean
  /** Whether this route is the declared bulk-work default. */
  readonly bulkRoute: boolean
}

/** The policy that applies to one delegation. */
export interface TeamModelPolicy {
  /** Every catalog model, priced where the deployment prices it. */
  readonly rows: readonly ModelRoutingRow[]
  /** The Session's own route: the default for management and decision nodes. */
  readonly sessionRoute: { provider: string; model: string }
  /** The declared default for large-volume, repetitive child work. */
  readonly bulkRoute: BulkRoute
  /** Whether a child delegation must name its route explicitly. */
  readonly requiresExplicitChildRoute: boolean
}

/** Deployment configuration of the routing policy. */
export interface Config {
  /** Whether a child delegation must name `provider` and `model` explicitly. */
  requireExplicitChildRoute: boolean
  /** The route used for large-volume, repetitive child work. */
  bulkRoute: BulkRoute
  /** Deployment-declared prices, keyed by exact provider/model route. */
  prices: ModelPrice[]
}

/** Loader schema for the routing policy configuration. */
export const Config: z<Config> = z.object({
  requireExplicitChildRoute: z.boolean().default(false),
  bulkRoute: z.object({
    provider: z.string().min(1).required(),
    model: z.string().min(1).required(),
  }).default({ provider: '', model: '' }),
  prices: z.array(z.object({
    provider: z.string().min(1).required(),
    model: z.string().min(1).required(),
    inputPerMillion: z.number().min(0).required(),
    outputPerMillion: z.number().min(0).required(),
    currency: z.string().min(1).required(),
  })).default([]),
})

/**
 * Team-mode model routing policy owner.
 *
 * Reads its configuration on every operation so a settings write reaches the
 * next delegation without a restart.
 */
export class TeamModelRoutingService extends Service {
  static inject = ['agents']

  static Config = Config

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'teamModelRouting')
  }

  /**
   * Read the Team service softly.
   *
   * A deployment without Agent Teams never mounts it, and the policy then
   * reports itself inactive instead of failing.
   * @returns the Team service, or undefined when Team mode is unavailable.
   */
  private team(): TeamModeProbe | undefined {
    return this.ctx.get('agentTeams') as TeamModeProbe | undefined
  }

  /**
   * Whether Team mode is active for the caller's tree.
   *
   * A Team service that refuses the caller (an independently resumed child
   * with no active root) counts as inactive.
   * @param agent - exact live caller.
   * @returns whether Team mode governs this caller.
   */
  active(agent: Agent): boolean {
    const team = this.team()
    if (team === undefined) return false
    try {
      return team.isEnabled(agent)
    } catch {
      return false
    }
  }

  /**
   * Whether a child delegation must name its route explicitly.
   *
   * Inactive outside Team mode, so ordinary Sessions keep inheriting the
   * parent route.
   * @param agent - exact live delegating agent.
   * @returns whether explicit selection is required.
   */
  requiresExplicitChildRoute(agent: Agent): boolean {
    if (!this.active(agent)) return false
    return this.config.requireExplicitChildRoute
  }

  /**
   * The declared bulk-work default route.
   * @returns the route, or undefined when the deployment declares none.
   */
  bulkRoute(): BulkRoute | undefined {
    const route = this.config.bulkRoute
    if (route.provider.length === 0 || route.model.length === 0) return undefined
    return { provider: route.provider, model: route.model }
  }

  /**
   * Every deployment-declared price, cheapest first.
   * @returns the sorted price list.
   */
  prices(): ModelPrice[] {
    return sortedPrices(this.config.prices.map(price => ({ ...price })))
  }

  /**
   * The exact routes this policy authorizes for child delegation.
   *
   * A deployment prices the routes it means to route work onto, so the price
   * table is also the authorization: a priced route is a route a Lead may
   * pick, and the two facts cannot drift apart. Duplicates collapse.
   * @returns one provider/model pair per priced route, in declaration order.
   */
  authorizedRoutes(): { provider: string; model: string }[] {
    const seen = new Set<string>()
    const routes: { provider: string; model: string }[] = []
    for (const price of this.config.prices) {
      const route = { provider: price.provider, model: price.model }
      const key = routeKey(route)
      if (seen.has(key)) continue
      seen.add(key)
      routes.push(route)
    }
    return routes
  }

  /**
   * The deployment-declared price of one exact route.
   * @param route - exact provider/model route.
   * @returns the price, or undefined when the deployment prices no such route.
   */
  priceOf(route: { provider: string; model: string }): ModelPrice | undefined {
    const key = routeKey(route)
    const found = this.config.prices.find(price => routeKey(price) === key)
    return found === undefined ? undefined : { ...found }
  }

  /**
   * Build the full policy for one caller.
   *
   * The catalog comes from the live LLM runtime, so a model that disappears
   * between turns disappears from the comparison rather than lingering.
   * @param agent - exact live caller.
   * @param llm - live LLM runtime.
   * @param signal - cancellation for catalog reads.
   * @returns the policy, or undefined when Team mode is inactive.
   */
  async policyFor(
    agent: Agent,
    llm: LlmRuntime,
    signal: AbortSignal,
  ): Promise<TeamModelPolicy | undefined> {
    if (!this.active(agent)) return undefined
    const sessionRoute = this.sessionRouteOf(agent)
    const bulk = this.bulkRoute()
    const rows: ModelRoutingRow[] = []
    for (const provider of llm.listProviders()) {
      const models = await llm.listModels(provider.id)
      signal.throwIfAborted()
      for (const model of models) {
        const info = await llm.resolveModelInfo(provider.id, model.id, signal)
        signal.throwIfAborted()
        const price = this.priceOf({ provider: provider.id, model: model.id })
        rows.push({
          provider: provider.id,
          model: model.id,
          name: info.name,
          ...info.context === undefined ? {} : { contextWindow: info.context.contextWindow },
          ...info.reasoning === undefined
            ? {}
            : { reasoningEfforts: info.reasoning.efforts.map(effort => effort.id) },
          ...price === undefined ? {} : { price },
          sessionRoute: sessionRoute.provider === provider.id && sessionRoute.model === model.id,
          bulkRoute: bulk !== undefined && bulk.provider === provider.id && bulk.model === model.id,
        })
      }
    }
    return {
      rows: rows.toSorted((left, right) => {
        const leftPrice = left.price
        const rightPrice = right.price
        if (leftPrice !== undefined && rightPrice !== undefined) return comparePrices(leftPrice, rightPrice)
        if (leftPrice !== undefined) return -1
        if (rightPrice !== undefined) return 1
        return left.name.localeCompare(right.name)
      }),
      sessionRoute,
      bulkRoute: bulk ?? { provider: sessionRoute.provider, model: sessionRoute.model },
      requiresExplicitChildRoute: this.config.requireExplicitChildRoute,
    }
  }

  /**
   * The route this Session is currently using.
   *
   * The recorded request header owns the route after the first request; the
   * creation options answer before that.
   * @param agent - exact live caller.
   * @returns the Session's own provider and model.
   */
  sessionRouteOf(agent: Agent): { provider: string; model: string } {
    const header = agent.session.requestHeader()
    if (header !== undefined) {
      return { provider: header.config.provider, model: header.config.model }
    }
    return {
      provider: agent.options.provider ?? '',
      model: agent.options.model ?? '',
    }
  }

  /**
   * Render the model-facing guidance for one caller.
   *
   * The guidance names the decision-node route, the bulk-work route, and the
   * explicit-selection requirement, so the Lead can delegate without a second
   * round trip. Prices come from the deployment's table, which is synchronous;
   * the live catalog comparison is the tool's job.
   * @param agent - exact live caller.
   * @returns the guidance text, empty when Team mode is inactive.
   */
  guidance(agent: Agent): string {
    if (!this.active(agent)) return ''
    const sessionRoute = this.sessionRouteOf(agent)
    const bulk = this.bulkRoute()
    const lines: string[] = ['Team model routing policy:']
    lines.push(
      '- Management and decision nodes (planning, review, integration, the final answer) run on this'
      + ` Session's own route: ${sessionRoute.provider}/${sessionRoute.model}.`,
    )
    if (bulk !== undefined) {
      lines.push(
        '- Large-volume, repetitive child work runs on the bulk route:'
        + ` ${bulk.provider}/${bulk.model}.`,
      )
    }
    if (this.config.requireExplicitChildRoute) {
      lines.push(
        '- Every child delegation must name its own `provider` and `model` explicitly;'
        + " a child never inherits this Session's route. Pick the route that fits the work.",
      )
    }
    const priced = this.prices()
    if (priced.length > 0) {
      lines.push('Declared prices (cheapest first):')
      for (const price of priced) {
        const marks = [
          price.provider === sessionRoute.provider && price.model === sessionRoute.model ? 'session route' : undefined,
          bulk !== undefined && bulk.provider === price.provider && bulk.model === price.model ? 'bulk route' : undefined,
        ].filter(mark => mark !== undefined)
        const suffix = marks.length === 0 ? '' : ` [${marks.join(', ')}]`
        lines.push(`- ${price.provider}/${price.model}${suffix}: ${renderPrice(price)}`)
      }
    }
    lines.push('Compare routes with `team_model_compare` before dispatching work.')
    return lines.join('\n')
  }
}

export const name = 'team-model-routing'
export default TeamModelRoutingService
