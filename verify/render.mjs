/**
 * 端到端渲染：用 profile 里**真实部署的配置**跑一次 `apply()`，打印实际注入的段落。
 *
 * 这是最贴近线上的一次验证——配置从 profile 的 patch 层读出，而不是用默认值或测试桩。
 * 它回答的是"重启之后，模型到底会看到什么"。
 *
 * 运行：node verify/render.mjs
 *
 * @module dsh-fairy-soul/verify/render
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { apply, PACKAGED_SOUL_PATH } from '../index.js'
import { normalizeConfig } from '../lib/config.js'
import { resolveSoulPath } from '../lib/soul.js'

const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const profileDir = process.env.DSH_PROFILE_DIR ?? join(dshHome, 'profiles', process.env.DSH_PROFILE ?? 'desktop')
const patchPath = join(profileDir, 'cordis.patch.yml')

/**
 * 从 profile patch 里取出 fairy-soul 那一行的配置。
 *
 * 极小子集解析：定位 `- id: fairy-soul`，向后扫到下一个顶层 `- id:` 为止，收集
 * `key: value` 与嵌套一层的 `key:` + 缩进 `value`。足够读出本插件的标量配置。
 *
 * @param text - patch 文件内容。
 * @returns 配置对象；没有该行时返回 undefined。
 */
function fairyConfigFromPatch(text) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => /^\s*-\s*id:\s*fairy-soul\s*$/.test(line))
  if (start === -1) return undefined
  const config = {}
  let readingConfig = false
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^\s*-\s*id:/.test(line)) break
    if (/^\s*config:\s*$/.test(line)) {
      readingConfig = true
      continue
    }
    if (!readingConfig) continue
    const match = /^\s{4,}([A-Za-z][\w]*):\s*(.*?)\s*$/.exec(line)
    if (match === null) continue
    const [, key, raw] = match
    if (raw === '' || raw.startsWith('#')) continue
    let value = raw
    if (/^(true|false)$/.test(value)) value = value === 'true'
    else if (/^-?\d+(\.\d+)?$/.test(value)) value = Number(value)
    else value = value.replace(/^['"]|['"]$/g, '')
    config[key] = value
  }
  return config
}

console.log('\n端到端渲染 — dsh-fairy-soul\n')

if (!existsSync(patchPath)) {
  console.log(`找不到 ${patchPath}，改用默认配置渲染。\n`)
}

const rawConfig = existsSync(patchPath) ? fairyConfigFromPatch(readFileSync(patchPath, 'utf8')) : undefined
const settings = normalizeConfig(rawConfig)

console.log(`配置来源   : ${rawConfig === undefined ? '默认值（patch 里没有 fairy-soul 行）' : patchPath}`)
console.log(`原始配置   : ${JSON.stringify(rawConfig ?? {})}`)
console.log(`归一化配置 : enabled=${settings.enabled} language=${settings.language} order=${settings.order} annotateContinuity=${settings.annotateContinuity}`)

const usingPackaged = settings.soulPath.length === 0
const effectiveSoul = usingPackaged ? PACKAGED_SOUL_PATH : resolveSoulPath(settings.soulPath)

console.log(`人格来源   : ${usingPackaged ? `随包发布（soulPath 留空）` : `外部路径（soulPath 已设置）`}`)
console.log(`soulPath   : ${settings.soulPath === '' ? "(空串)" : settings.soulPath}`)
console.log(`实际文件   : ${effectiveSoul}`)
console.log(`文件存在   : ${existsSync(effectiveSoul)}`)

// 用真实配置跑真实的 apply()。
const registered = []
const ctx = {
  logger: () => ({ info: () => {}, warn: (...args) => console.log('  [warn]', ...args) }),
  effect: (factory) => factory(),
  systemPrompt: {
    section: (section) => {
      registered.push(section)
      return () => {}
    },
    getSectionOrder: () => 0,
  },
}
apply(ctx, rawConfig)

if (registered.length === 0) {
  console.log('\n未注册任何段落（enabled=false）。系统提示词保持原样。\n')
  process.exit(0)
}

const section = registered[0]
const text = section.text({})

console.log('\n── 段落注册 ──')
console.log(`  名字     : ${section.name}`)
console.log(`  排序     : ${section.order}`)
console.log(`  插值     : ${section.interpolate === false ? '关闭' : '开启'}`)
console.log(`  注入字节 : ${Buffer.byteLength(text, 'utf8')}`)
console.log(`  注入行数 : ${text.split('\n').length}`)

console.log('\n── 实际注入内容 ──')
console.log(text.split('\n').map((line) => `  │ ${line}`).join('\n'))

console.log('\n── 关键点自检 ──')
const checks = [
  ['划界声明在最前', text.startsWith('以下是一份长期人格设定')],
  ['声明先于灵魂正文', text.indexOf('优先级高于本段') < text.indexOf('SOUL.md')],
  ['声明运行基底优先', text.includes('优先级高于本段')],
  ['frontmatter 已剥离', !/title:|read_when:/.test(text)],
  ['含 Fairy 身份基底', /Fairy/.test(text)],
  ['含称"主人"设定', /主人/.test(text)],
  ['Continuity 已标注', /长期协作约定/.test(text)],
  ['不含 {{ }} 未解析变量', !/\{\{/.test(text)],
]
for (const [label, ok] of checks) console.log(`  ${ok ? '✔' : '✖'} ${label}`)
console.log()
