import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import TeamService from '@deepseek-ai/dsh-agent-team'
import TeamModelRouting from '@deepseek-ai/dsh-team-model-routing'
import SubagentService from '@deepseek-ai/dsh-subagent'
import { assertExplicitChildRoute } from '../../../subagent/tool-subagent/src/model-selection.ts'
import type { ChildRouteRequirement } from '../../../subagent/tool-subagent/src/model-selection.ts'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { MockAdapter } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { mountWorkingDirectoryFixture } from '../../../subagent/subagent/tests/working-directory-fixture.ts'
import * as toolTeam from '../src/index.ts'

const SIGNAL = new AbortController().signal
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Adapter double advertising two priced routes. */
class CatalogAdapter extends MockAdapter {
  constructor() {
    super([])
  }

  override async listModels(provider: string) {
    return [
      { provider, id: 'session-model', name: 'Session Model' },
      { provider, id: 'bulk-model', name: 'Bulk Model' },
    ]
  }
}

/**
 * Mount the Team stack with the routing policy and one Team-enabled lead.
 * @param enabled - whether Team mode is selected for the lead.
 * @returns the assembled context and the lead agent.
 */
async function setup(enabled = true): Promise<{ ctx: Context; lead: Agent }> {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await mountWorkingDirectoryFixture(ctx)
  const storageRoot = mkdtempSync(join(tmpdir(), 'dsh-team-routing-'))
  roots.push(storageRoot)
  await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(TeamService)
  await ctx.plugin(TeamModelRouting, {
    requireExplicitChildRoute: true,
    bulkRoute: { provider: 'mock', model: 'bulk-model' },
    prices: [
      {
        provider: 'mock',
        model: 'session-model',
        inputPerMillion: 1.32,
        outputPerMillion: 3.96,
        currency: 'USD',
      },
      {
        provider: 'mock',
        model: 'bulk-model',
        inputPerMillion: 0.051,
        outputPerMillion: 0.567,
        currency: 'USD',
      },
    ],
  })
  await ctx.plugin(toolTeam)
  ctx.llm.registerAdapter(['mock'], new CatalogAdapter())
  const lead = await ctx.agentLoop.create(SessionId('team-routing-lead'), { provider: 'mock', model: 'session-model' })
  if (enabled) await ctx.agentTeams.setEnabled(lead, true)
  return { ctx, lead }
}

/** Execute one Team tool through the real tool pipeline. */
async function execute(ctx: Context, agent: Agent, name: string, args: unknown) {
  const toolSet = await ctx.tools.resolve({
    agent, modelSelection: { provider: 'mock', model: 'session-model' }, signal: SIGNAL,
  })
  try {
    return await executeToolFixture(ctx, {
      callId: ToolCallId('team-routing-call'),
      name,
      arguments: args,
      signal: SIGNAL,
      toolSet,
      agent,
    })
  } finally {
    toolSet.dispose()
  }
}

describe('team model routing', () => {
  it('reports itself inactive outside Team mode', async () => {
    const { ctx, lead } = await setup(false)
    const routing = ctx.get('teamModelRouting')!
    expect(routing.active(lead)).toBe(false)
    expect(routing.requiresExplicitChildRoute(lead)).toBe(false)
    expect(routing.guidance(lead)).toBe('')
    await ctx.fiber.dispose()
  })

  it('keeps the Session route for decision nodes and names the bulk route', async () => {
    const { ctx, lead } = await setup()
    const routing = ctx.get('teamModelRouting')!
    expect(routing.active(lead)).toBe(true)
    expect(routing.requiresExplicitChildRoute(lead)).toBe(true)
    expect(routing.sessionRouteOf(lead)).toEqual({ provider: 'mock', model: 'session-model' })
    expect(routing.bulkRoute()).toEqual({ provider: 'mock', model: 'bulk-model' })

    const guidance = routing.guidance(lead)
    expect(guidance).toContain('mock/session-model')
    expect(guidance).toContain('mock/bulk-model')
    expect(guidance).toContain('must name its own `provider` and `model`')
    expect(guidance).toContain('team_model_compare')
    await ctx.fiber.dispose()
  })

  it('sorts declared prices cheapest-first', async () => {
    const { ctx } = await setup()
    const routing = ctx.get('teamModelRouting')!
    const prices = routing.prices()
    expect(prices.map(price => price.model)).toEqual(['bulk-model', 'session-model'])
    await ctx.fiber.dispose()
  })

  it('compares routes and marks the session and bulk routes', async () => {
    const { ctx, lead } = await setup()
    const result = await execute(ctx, lead, 'team_model_compare', {})
    expect(result.isError).toBe(false)
    const payload = JSON.parse(
      result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join(''),
    ) as {
      sessionRoute: { provider: string; model: string }
      bulkRoute: { provider: string; model: string }
      requiresExplicitChildRoute: boolean
      models: {
        model: string
        price?: { inputPerMillion: number; outputPerMillion: number; currency: string }
        bulkRoute: boolean
        sessionRoute: boolean
      }[]
    }
    expect(payload.sessionRoute).toEqual({ provider: 'mock', model: 'session-model' })
    expect(payload.bulkRoute).toEqual({ provider: 'mock', model: 'bulk-model' })
    expect(payload.requiresExplicitChildRoute).toBe(true)
    expect(payload.models.map(row => row.model)).toEqual(['bulk-model', 'session-model'])
    expect(payload.models[0]?.price).toEqual({
      inputPerMillion: 0.051,
      outputPerMillion: 0.567,
      currency: 'USD',
    })
    expect(payload.models[0]?.bulkRoute).toBe(true)
    expect(payload.models[1]?.sessionRoute).toBe(true)
    await ctx.fiber.dispose()
  })

  it('hides the comparison tool outside Team mode', async () => {
    const { ctx, lead } = await setup(false)
    const toolSet = await ctx.tools.resolve({
      agent: lead, modelSelection: { provider: 'mock', model: 'session-model' }, signal: SIGNAL,
    })
    try {
      const names = ctx.tools.schemas(lead, toolSet).map(tool => tool.name)
      expect(names).not.toContain('team_model_compare')
      expect(names).not.toContain('team_task_create')
    } finally {
      toolSet.dispose()
    }
    await ctx.fiber.dispose()
  })

  it('offers the comparison tool inside Team mode', async () => {
    const { ctx, lead } = await setup()
    const toolSet = await ctx.tools.resolve({
      agent: lead, modelSelection: { provider: 'mock', model: 'session-model' }, signal: SIGNAL,
    })
    try {
      const names = ctx.tools.schemas(lead, toolSet).map(tool => tool.name)
      expect(names).toContain('team_model_compare')
      expect(names).toContain('team_task_create')
    } finally {
      toolSet.dispose()
    }
    await ctx.fiber.dispose()
  })

  it('refuses a child delegation that names no route inside Team mode', () => {
    const requirement: ChildRouteRequirement = {
      requiresExplicitChildRoute: () => true,
      bulkRoute: () => ({ provider: 'mock', model: 'bulk-model' }),
    }
    expect(() => {
      assertExplicitChildRoute(requirement, {}, {})
    }).toThrow('Team mode requires every child delegation to name its own')
  })
})
