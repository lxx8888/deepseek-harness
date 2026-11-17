---
description: "拥有团队模式的模型路由策略：价格、决策节点路由与子代理显式路由要求。"
kind: "package-reference"
---

# @deepseek-ai/dsh-team-model-routing

[English](README.md) | 中文

## Summary

`dsh-team-model-routing` 决定团队模式的工作跑在哪个模型上。它持有部署声明的模型价格，指明管理与决策节点保留的路由，指明大批量重复工作使用的路由，并声明子代理派生是否必须显式指定自己的路由。团队模式之外该策略不生效。

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

把本包与 `@deepseek-ai/dsh-agent-team`、`@deepseek-ai/dsh-tool-agent-team` 一起挂载。只有会话开启了团队模式时该策略才生效；未挂载 Agent Teams 的部署不会挂载本包，普通会话保持原有的派生行为。

### Smallest working setup

```yaml
# 在已有可续接子代理的组合之上，团队模式需要的三个包
- name: '@deepseek-ai/dsh-agent-team'
- name: '@deepseek-ai/dsh-team-model-routing'
- name: '@deepseek-ai/dsh-tool-agent-team'
```

配置字段均为可选，启动时校验：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `requireExplicitChildRoute` | `false` | 拒绝未指定 `provider` 与 `model` 的子代理派生 |
| `bulkRoute` | 空 | 大批量、重复性子工作使用的路由 |
| `prices` | 空 | 按精确 provider/model 路由声明的输入与输出价格 |

生成的[配置目录](../../../docs/config-catalog.md#deepseek-aidsh-team-model-routing)是所有可接受字段及其 JSDoc 的完备来源。

### 为什么价格由部署声明

LLM 模型目录不携带任何价格字段，因此对比必须从配置读取。声明你希望参与对比的每一条精确路由：

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

没有价格条目的路由仍会出现在对比中，只是价格一栏为空。已定价的路由同时也是被授权的子路由：团队模式会把价格表并入会话的子路由授权名单，两者不会漂移。

### 策略决定什么

策略为一个团队会话回答三个问题：

- **管理与决策节点用哪个路由？** 会话自身的路由。规划、评审、集成与最终答案都留在它上面。
- **大批量重复工作用哪个路由？** 声明的 bulk 路由。Lead 在机械性扇出时显式选它。
- **子代理是否必须指定自己的路由？** 打开 `requireExplicitChildRoute` 后，未指定路由的派生会被拒绝，于是昂贵的决策模型不会在无察觉的情况下扇出。

### When to choose it

当团队会话会把工作扇出到多个模型、且这份扇出的成本应当在派活前一次性决定，而不是每次派生时再决定时，选它。若每个子代理都应直接继承父路由，普通子代理就足够了。

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>实现细节 —— 点击展开</summary>

### 设计原则

- **团队模式之外关闭。** 策略以软查询方式解析 Team 服务。未挂载 Agent Teams 的部署不会有该服务，策略此时报告自身未激活，而不是失败。
- **事实只有一个归属。** 价格、bulk 路由与显式路由要求都归这里所有。Team 工具读取它们用于对比；派生工具只读取显式路由要求。
- **价格由部署拥有。** LLM 模型目录不含价格，配置是唯一真源，部署改价无需改代码。

### Source map

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口、配置 schema、策略读取与面向模型的指导文本 |
| [`src/pricing.ts`](src/pricing.ts) | 纯粹的价格排序、比较与渲染 |

### 团队模式判定

`active(agent)` 以软查询解析 Team 服务。拒绝调用方的 Team 服务——没有活动根的独立恢复子会话——计为未激活，因此根缺失不会把策略变成错误。

### 会话路由解析

首次请求之后由已记录的请求头拥有路由；在此之前由创建选项回答。中途换模型的会话因此报告它当前所在的路由，而非起始时的路由。

### 价格排序

价格按混合成本从低到高排序，输出 token 的权重是输入的三倍，因为在所有已定价的路由上输出 token 都更贵。重复路由折叠为一行。该对比是部署决策辅助，不是计费记录。

### 授权跟随价格表

派生工具在团队模式要求显式选型时，把 `authorizedRoutes()`（每条已定价路由一项）并入会话已记录的子路由授权名单。部署为某条路由定价即意味着授权它，因此「要求显式选型」永远不会和「从未被告知的授权名单」相撞。团队模式之外，已记录的名单原样生效。

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Agent Teams 子系统](../../../docs/subsystems/agent-team.md)——持久化的 Team 类型与 `ctx.agentTeams` 服务 API。
- [tool-agent-team 包](../tool-agent-team/README.md)——`team_model_compare` 工具与共享看板策略。
- [子代理派生工具](../../subagent/tool-subagent/README.md)——本策略所约束的子路由选择。

-----

<a id="model-experience"></a>
## Model Experience

### 团队路由指导

#### What the model sees

在开启团队模式的会话中，模型看到一段 `team:model-routing` 运行时上下文，点明会话自身的路由（供管理与决策节点使用）、bulk 路由（供大批量重复子工作使用），以及每次子代理派生是否必须显式指定 `provider` 与 `model`。当部署声明了价格时，上下文还会按价格从低到高列出它们，并标出会话路由与 bulk 路由。团队模式之外，上下文不贡献任何内容。

##### 路由上下文

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

该上下文为每个团队会话的模型请求追加一段简短的路由说明。它在每次组装时重新求值，因此会话路由与价格表保持最新，不会变陈旧。

#### KV Cache effect

该上下文是动态运行时上下文而非缓存的系统提示段：它以 user 角色快照的形式落地，因此不会使可复用的请求前缀失效。路由或价格发生变化的团队会话能直接看到新文本，而无需重建提示前缀。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **价格由部署拥有，可能过时。** 策略从不访问定价接口；部署方变更供应商价格时必须自行更新配置。
- **bulk 路由是一项声明，而不是一次测量。** 策略说明大批量工作应该用哪个路由，但不测量一次派生实际代表多少工作量。
- **一张部署级价格表。** 价格不区分供应商档位或账号，也不模拟任何供应商侧折扣。
- **该策略只治理团队模式。** 普通会话继续继承父路由，因此同一组合提供两种不同的派生行为。
