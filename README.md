# dsh-fairy-soul

把一份外部 markdown「灵魂文件」注入 DeepSeek Harness 的系统提示词，让模型的**表达风格**长期保持为这份文件所定义的人格。

典型用途：给 Harness 装上 Fairy 人格（《绝区零》的超级智能体），并能在不重启、不改代码的前提下持续打磨这份人格。

## 它做什么 / 不做什么

| | |
|---|---|
| ✅ 改变 | 自称、语气、称呼方式、措辞习惯、口头禅 |
| ❌ 不改变 | 工具调用规范、安全边界、权限与审批规则、工作区指令（`AGENTS.md` 等） |

人格段落开头带一段**划界声明**，明确告诉模型：人格只定义如何表达，运行规范优先级更高且照常生效。这是本插件唯一的机制性保障——提示词是拼接的，Harness 的身份声明与人格段落会同时出现在上下文里，不划界模型会在两种身份间摇摆。

## 安装

插件是零依赖的 host bundle，只需要 Node 内置能力。

```powershell
# 1. 以本地目录形式装进 profile
#    也可在 DSH 里用 plugin_manager 的 install_bundle，target 传本目录绝对路径
```

或手工装配到 `$DSH_HOME/profiles/<profile>/package.json`：

```json
{
  "dependencies": {
    "dsh-fairy-soul": "link:C:/Users/91533/Desktop/Fairy插件"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "...",
        "dsh-fairy-soul"
      ]
    }
  }
}
```

装完**需重启 DSH**：bundle 列表与 `node_modules` 在宿主进程启动时确定。此后本插件的 `cordis.patch.yml` 与灵魂文件的改动都会实时生效，无需再重启。

## 配置

在 profile 的 `cordis.patch.yml` 里按 id 覆盖本插件的配置行：

```yaml
- id: fairy-soul
  name: 'dsh-fairy-soul'
  config:
    enabled: true
    soulPath: 'C:\Users\91533\Desktop\Fairy插件\FairySOUL.md'
    language: zh
    annotateContinuity: true
    order: 10250
```

> ⚠️ 按 id 匹配的覆盖会**整体替换** `config`，不是深合并。要改哪个字段就写哪行，但其余需要保留的字段也要一并写出。

| 字段 | 默认值 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关。置 `false` 后不注册任何段落，下次组装请求的系统提示词逐字节恢复原样 |
| `soulPath` | `~/.dsh/FairySOUL.md` | 灵魂文件路径。`~` 展开为主目录；相对路径锚定 `$DSH_HOME` |
| `language` | `zh` | 划界声明与 Continuity 标注的语种：`zh` \| `en` |
| `annotateContinuity` | `true` | 是否给 `Continuity` 小节插入归属标注 |
| `order` | `10250` | 段落排序值，见下 |

### order 怎么选

内置段落的排序从 `-1000`（Harness 身份声明）到 `10200`（部署级人设后缀）。本插件默认取 `10250`，**紧随最后一个内置段落之后**，使人格成为整条提示词的最后一条指令——力度最强的位置。

调低它会让人格被其后的内置文本稀释。例如取 `9950`（插在 `STRUCTURED_OUTPUT` 与 `HARNESS_SOURCE` 之间）后面还有三段内置文本，指令权重明显下降。除非有特别理由，不要改。

## 工作原理

1. `apply()` 里用 `ctx.systemPrompt.section()` 注册一个名为 `fairy:persona` 的段落。
2. 段落的 `text` 是**函数**，每次组装系统提示词时求值，因此灵魂文件可以热更新。
3. 读取灵魂文件 → 剥掉 YAML frontmatter → 给 `Continuity` 小节插入归属标注 → 前置划界声明 → 返回。
4. 灵魂文件读不到时返回**空串**。空串段落会被组装流程直接丢弃，于是退化成"没有本插件"，而不是"请求失败"。

### 为什么不用 Harness 预留的角色设定槽位

Harness 有 `deployment:persona-prefix` / `deployment:persona-suffix` 两个槽位，看起来正是为人格准备的。但它们会被 `standard` / `ptc` / `minimal` / `cordis` 四个内置 agent preset 各自注册的同名段落**遮蔽**——preset 的作用域比全局更靠近 agent，稳定获胜，改全局配置无效。详见 [`docs/adr/0001`](./docs/adr/0001-inject-persona-as-independent-section.md)。

### 为什么用 `interpolate: false`

Harness 的提示词插值是**严格模式**：段落里出现无法解析的 `{{...}}` 会让**整次组装抛错**，模型收不到任何提示词。灵魂文件是自由 markdown，随时可能写进字面的 `{{`。关掉插值让这类故障彻底不可能发生，代价是本段不能用 `{{cwd}}` 之类的变量——人格设定本来也不需要。

### 为什么不让插件自己读 `AGENTS.md` 那条链

Harness 的工作区指令加载器有候选文件名配置，看似可以零代码复用。但用户全局指令的文件名被**硬编码**为 `AGENTS.md`，可配置的候选名只作用于项目目录链；而且它注入的是自带"不覆盖系统指令"前缀的 user 角色消息，人格力度弱于系统提示词段落。详见 [`docs/adr/0003`](./docs/adr/0003-plugin-reads-soul-file-itself.md)。

## 热重载

| 改什么 | 何时生效 |
|---|---|
| 灵魂文件正文 | 下一次组装请求（按 mtime 失效缓存） |
| `cordis.patch.yml` 里的配置 | 下一次组装请求（loader 监听该文件） |
| `index.js` / `lib/*.js` | 需重启 DSH |

## 故障排查

**人格没生效** —— 在宿主日志里 grep `[fairy-soul]`：

- `armed (soulPath=..., order=..., language=...)`：已激活，路径与排序值都打印出来了
- `cannot read the soul file at ...`：路径不对或文件不存在，此时会回落到包内 `soul.default.md`
- `disabled; the system prompt stays untouched`：配置里 `enabled` 是 `false`
- 没有任何 `[fairy-soul]` 行：插件没被装载，检查 `bundles` 列表与是否重启过

**人格生效但和工具规范打架** —— 检查 `order` 是否被改低，以及灵魂文件里有没有试图覆盖工具行为的条目。运行基底优先是设计前提，不靠提示词措辞去争。

**想要临时关掉** —— 把 `enabled` 改成 `false` 即可，下一次请求就恢复原样，不必重启。

## 开发

三层验证，从内到外：

```powershell
# 1) 单元测试：解析、清洗、缓存、配置归一化
node --test --experimental-test-isolation=none

# 2) 装配级：在假宿主上跑真实 apply()，校验段落契约
node verify/harness.mjs

# 3) 安装检查：从 profile 视角确认能被解析、bundles 已登记、灵魂文件可用
node verify/install-check.mjs

# 4) 端到端：读 profile 里真实的 patch 配置，打印实际注入内容
node verify/render.mjs
```

`verify/render.mjs` 是最贴近线上的一次验证——配置从 profile 的 patch 层读出，输出"重启之后模型到底会看到什么"。

> `--experimental-test-isolation=none` 是必需的：默认模式下测试运行器会为每个测试文件 fork 子进程并通过管道通信，在受限文件沙箱里会失败于 `spawn EPERM`。

术语定义见 [`GLOSSARY.md`](./GLOSSARY.md)，设计决策见 [`docs/adr/`](./docs/adr/)。
