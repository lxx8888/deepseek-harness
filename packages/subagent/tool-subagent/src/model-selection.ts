/** Child LLM route selection for the subagent tool. */

import { brandString } from '@deepseek-ai/dsh-brand'
import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm/types'
import type { LlmRuntime } from '@deepseek-ai/dsh-llm'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import { SubagentError } from '@deepseek-ai/dsh-subagent'
import { ToolArgsError, ToolContextUnavailableError } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

/** One exact child LLM route authorized by a user setting. */
export interface AllowedModelRoute {
  /** Registered LLM provider id. */
  readonly provider: string
  /** Provider-owned exact model id. */
  readonly model: string
}

/** Schema shared by the Host setting and its deployment base. */
export const AllowedModelRouteSchema: z<AllowedModelRoute> = z.object({
  provider: z.string().min(1).required(),
  model: z.string().min(1).required(),
})

/** Exact routes authorized for one Session. */
export interface ModelSelectionPolicy {
  /** Exact provider/model routes authorized for explicit selection. */
  readonly routes: readonly AllowedModelRoute[]
}

/**
 * Stable identity for one provider/model pair.
 * @param route - Exact provider/model route.
 * @returns Opaque key for equality checks.
 */
export function modelRouteKey(route: AllowedModelRoute): string {
  return `${route.provider}\0${route.model}`
}

/**
 * Reject malformed or duplicate route policy entries at a durable or configuration boundary.
 * @param routes - Candidate exact routes to validate.
 * @returns an assertion that the candidate is a validated exact-route array.
 */
export function assertAllowedModelRoutes(routes: unknown): asserts routes is readonly AllowedModelRoute[] {
  if (!Array.isArray(routes)) {
    throw new Error('subagent model selection requires an array of routes')
  }
  const seen = new Set<string>()
  const candidates: readonly unknown[] = routes
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)
      || !('provider' in candidate) || typeof candidate.provider !== 'string'
      || !('model' in candidate) || typeof candidate.model !== 'string'
      || candidate.provider.length === 0 || candidate.model.length === 0) {
      throw new Error('subagent model selection requires non-empty provider and model ids')
    }
    const route = { provider: candidate.provider, model: candidate.model }
    const key = modelRouteKey(route)
    if (seen.has(key)) {
      throw new Error(`subagent model selection repeats route "${route.provider}/${route.model}"`)
    }
    seen.add(key)
  }
}

/** Model-facing child LLM route fields. */
export interface DelegationModelRequest {
  readonly provider?: string
  readonly model?: string
  readonly reasoning_effort?: string
}

/**
 * Whether a call explicitly selects any child LLM value.
 * @param request - Model-facing route fields from the tool call.
 * @returns Whether at least one route or effort field is present.
 */
export function hasDelegationModelRequest(request: DelegationModelRequest): boolean {
  return request.provider !== undefined
    || request.model !== undefined
    || request.reasoning_effort !== undefined
}

/** Reject an empty model-facing route value at the tool JSON boundary. */
function assertNonEmpty(value: string | undefined, field: keyof DelegationModelRequest): void {
  if (value !== undefined && value.length === 0) {
    throw new ToolArgsError([`child LLM \`${field}\` must be non-empty`])
  }
}

/**
 * Validate explicit selection against the Session policy and merge it over child defaults.
 * Explicit selection requires both provider and model; an omitted effort then
 * uses the selected model's default, even when the route is unchanged.
 * @param configured - Tool-instance child defaults.
 * @param request - Model-facing route override.
 * @param enabled - Whether this tool instance permits model-facing selection.
 * @param policy - Session allowlist; omission permits only the current parent route.
 * @param parentOptions - Current parent route used when no policy is recorded.
 * @returns Child Agent options, preserving omission when no layer contributes one.
 * @throws {SubagentError} `MODEL_SELECTION_DISABLED` when this tool instance
 *   forbids selection, or `MODEL_ROUTE_NOT_ALLOWED` when the Session does not allow the route.
 * @throws {ToolArgsError} when a field is empty or `provider` and `model` are not supplied together.
 */
export function requestedAgentOptions(
  configured: AgentOptions | undefined,
  request: DelegationModelRequest,
  enabled: boolean,
  policy: ModelSelectionPolicy | undefined,
  parentOptions: AgentOptions,
): AgentOptions | undefined {
  if (!hasDelegationModelRequest(request)) return configured
  if (!enabled) {
    throw new SubagentError('child model selection is disabled for this tool instance', 'MODEL_SELECTION_DISABLED')
  }
  assertNonEmpty(request.provider, 'provider')
  assertNonEmpty(request.model, 'model')
  assertNonEmpty(request.reasoning_effort, 'reasoning_effort')
  if (request.provider === undefined || request.model === undefined) {
    throw new ToolArgsError([request.reasoning_effort === undefined
      ? 'child LLM `provider` and `model` must be supplied together'
      : 'child LLM `reasoning_effort` requires both `provider` and `model`; supply both or omit all three fields'])
  }

  assertAllowedModelSelection(policy, parentOptions, { provider: request.provider, model: request.model })
  return {
    ...configured,
    provider: request.provider,
    model: request.model,
    // Explicit undefined also clears compatible parent effort during child-option merging.
    reasoningEffort: request.reasoning_effort === undefined ? undefined : brandString<ReasoningEffortId>(request.reasoning_effort),
  }
}

/**
 * Enforce Session authorization for a complete, explicitly selected child route.
 * @param policy - Session allowlist; omission permits only the current parent route.
 * @param parentOptions - Current parent route used when no policy is recorded.
 * @param route - Validated provider/model pair from the tool call.
 * @throws {SubagentError} `MODEL_ROUTE_NOT_ALLOWED` when the Session does not allow the route.
 */
export function assertAllowedModelSelection(
  policy: ModelSelectionPolicy | undefined,
  parentOptions: AgentOptions,
  route: AllowedModelRoute,
): void {
  const { provider, model } = route
  const allowed = policy === undefined
    ? provider === parentOptions.provider && model === parentOptions.model
    : policy.routes.some(route => route.provider === provider && route.model === model)
  if (allowed) return
  throw new SubagentError(`child LLM route "${provider}/${model}" is not allowed for this Session`
    + (policy === undefined
      ? '; without a recorded model-selection policy, explicit selection is limited to the parent route'
      : ''), 'MODEL_ROUTE_NOT_ALLOWED')
}

/**
 * The subset of the Team model-routing policy this module needs.
 *
 * Declared structurally so the delegation tool does not depend on the Team
 * packages: the policy service is queried softly, and a deployment without
 * Agent Teams never mounts it.
 */
export interface ChildRouteRequirement {
  /** Whether a child delegation must name its route explicitly. */
  requiresExplicitChildRoute(agent: unknown): boolean
  /** The declared bulk-work route, when the deployment declares one. */
  bulkRoute(): { provider: string; model: string } | undefined
  /**
   * Exact routes the Team policy itself authorizes, when it declares any.
   *
   * A Team deployment prices the routes it means to route work onto. Reading
   * those same routes as authorization keeps the two facts from drifting: a
   * priced route is a route a Lead may pick, without a second allowlist that
   * can fall out of date.
   */
  authorizedRoutes?(): { provider: string; model: string }[]
}

/**
 * Merge the Team policy's authorized routes into a Session's allowlist.
 *
 * Only an active Team policy contributes. Outside Team mode the recorded
 * allowlist stands exactly as written, so ordinary Sessions never gain routes
 * from a deployment's price table.
 * @param policy - the Session's recorded allowlist, or undefined when none is recorded.
 * @param requirement - the Team routing policy, when one is mounted and active.
 * @param agent - exact live delegating agent.
 * @returns the policy to enforce, or undefined to keep parent-route-only selection.
 */
export function teamAuthorizedPolicy(
  policy: ModelSelectionPolicy | undefined,
  requirement: ChildRouteRequirement | undefined,
  agent: unknown,
): ModelSelectionPolicy | undefined {
  if (requirement === undefined) return policy
  if (!requirement.requiresExplicitChildRoute(agent)) return policy
  const authorized = requirement.authorizedRoutes?.() ?? []
  if (authorized.length === 0) return policy
  const merged = [...(policy?.routes ?? [])]
  const seen = new Set(merged.map(route => modelRouteKey(route)))
  for (const route of authorized) {
    const key = modelRouteKey(route)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push({ provider: route.provider, model: route.model })
  }
  return { routes: merged }
}

/**
 * Enforce the Team-mode requirement that a child names its own route.
 *
 * Outside Team mode this is a no-op, so ordinary Sessions keep inheriting the
 * parent route. Inside Team mode a delegation that names no route is refused:
 * the caller must pick the route that fits the work, either explicitly or by
 * using the declared bulk route.
 * @param requirement - the Team routing policy, when one is mounted.
 * @param agent - exact live delegating agent.
 * @param request - model-facing route fields from the tool call.
 * @throws when the policy requires explicit selection and the call names none.
 */
export function assertExplicitChildRoute(
  requirement: ChildRouteRequirement | undefined,
  agent: unknown,
  request: DelegationModelRequest,
): void {
  if (requirement === undefined) return
  if (!requirement.requiresExplicitChildRoute(agent)) return
  if (request.provider !== undefined && request.model !== undefined) return
  const bulk = requirement.bulkRoute()
  const bulkHint = bulk === undefined
    ? 'Compare routes with the Team model comparison tool, then pass `provider` and `model`.'
    : 'Compare routes with the Team model comparison tool, then pass `provider` and `model`; '
      + `use ${bulk.provider}/${bulk.model} for large-volume, repetitive work.`
  throw new Error(
    'Team mode requires every child delegation to name its own `provider` and `model`; '
    + 'a child never inherits this Session\'s route. ' + bulkHint,
  )
}

/**
 * Whether configured Agent options require route validation before delegation.
 * @param options - Tool-instance child defaults.
 * @returns Whether configured provider, model, or effort values must be resolved.
 */
export function hasConfiguredLlmSelection(options: AgentOptions | undefined): boolean {
  return options?.provider !== undefined
    || options?.model !== undefined
    || options?.reasoningEffort !== undefined
}

/**
 * Resolve an effective child route through its live adapter before the child is
 * created. The LLM runtime owns provider lookup, exact-model metadata, effort
 * validation, and adapter defaults.
 * @param llm - Live LLM runtime.
 * @param parentOptions - Current parent values whose compatible fields the child inherits.
 * @param requested - Per-child options after request/config merging.
 * @param signal - Tool-call cancellation signal.
 * @param inheritParentReasoningEffort - Whether an omitted effort may inherit from the parent route; false for explicit model selection.
 */
export async function preflightChildLlmRoute(
  llm: LlmRuntime,
  parentOptions: AgentOptions,
  requested: AgentOptions | undefined,
  signal: AbortSignal,
  inheritParentReasoningEffort = true,
): Promise<void> {
  const provider = requested?.provider ?? parentOptions.provider
  const model = requested?.model ?? parentOptions.model
  if (provider === undefined || model === undefined) {
    throw new ToolContextUnavailableError('cannot select child LLM values without an effective provider and model')
  }
  const routeChanged = provider !== parentOptions.provider || model !== parentOptions.model
  const reasoningEffort = requested?.reasoningEffort
    ?? (inheritParentReasoningEffort && !routeChanged ? parentOptions.reasoningEffort : undefined)
  await llm.resolveCallConfig({
    provider,
    model,
    ...reasoningEffort === undefined ? {} : { reasoningEffort },
  }, signal)
}
