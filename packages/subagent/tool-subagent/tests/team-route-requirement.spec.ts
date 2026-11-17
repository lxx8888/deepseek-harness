import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { assertExplicitChildRoute, teamAuthorizedPolicy } from '../src/model-selection.ts'
import type { ChildRouteRequirement } from '../src/model-selection.ts'

/**
 * Stand-in for the Team routing policy.
 *
 * The delegation tool reads the policy softly, so a deployment without Agent
 * Teams mounts nothing and ordinary Sessions keep their inheritance
 * behaviour. This double stands in for the mounted policy.
 */
class FakeTeamRouting extends Service {
  constructor(ctx: Context, private readonly required: boolean) {
    super(ctx, 'teamModelRouting')
  }

  // Not an override: these members come from ChildRouteRequirement, not from
  // the Service base class, so an `override` modifier fails to compile.
  // (Re-applied after f2a3a5ad35 reverted it; see the fix commit for details.)
  requiresExplicitChildRoute(_agent: unknown): boolean {
    return this.required
  }

  bulkRoute(): { provider: string; model: string } {
    return { provider: 'alpha', model: 'bulk-model' }
  }
}

describe('team child route requirement', () => {
  it('does nothing when no Team policy is mounted', () => {
    expect(() => {
      assertExplicitChildRoute(undefined, {}, {})
    }).not.toThrow()
  })

  it('does nothing outside Team mode', () => {
    const requirement: ChildRouteRequirement = {
      requiresExplicitChildRoute: () => false,
      bulkRoute: () => undefined,
    }
    expect(() => {
      assertExplicitChildRoute(requirement, {}, {})
    }).not.toThrow()
  })

  it('refuses a delegation that names no route', () => {
    const requirement: ChildRouteRequirement = {
      requiresExplicitChildRoute: () => true,
      bulkRoute: () => ({ provider: 'alpha', model: 'bulk-model' }),
    }
    expect(() => {
      assertExplicitChildRoute(requirement, {}, {})
    }).toThrow('Team mode requires every child delegation to name its own')
    expect(() => {
      assertExplicitChildRoute(requirement, {}, {})
    }).toThrow('alpha/bulk-model')
  })

  it('refuses a delegation that names only one half of the route', () => {
    const requirement: ChildRouteRequirement = {
      requiresExplicitChildRoute: () => true,
      bulkRoute: () => undefined,
    }
    expect(() => {
      assertExplicitChildRoute(requirement, {}, { provider: 'alpha' })
    }).toThrow('Team mode requires every child delegation to name its own')
    expect(() => {
      assertExplicitChildRoute(requirement, {}, { model: 'child-model' })
    }).toThrow('Team mode requires every child delegation to name its own')
  })

  it('accepts a delegation that names a complete route', () => {
    const requirement: ChildRouteRequirement = {
      requiresExplicitChildRoute: () => true,
      bulkRoute: () => undefined,
    }
    expect(() => {
      assertExplicitChildRoute(requirement, {}, { provider: 'alpha', model: 'child-model' })
    }).not.toThrow()
  })

  it('reads the mounted policy through the real service registration', async () => {
    const ctx = new Context()
    await ctx.plugin(FakeTeamRouting, true)
    const requirement = ctx.get('teamModelRouting') as ChildRouteRequirement
    expect(requirement.requiresExplicitChildRoute({})).toBe(true)
    expect(() => {
      assertExplicitChildRoute(requirement, {}, {})
    }).toThrow('Team mode requires every child delegation to name its own')
    await ctx.fiber.dispose()
  })
})

describe('team authorized routes', () => {
  const active: ChildRouteRequirement = {
    requiresExplicitChildRoute: () => true,
    bulkRoute: () => ({ provider: 'alpha', model: 'bulk-model' }),
    authorizedRoutes: () => [
      { provider: 'alpha', model: 'bulk-model' },
      { provider: 'alpha', model: 'priced-model' },
    ],
  }

  it('leaves the recorded policy alone without a Team policy', () => {
    const policy = { routes: [{ provider: 'alpha', model: 'recorded' }] }
    expect(teamAuthorizedPolicy(policy, undefined, {})).toBe(policy)
  })

  it('leaves the recorded policy alone outside Team mode', () => {
    const policy = { routes: [{ provider: 'alpha', model: 'recorded' }] }
    const inactive: ChildRouteRequirement = { ...active, requiresExplicitChildRoute: () => false }
    expect(teamAuthorizedPolicy(policy, inactive, {})).toBe(policy)
  })

  it('merges priced routes into the recorded allowlist without duplicates', () => {
    const merged = teamAuthorizedPolicy(
      { routes: [{ provider: 'alpha', model: 'recorded' }, { provider: 'alpha', model: 'bulk-model' }] },
      active,
      {},
    )
    expect(merged?.routes.map(route => route.model)).toEqual(['recorded', 'bulk-model', 'priced-model'])
  })

  it('turns priced routes into the allowlist when none is recorded', () => {
    const merged = teamAuthorizedPolicy(undefined, active, {})
    expect(merged?.routes.map(route => route.model)).toEqual(['bulk-model', 'priced-model'])
  })

  it('keeps parent-route-only selection when the policy prices nothing', () => {
    const silent: ChildRouteRequirement = { ...active, authorizedRoutes: () => [] }
    expect(teamAuthorizedPolicy(undefined, silent, {})).toBeUndefined()
  })

  it('keeps the recorded policy when the policy declares no authorization', () => {
    const policy = { routes: [{ provider: 'alpha', model: 'recorded' }] }
    const bare: ChildRouteRequirement = {
      requiresExplicitChildRoute: () => true,
      bulkRoute: () => undefined,
    }
    expect(teamAuthorizedPolicy(policy, bare, {})).toBe(policy)
  })
})
