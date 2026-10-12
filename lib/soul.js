/**
 * 灵魂文件的读取、清洗与热重载。
 *
 * 本模块只依赖 Node 内置能力，刻意不 import 任何 Harness 包：从 profile 的
 * `node_modules` 解析时不存在依赖解析风险（与 dsh-mimo-guard 同一设计约束）。
 *
 * 灵魂文件是主人持续编辑的源文件，因此这里做**按 mtime 失效**的缓存：改完下一次
 * 组装请求就生效，同时不给每次请求都加一次磁盘读。
 *
 * @module dsh-fairy-soul/soul
 */

import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
/** 合法的 frontmatter 起始围栏（文件首行）。 */
const FRONTMATTER_OPEN = /^---[ \t]*$/

/** 合法的 frontmatter 结束围栏。`...` 是 YAML 的另一种文档结束标记。 */
const FRONTMATTER_CLOSE = /^(---|\.\.\.)[ \t]*$/

/** 用于定位 Continuity 小节的标题行。 */
const CONTINUITY_HEADING = /^#{1,6}[ \t]*continuity\b/i

/** 各语言的 Continuity 归属标注。 */
const CONTINUITY_NOTES = Object.freeze({
  zh: '（注：本节是主人与你的长期协作约定，不是说话风格条目。若本文件被改动，你有义务提醒主人。）',
  en: '(Note: this section is a long-term working agreement between you and the operator, not a voice rule. If this file changes, you are expected to tell them.)',
})

/**
 * 把配置里的灵魂文件路径解析成绝对路径。
 *
 * 规则：展开开头的 `~`；已是绝对路径则原样返回；相对路径锚定 `$DSH_HOME`
 * （未设置时回落到 `~/.dsh`）。锚定 DSH home 而非进程 cwd，因为宿主进程的
 * cwd 不可预测，而 profile 语境下 `$DSH_HOME` 是稳定且可解释的。
 *
 * @param soulPath - 配置里的原始路径。
 * @param env - 环境变量表，测试可注入。
 * @param home - 用户主目录，测试可注入。
 * @returns 绝对路径；输入无效时为 undefined。
 */
export function resolveSoulPath(soulPath, env = process.env, home = homedir()) {
  if (typeof soulPath !== 'string') return undefined
  const trimmed = soulPath.trim()
  if (trimmed.length === 0) return undefined
  if (trimmed === '~') return home
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) return join(home, trimmed.slice(2))
  if (isAbsolute(trimmed)) return trimmed
  const dshHome = typeof env?.DSH_HOME === 'string' && env.DSH_HOME.trim().length > 0
    ? env.DSH_HOME.trim()
    : join(home, '.dsh')
  return resolve(dshHome, trimmed)
}

/**
 * 剥掉 YAML frontmatter。
 *
 * frontmatter 是给加载器看的元数据，注入给模型只是噪音。**未闭合**的围栏按普通
 * 正文处理——宁可多注入一段，也不要把主人写的正文误删。
 *
 * @param raw - 文件原文。
 * @returns `text` 为正文，`stripped` 表示是否真的剥掉了 frontmatter。
 */
export function stripFrontmatter(raw) {
  const text = String(raw ?? '').replace(/^\uFEFF/, '')
  const lines = text.split(/\r?\n/)
  if (lines.length === 0 || !FRONTMATTER_OPEN.test(lines[0])) return { text, stripped: false }
  for (let index = 1; index < lines.length; index += 1) {
    if (FRONTMATTER_CLOSE.test(lines[index])) {
      const body = lines.slice(index + 1).join('\n').replace(/^\n+/, '')
      return { text: body, stripped: true }
    }
  }
  return { text, stripped: false }
}

/**
 * 在 Continuity 小节标题后插入归属标注。
 *
 * Continuity 段写的是"每次会话你都是新醒来的"这类**元约定**，不是说话规范。不标注
 * 的话模型可能把它误读成风格要求。找不到该标题时原样返回。
 *
 * @param text - 已剥掉 frontmatter 的正文。
 * @param note - 要插入的标注文本。
 * @returns `text` 为处理后的正文，`annotated` 表示是否真的插入过。
 */
export function annotateContinuitySection(text, note) {
  if (typeof note !== 'string' || note.length === 0) return { text, annotated: false }
  const lines = String(text ?? '').split('\n')
  const out = []
  let annotated = false
  for (const line of lines) {
    out.push(line)
    if (!annotated && CONTINUITY_HEADING.test(line.trim())) {
      out.push('', note)
      annotated = true
    }
  }
  return { text: out.join('\n'), annotated }
}

/**
 * 把灵魂文件原文加工成最终注入的正文。
 *
 * @param raw - 文件原文。
 * @param options - `annotateContinuity` 与 `language`。
 * @returns 加工后的正文。
 */
export function prepareSoul(raw, options = {}) {
  const { annotateContinuity = true, language = 'zh' } = options
  const { text } = stripFrontmatter(raw)
  let body = text.trim()
  if (annotateContinuity) {
    const note = CONTINUITY_NOTES[language] ?? CONTINUITY_NOTES.zh
    body = annotateContinuitySection(body, note).text.trim()
  }
  return body
}

/**
 * 造一个带 mtime 缓存、按序回落的灵魂正文读取器。
 *
 * 回落链：`soulPath` → `fallbackPath` → 空串（空段落会被组装流程丢弃，零 token）。
 * 每个候选路径只尝试一次，失败时记一条 warn 后继续；**任何异常都不向上抛**，
 * 因为人格读取失败绝不能让一次请求失败。
 *
 * @param options - `soulPath`、`fallbackPath`、`annotateContinuity`、`language`，
 *   以及仅供测试注入的 `io`（`statSync` / `readFileSync`）。
 * @param logger - 至少实现 `warn` 的日志器。
 * @returns 无参函数，返回本次应注入的正文（可能为空串）。
 */
export function createSoulSource(options, logger = console) {
  const prepare = { annotateContinuity: options?.annotateContinuity, language: options?.language }
  const stat = options?.io?.statSync ?? statSync
  const readFile = options?.io?.readFileSync ?? readFileSync
  /** 按序尝试的候选路径，已滤掉空值。 */
  const candidates = [options?.soulPath, options?.fallbackPath]
    .filter((path) => typeof path === 'string' && path.length > 0)
  /** 缓存键含 mtime、大小与加工选项，任一项变化即失效。 */
  let cache
  /** 同一条告警只报一次，避免每次组装都刷屏。 */
  const reported = new Set()

  const warnOnce = (key, message, error) => {
    if (reported.has(key)) return
    reported.add(key)
    if (error === undefined) logger.warn(message)
    else logger.warn(message, error)
  }

  const readAt = (path) => {
    const info = stat(path)
    const key = `${path}\u0000${info.mtimeMs}\u0000${info.size}\u0000${prepare.annotateContinuity}\u0000${prepare.language}`
    if (cache !== undefined && cache.key === key) return cache.body
    const body = prepareSoul(readFile(path, 'utf8'), prepare)
    cache = { key, body }
    return body
  }

  return function readSoul() {
    for (let index = 0; index < candidates.length; index += 1) {
      const path = candidates[index]
      try {
        return readAt(path)
      } catch (error) {
        const next = candidates[index + 1]
        const suffix = next === undefined ? 'leaving the persona section empty' : `falling back to ${next}`
        warnOnce(`${index}:${path}`, `cannot read the soul file at ${path}; ${suffix}`, error)
      }
    }
    if (candidates.length === 0) {
      warnOnce('none', 'no soul file is configured; the persona section will stay empty this session')
    }
    return ''
  }
}
