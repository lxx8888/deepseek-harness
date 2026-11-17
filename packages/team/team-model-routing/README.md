---
description: "Own the Team-mode model routing policy: prices, decision-node route, and explicit child routes."
kind: "package-reference"
---

# @deepseek-ai/dsh-team-model-routing

English | [中文](README.zh.md)

## Summary

`dsh-team-model-routing` owns which model Team-mode work runs on. It holds the deployment-declared model prices, names the route management and decision nodes keep, names the bulk route large repetitive work uses, and states whether a child delegation must name its own route. The policy is off outside Team mode.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount this package beside `@deepseek-ai/dsh-agent-team` and `@deepseek-ai/dsh-tool-agent-team`. The policy only governs a Session while Team mode is enabled for it; a deployment without Agent Teams mounts nothing and ordinary Sessions keep their existing delegation behaviour.

### Smallest working setup

```yaml
# Team additions over a composition with continuable subagents
- name: '@deepseek-ai/dsh-agent-team'
- name: '@deepseek-ai/dsh-team-model-routing'
- name: '@deepseek-ai/dsh-tool-agent-team'
```

Configuration fields are optional and validated at startup:

| Field | Default | Meaning |
|---|---|---|
| `requireExplicitChildRoute` | `false` | Refuse a child delegation that names no `provider` and `model` |
| `bulkRoute` | empty | The route large-volume, repetitive child work uses |
| `prices` | empty | Deployment-declared input and output prices per exact provider/model route |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-team-model-routing) is the exhaustive source for every accepted field and its JSDoc.

### Why prices are deployment-owned

The LLM model directory carries no price fields, so a comparison has to read them from configuration. Declare one entry per exact route you want compared:

```yaml
- name: '@deepseek-ai/dsh-team-model-routing'
  config:
    requireExplicitChildRoute: true
    bulkRoute:
      provider: deepseek-official
      model: deepseek-flash
    prices:
      - provider: deepseek-official
        model: deepseek-flash
        inputPerMillion: 0.051
        outputPerMillion: 0.567
        currency: USD
      - provider: deepseek-official
        model: deepseek-v4-pro
        inputPerMillion: 1.32
        outputPerMillion: 3.96
        currency: USD
```

A route without a price entry still appears in the comparison; only its price cell is absent. A priced route is also an authorized child route: Team mode merges the price table into the Session's child-route allowlist, so the two facts cannot drift apart.

### What the policy decides

The policy answers three questions for a Team Session:

- **Which route do management and decision nodes use?** The Session's own route. Planning, review, integration, and the final answer stay on it.
- **Which route does large-volume, repetitive work use?** The declared bulk route. A Lead picks it explicitly for mechanical fan-out.
- **Must a child name its own route?** When `requireExplicitChildRoute` is on, a delegation that names no route is refused, so an expensive decision model never fans out unnoticed.

### When to choose it

Choose it when a Team Session fans work out across models and the cost of that fan-out should be decided once, up front, rather than per delegation. Plain subagents suffice when every child should simply inherit the parent route.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design philosophy

- **Off outside Team mode.** The policy reads the Team service softly. A deployment without Agent Teams never mounts the Team service, and the policy then reports itself inactive rather than failing.
- **One owner of the facts.** Prices, the bulk route, and the explicit-route requirement live here. The Team tool reads them for the comparison; the delegation tool reads only the requirement.
- **Deployment-owned prices.** The LLM model directory carries none, so configuration is the source of truth and a deployment can reprice without a code change.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry, configuration schema, policy reads, and the model-facing guidance text |
| [`src/pricing.ts`](src/pricing.ts) | Pure price ordering, comparison, and rendering |

### Team-mode detection

`active(agent)` resolves the Team service with a soft query. A Team service that refuses the caller — an independently resumed child with no active root — counts as inactive, so a missing root never turns a policy into an error.

### Session route resolution

The recorded request header owns the route after the first request; the creation options answer before that. A Session that changes model mid-flight therefore reports the route it is currently on, not the one it started with.

### Price ordering

Prices sort cheapest-first by a blended cost that weights output tokens three times input, because output tokens cost more on every priced route. Duplicate routes collapse to one row. The comparison is a deployment decision aid, not an accounting record.

### Authorization follows the price table

The delegation tool merges `authorizedRoutes()` — one entry per priced route — into the Session's recorded child-route allowlist while Team mode requires explicit selection. A deployment that prices a route thereby authorizes it, so requiring an explicit route can never collide with an allowlist that was never told about it. Outside Team mode the recorded allowlist stands exactly as written.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Agent Teams subsystem](../../../docs/subsystems/agent-team.md) — durable Team types and the `ctx.agentTeams` service API.
- [tool-agent-team package](../tool-agent-team/README.md) — the `team_model_compare` tool and the shared-board policy.
- [Subagent delegation tool](../../subagent/tool-subagent/README.md) — the child route selection this policy constrains.

-----

<a id="model-experience"></a>
## Model Experience

### Team routing guidance

#### What the model sees

In a Team-enabled Session, the model sees a `team:model-routing` runtime context naming the Session's own route for management and decision nodes, the bulk route for large-volume, repetitive child work, and whether every child delegation must name its own `provider` and `model`. When the deployment declares prices, the context also lists them cheapest-first and marks the Session route and the bulk route. Outside Team mode the context contributes nothing.

##### The routing context

```markdown
Team model routing policy:
- Management and decision nodes (planning, review, integration, the final answer) run on this Session's own route: deepseek-official/deepseek-v4-pro.
- Large-volume, repetitive child work runs on the bulk route: deepseek-official/deepseek-flash.
- Every child delegation must name its own `provider` and `model`; a child never inherits this Session's route. Pick the route that fits the work.
Declared prices (cheapest first):
- deepseek-official/deepseek-flash [bulk route]: in 0.051/USD/Mtok, out 0.567/USD/Mtok
- deepseek-official/deepseek-v4-pro [session route]: in 1.32/USD/Mtok, out 3.96/USD/Mtok
Compare routes with `team_model_compare` before dispatching work.
```

#### Token effect

The context adds a short routing statement to each Team Session's model request. It is re-evaluated per assembly, so the Session route and the price table stay current rather than going stale.

#### KV Cache effect

The context is dynamic runtime context, not a cached system-prompt section: it is materialized as a user-role snapshot and therefore does not invalidate the reusable request prefix. A Team Session whose route or prices change sees the new text without rebuilding its prompt prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Prices are deployment-owned and can go stale.** The policy never contacts a pricing endpoint; a deployment that changes provider pricing must update its configuration.
- **The bulk route is a declaration, not a measurement.** The policy states which route bulk work should use; it does not measure how much work a delegation actually represents.
- **One deployment table.** Prices are not per-provider-tier or per-account, and no provider-side discount is modelled.
- **The policy governs Team mode only.** Ordinary Sessions keep inheriting the parent route, so the same composition offers two different delegation behaviours.
