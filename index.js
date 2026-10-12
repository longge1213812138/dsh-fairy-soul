/**
 * Fairy 灵魂注入（DeepSeek Harness 宿主插件）。
 *
 * 把随包发布的一份 markdown「灵魂文件」注册成系统提示词的一个段落，让模型的**表达**
 * 长期保持为 Fairy 设定。
 *
 * 三个设计约束：
 *
 *  1. **注入点是独立段落名，不是角色设定槽位。** Harness 预留的
 *     `deployment:persona-prefix` / `deployment:persona-suffix` 会被四个内置 agent
 *     preset 各自注册的同名段落遮蔽（preset 作用域更靠近 agent，稳定获胜）。详见
 *     `docs/adr/0001-inject-persona-as-independent-section.md`。
 *
 *  2. **只覆盖表达，不接管运行基底。** 段落开头带划界声明：人格只定义自称、语气、
 *     称呼与措辞；工具调用规范、安全边界、权限与审批、工作区指令全部照常生效。详见
 *     `docs/adr/0002-persona-overrides-voice-not-substrate.md`。
 *
 *  3. **灵魂文件随包发布，相对包根定位。** 不依赖任何机器的目录结构，因此插件装到
 *     任何位置都自洽、"安装即用、人人一致"。详见
 *     `docs/adr/0004-package-the-soul-file-with-the-plugin.md`。
 *
 * 容错原则：任何异常都不注册失败、不抛错。灵魂文件读不到时段落文本为空串，而空段落
 * 会被组装流程直接丢弃，因此退化成"没有本插件"而不是"请求失败"。
 *
 * @module dsh-fairy-soul
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { LOG_NAME, PACKAGED_SOUL_FILENAME, SECTION_NAME, normalizeConfig } from './lib/config.js'
import { createSoulSource, resolveSoulPath } from './lib/soul.js'

export {
  SECTION_NAME,
  LOG_NAME,
  DEFAULT_ORDER,
  DEFAULT_CONFIG,
  PACKAGED_SOUL_FILENAME,
  normalizeConfig,
} from './lib/config.js'
export { createSoulSource, prepareSoul, resolveSoulPath, stripFrontmatter } from './lib/soul.js'

/** Cordis 插件名。 */
export const name = 'fairy-soul'

/** 需要的服务：没有 `systemPrompt` 的 profile 里本插件保持未激活而不是抛错。 */
export const inject = ['systemPrompt']

/** 包根目录。`index.js` 就在包根，取一层 dirname 即可。 */
const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url))

/**
 * 随包发布的灵魂文件路径。
 *
 * 这是**默认**人格来源，相对包根解析——所以插件装到任何位置都自洽，开发工作区被删除
 * 之后也照常工作，而且每个安装实例拿到的都是同一份人格，不需要任何逐机配置。
 */
export const PACKAGED_SOUL_PATH = join(PACKAGE_ROOT, PACKAGED_SOUL_FILENAME)

/**
 * 各语言的划界声明。
 *
 * 这是本插件**唯一**的机制性保障：提示词是拼接的，`harness:identity` 与人格段落会同时
 * 出现在上下文里。不划界的话模型会在两种身份间摇摆，或把人格文本误读成对工具规范的覆盖。
 */
const FRAMING = Object.freeze({
  zh: [
    '以下是一份长期人格设定。它**只**定义你如何表达：自称、语气、称呼与措辞。',
    '它不是对运行规范的覆盖——工具调用规范、安全边界、权限与审批规则、以及工作区指令',
    '全部照常完整生效，且优先级高于本段。本段与它们冲突时，以它们为准。',
    '',
    '---',
    '',
  ].join('\n'),
  en: [
    'Below is a long-term persona definition. It defines **only** how you express yourself:',
    'self-reference, tone, forms of address, and wording.',
    'It does not override your operating rules — tool-call policy, safety boundaries, permission',
    'and approval rules, and workspace instructions all remain fully in force and take precedence',
    'over this section. Where this section conflicts with them, they win.',
    '',
    '---',
    '',
  ].join('\n'),
})

/**
 * 组装本次要注入的段落文本。
 *
 * @param readSoul - 灵魂正文读取器（已带缓存）。
 * @param language - 注入语言。
 * @returns 段落文本；读不到灵魂文件时为空串。
 */
export function composeSectionText(readSoul, language) {
  const soul = readSoul()
  if (typeof soul !== 'string' || soul.trim().length === 0) return ''
  const framing = FRAMING[language] ?? FRAMING.zh
  return `${framing}${soul.trim()}`
}

/**
 * 注册人格段落。
 * @param ctx - 插件上下文。
 * @param config - `cordis.patch.yml` 中该行的 `config`。
 */
export function apply(ctx, config) {
  const settings = normalizeConfig(config)
  const logger = typeof ctx.logger === 'function' ? ctx.logger(LOG_NAME) : console

  if (!settings.enabled) {
    logger.info('disabled; the system prompt stays untouched')
    return
  }

  // 人格来源的优先级：
  //   1. 配置里的外部路径 —— 仅当你显式想用随包那份**之外**的人格文件时才存在
  //   2. 随包发布的 FairySOUL.md —— **默认**，也是"安装即用、人人一致"的实现
  // 两者都读不到时段落为空串，被组装流程丢弃：退化成"没有本插件"而不是请求失败。
  const externalPath = settings.soulPath.length > 0 ? resolveSoulPath(settings.soulPath) : undefined
  const readSoul = createSoulSource(
    {
      soulPath: externalPath ?? PACKAGED_SOUL_PATH,
      fallbackPath: externalPath === undefined ? undefined : PACKAGED_SOUL_PATH,
      annotateContinuity: settings.annotateContinuity,
      language: settings.language,
    },
    logger,
  )

  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: SECTION_NAME,
        order: settings.order,
        text: () => composeSectionText(readSoul, settings.language),
        // 关闭插值：灵魂文件是自由 markdown，一旦出现字面 `{{` 就会触发严格插值并
        // 抛错，让**整次组装失败**、模型收不到任何提示词。代价是本段不能用 {{cwd}}
        // 之类的变量，而人格设定本来也不需要它们。
        interpolate: false,
      }),
    'fairySoul.section()',
  )

  const source = externalPath === undefined ? `packaged:${PACKAGED_SOUL_PATH}` : `external:${externalPath}`
  logger.info(`armed (soul=${source}, order=${settings.order}, language=${settings.language})`)
}
