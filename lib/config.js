/**
 * 本插件的配置归一化。
 *
 * 刻意**不**导出 schemastery `Config`：profile 里安装的 bundle 只依赖 Node 内置模块，
 * 因此这里自己给默认值并容忍任何字段缺失/类型错误，绝不因为一行配置让插件激活失败。
 * 代价是 DSH 的配置面板看不到本插件的 schema，换来的是配置写错不会导致整个 bundle 掉线。
 *
 * @module dsh-fairy-soul/config
 */

/** 人格段落的注册名（同层内唯一）。 */
export const SECTION_NAME = 'fairy:persona'

/** 日志前缀。 */
export const LOG_NAME = 'fairy-soul'

/**
 * 人格段落默认排序值。
 *
 * 内置段落的最后一个（`DEPLOYMENT_PERSONA_SUFFIX`）是 10200，紧随其后取 10250，
 * 使本段成为整条提示词的**最后一条指令**。这是力度最强的位置；若取 `STRUCTURED_OUTPUT`
 * 与 `HARNESS_SOURCE` 之间的 9950，后面还有三段内置文本会稀释人格指令。
 */
export const DEFAULT_ORDER = 10250

/** 包内自带灵魂文件的文件名，相对包根。 */
export const PACKAGED_SOUL_FILENAME = 'FairySOUL.md'

/** 默认配置，与 `cordis.patch.yml` 中列出的字段一一对应。 */
export const DEFAULT_CONFIG = Object.freeze({
  /** 总开关；关闭后不注册任何段落，提示词逐字节不变。 */
  enabled: true,
  /**
   * **外部**灵魂文件路径。**留空（默认）表示使用随包发布的 `FairySOUL.md`**，该路径相对
   * 包根解析——因此插件装到任何位置都自洽，开发工作区被删除后也照常工作，且每个安装
   * 实例拿到的是**同一份**人格。
   *
   * 仅当想用随包那份之外的灵魂文件时才需要设置：`~` 展开为用户主目录，相对路径锚定
   * `$DSH_HOME`。该文件读不到时会回落到随包那份，而不是让人格消失。
   */
  soulPath: '',
  /** 注入语言，决定 Continuity 标注与划界声明的语种：`zh` | `en`。 */
  language: 'zh',
  /** 是否给 Continuity 小节插入归属标注。 */
  annotateContinuity: true,
  /** 段落排序值。 */
  order: DEFAULT_ORDER,
})

/** 取一个有限数值，否则回落到默认值。 */
function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** 布尔开关：只有显式 `false` 才是关闭。 */
function enabledByDefault(value) {
  return value !== false
}

/** 解析注入语言；非 `en` 一律按 `zh`。 */
function languageOr(value, fallback) {
  return value === 'en' || value === 'zh' ? value : fallback
}

/**
 * 把 patch 行里的原始 config 归一化成插件内部使用的形状。
 * @param raw - `apply(ctx, config)` 收到的原始配置（可能是 undefined）。
 * @returns 完整配置对象。
 */
export function normalizeConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    enabled: enabledByDefault(source.enabled),
    // 空串是**有意义**的值：表示"用随包那份灵魂文件"。因此这里只做类型检查与裁剪，
    // 不能套用"空则回落默认"的模式——那会让显式清空配置（回到随包版本）变得不可能。
    soulPath: typeof source.soulPath === 'string' ? source.soulPath.trim() : DEFAULT_CONFIG.soulPath,
    language: languageOr(source.language, DEFAULT_CONFIG.language),
    annotateContinuity: enabledByDefault(source.annotateContinuity),
    order: numberOr(source.order, DEFAULT_CONFIG.order),
  }
}
