# dsh-fairy-soul

把随包发布的一份 markdown「灵魂文件」注入 DeepSeek Harness 的系统提示词，让模型的**表达风格**长期保持为这份文件所定义的人格。

典型用途：给 Harness 装上 Fairy 人格（《绝区零》的超级智能体），并能在不重启、不改代码的前提下持续打磨这份人格。

## 它做什么 / 不做什么

| | |
|---|---|
| ✅ 改变 | 自称、语气、称呼方式、措辞习惯、口头禅 |
| ❌ 不改变 | 工具调用规范、安全边界、权限与审批规则、工作区指令（`AGENTS.md` 等） |

人格段落开头带一段**划界声明**，明确告诉模型：人格只定义如何表达，运行规范优先级更高且照常生效。这是本插件唯一的机制性保障——提示词是拼接的，Harness 的身份声明与人格段落会同时出现在上下文里，不划界模型会在两种身份间摇摆。

## 安装

零依赖的 host bundle，只使用 Node 内置能力。

**从 GitHub 装：**

```powershell
# 在 DSH 里用 plugin_manager 的 install_bundle，target 传仓库地址：
#   https://github.com/longge1213812138/dsh-fairy-soul
# 或先在本地 clone，再传目录绝对路径
```

**手工装配**到 `$DSH_HOME/profiles/<profile>/package.json`：

```json
{
  "dependencies": {
    "dsh-fairy-soul": "github:longge1213812138/dsh-fairy-soul"
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

装完**需重启 DSH**：bundle 列表与 `node_modules` 在宿主进程启动时确定。此后 `cordis.patch.yml` 与灵魂文件的改动都会实时生效，无需再重启。

### 安装即用，无需配置

灵魂文件 `FairySOUL.md` **随包发布**，相对包根解析。所以：

- 装到任何位置都自洽，**不依赖任何绝对路径**；
- 把插件目录搬到别处、甚至删掉原来的开发目录，都照常工作；
- 每个安装实例拿到的是**同一份**人格，不存在"我这里能跑、你那里不行"。

## 配置

默认情况下**不需要任何配置**。只有想调整行为时才在 profile 的 `cordis.patch.yml` 里按 id 覆盖：

```yaml
- id: fairy-soul
  name: 'dsh-fairy-soul'
  config:
    enabled: true
    soulPath: ''
    language: zh
    annotateContinuity: true
    order: 10250
```

> ⚠️ 按 id 匹配的覆盖会**整体替换** `config`，不是深合并。要改哪个字段就写哪行，但其余需要保留的字段也要一并写出。

| 字段 | 默认值 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关。置 `false` 后不注册任何段落，下次组装请求的系统提示词逐字节恢复原样 |
| `soulPath` | `''`（空） | **留空 = 使用随包的 `FairySOUL.md`**。只有想用随包那份**之外**的人格文件时才填：`~` 展开为主目录，相对路径锚定 `$DSH_HOME`，也可写绝对路径。该路径读不到时会自动回落到随包那份 |
| `language` | `zh` | 划界声明与 Continuity 标注的语种：`zh` \| `en` |
| `annotateContinuity` | `true` | 是否给 `Continuity` 小节插入归属标注 |
| `order` | `10250` | 段落排序值，见下 |

### 换成自己的灵魂文件

想用随包那份之外的灵魂文件（比如放在别处、要跨机器同步的）：

```yaml
- id: fairy-soul
  name: 'dsh-fairy-soul'
  config:
    enabled: true
    soulPath: '~/my-soul.md'   # 或绝对路径
    language: zh
    annotateContinuity: true
    order: 10250
```

读不到时会自动回落到随包的 `FairySOUL.md`，人格不会消失，并在宿主日志里留一条 warn。

### order 怎么选

内置段落的排序从 `-1000`（Harness 身份声明）到 `10200`（部署级人设后缀）。本插件默认取 `10250`，**紧随最后一个内置段落之后**，使人格成为整条提示词的最后一条指令——力度最强的位置。

调低它会让人格被其后的内置文本稀释。例如取 `9950`（插在 `STRUCTURED_OUTPUT` 与 `HARNESS_SOURCE` 之间）后面还有三段内置文本，指令权重明显下降。除非有特别理由，不要改。

## 工作原理

1. `apply()` 里用 `ctx.systemPrompt.section()` 注册一个名为 `fairy:persona` 的段落。
2. 段落的 `text` 是**函数**，每次组装系统提示词时求值，因此灵魂文件可以热更新。
3. 读取灵魂文件 → 剥掉 YAML frontmatter → 给 `Continuity` 小节插入归属标注 → 前置划界声明 → 返回。
4. 灵魂文件读不到时返回**空串**。空串段落会被组装流程直接丢弃，于是退化成"没有本插件"，而不是"请求失败"。

### 为什么人格文件随包发布而不是指向外部路径

指向外部路径会让插件**依赖开发机的目录结构**：一旦把包搬到别处或删掉原目录，人格就消失了，而且别人装下来还得自己配路径。随包发布让"安装即用、人人一致"自动成立。见 [`docs/adr/0004-package-the-soul-file-with-the-plugin.md`](./docs/adr/0004-package-the-soul-file-with-the-plugin.md)。

### 为什么不用 Harness 预留的角色设定槽位

Harness 有 `deployment:persona-prefix` / `deployment:persona-suffix` 两个槽位，看起来正是为人格准备的。但它们会被 `standard` / `ptc` / `minimal` / `cordis` 四个内置 agent preset 各自注册的同名段落**遮蔽**——preset 的作用域比全局更靠近 agent，稳定获胜，改全局配置无效。详见 [`docs/adr/0001`](./docs/adr/0001-inject-persona-as-independent-section.md)。

### 为什么用 `interpolate: false`

Harness 的提示词插值是**严格模式**：段落里出现无法解析的 `{{...}}` 会让**整次组装抛错**，模型收不到任何提示词。灵魂文件是自由 markdown，随时可能写进字面的 `{{`。关掉插值让这类故障彻底不可能发生，代价是本段不能用 `{{cwd}}` 之类的变量——人格设定本来也不需要。

### 为什么不让插件复用 `AGENTS.md` 那条链

Harness 的工作区指令加载器有候选文件名配置，看似可以零代码复用。但用户全局指令的文件名被**硬编码**为 `AGENTS.md`，可配置的候选名只作用于项目目录链；而且它注入的是自带"不覆盖系统指令"前缀的 user 角色消息，人格力度弱于系统提示词段落。详见 [`docs/adr/0003`](./docs/adr/0003-plugin-reads-soul-file-itself.md)。

## 改人格

编辑包内的 `FairySOUL.md` 即可，**下一次模型请求就生效**（按 mtime 失效缓存），无需重启。

若把本插件以 `link:` 方式安装，你编辑的就是 profile 实际使用的那份文件。

## 故障排查

在宿主日志里 grep `[fairy-soul]`：

- `armed (soul=packaged:..., order=10250, language=zh)`：已激活，人格来自随包文件
- `armed (soul=external:..., ...)`：已激活，人格来自配置指定的外部路径
- `cannot read the soul file at ...`：外部路径不存在，已回落到随包那份
- `disabled; the system prompt stays untouched`：配置里 `enabled` 是 `false`
- 没有任何 `[fairy-soul]` 行：插件没被装载，检查 `bundles` 列表与是否重启过

**人格生效但和工具规范打架** —— 检查 `order` 是否被改低，以及灵魂文件里有没有试图覆盖工具行为的条目。运行基底优先是设计前提，不靠提示词措辞去争。

**想要临时关掉** —— 把 `enabled` 改成 `false` 即可，下一次请求就恢复原样，不必重启。

## 开发

三层验证，从内到外：

```powershell
# 1) 单元测试：解析、清洗、缓存、配置归一化
npm test

# 2) 装配级：在假宿主上跑真实 apply()，校验段落契约与"脱离工作区仍可工作"
node verify/harness.mjs

# 3) 安装与发布检查：DSH 装载契约、npm 打包白名单、profile 装配状态
node verify/install-check.mjs

# 4) 端到端：读 profile 里真实的 patch 配置，打印实际注入内容
node verify/render.mjs
```

`verify/render.mjs` 是最贴近线上的一次验证——配置从 profile 的 patch 层读出，输出"重启之后模型到底会看到什么"。

检查发布产物：

```powershell
npm pack --dry-run   # 应看到 FairySOUL.md 在列表里
```

> `--experimental-test-isolation=none` 是必需的（已写进 `npm test`）：默认模式下测试运行器会为每个测试文件 fork 子进程并通过管道通信，在受限文件沙箱里会失败于 `spawn EPERM`。

术语定义见 [`GLOSSARY.md`](./GLOSSARY.md)，设计决策见 [`docs/adr/`](./docs/adr/)。
