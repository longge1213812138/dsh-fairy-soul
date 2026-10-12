/**
 * 安装检查：从 profile 的视角验证本插件是否可被正确解析与装载。
 *
 * 单元测试验证代码行为，`harness.mjs` 验证段落契约，本脚本验证**装配**：
 * 从 profile 的 baseUrl 出发能否解析到本包、清单字段是否齐全、以及默认灵魂文件
 * 是否真的可用。它回答的是"重启之后它会不会生效"。
 *
 * 运行：node verify/install-check.mjs
 *
 * @module dsh-fairy-soul/verify/install-check
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_CONFIG } from '../lib/config.js'
import { resolveSoulPath } from '../lib/soul.js'

const PACKAGE_NAME = 'dsh-fairy-soul'
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const results = []

function check(label, fn) {
  try {
    const detail = fn()
    results.push(`  ✔ ${label}${detail === undefined ? '' : `\n      ${detail}`}`)
  } catch (error) {
    results.push(`  ✖ ${label}\n      ${error.message}`)
    process.exitCode = 1
  }
}

console.log('\n安装检查 — dsh-fairy-soul\n')

// ── 包自身清单 ──────────────────────────────────────────────────────────
console.log('包清单')
const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))

check('package.json 声明了 dsh.bundle.patch', () => {
  const patch = pkg.dsh?.bundle?.patch
  if (patch !== './cordis.patch.yml') throw new Error(`期望 './cordis.patch.yml'，实际 ${JSON.stringify(patch)}`)
  return patch
})
check('bundle patch 文件存在', () => {
  const path = join(PACKAGE_ROOT, pkg.dsh.bundle.patch)
  if (!existsSync(path)) throw new Error(`找不到 ${path}`)
  return path
})
check('exports "." 指向可加载的入口', () => {
  const entry = pkg.exports?.['.']
  const resolved = typeof entry === 'string' ? entry : entry?.default
  if (typeof resolved !== 'string') throw new Error('exports["."] 不是字符串')
  if (!existsSync(join(PACKAGE_ROOT, resolved))) throw new Error(`入口不存在：${resolved}`)
  return resolved
})
check('包内兜底灵魂文件存在且非空', () => {
  const path = join(PACKAGE_ROOT, 'soul.default.md')
  const size = readFileSync(path, 'utf8').trim().length
  if (size === 0) throw new Error('soul.default.md 为空')
  return `${size} 字符`
})

// ── patch 文件内容 ──────────────────────────────────────────────────────
console.log('\npatch 层')
check('patch 文件里有 fairy-soul 的 insert 行', () => {
  const text = readFileSync(join(PACKAGE_ROOT, 'cordis.patch.yml'), 'utf8')
  for (const needle of ['- insert:', 'id: fairy-soul', `name: '${PACKAGE_NAME}'`]) {
    if (!text.includes(needle)) throw new Error(`缺少 ${needle}`)
  }
  return 'insert + id + name 齐全'
})

// ── 从 profile 视角解析 ─────────────────────────────────────────────────
console.log('\nprofile 装配')
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const profileDir = process.env.DSH_PROFILE_DIR ?? join(dshHome, 'profiles', process.env.DSH_PROFILE ?? 'desktop')
const profileManifest = join(profileDir, 'package.json')

if (!existsSync(profileManifest)) {
  results.push(`  ⚠ 找不到 profile 清单 ${profileManifest}；跳过装配检查`)
} else {
  const profile = JSON.parse(readFileSync(profileManifest, 'utf8'))
  const require = createRequire(profileManifest)

  check('profile 的 dependencies 里有本插件', () => {
    const spec = profile.dependencies?.[PACKAGE_NAME]
    if (spec === undefined) throw new Error(`${PACKAGE_NAME} 不在 dependencies 中`)
    return spec
  })
  check('profile 的 dsh.profile.bundles 里有本插件', () => {
    const bundles = profile.dsh?.profile?.bundles ?? []
    if (!bundles.includes(PACKAGE_NAME)) throw new Error(`${PACKAGE_NAME} 不在 bundles 中`)
    return `位于第 ${bundles.indexOf(PACKAGE_NAME) + 1} / ${bundles.length} 位`
  })
  check('能从 profile 解析到本包的 package.json', () => {
    return require.resolve(`${PACKAGE_NAME}/package.json`)
  })
  check('解析到的包就是当前开发目录', () => {
    const resolved = dirname(require.resolve(`${PACKAGE_NAME}/package.json`))
    const same = resolved.toLowerCase() === PACKAGE_ROOT.toLowerCase()
    if (!same) throw new Error(`profile 指向 ${resolved}，当前目录是 ${PACKAGE_ROOT}（link 可能指错了）`)
    return resolved
  })
  check('插件的 patch 层会被 profile 应用（cordis.yml 已生成或待重启生效）', () => {
    const composed = join(profileDir, 'cordis.yml')
    if (!existsSync(composed)) return 'cordis.yml 尚未生成'
    const text = readFileSync(composed, 'utf8')
    return text.includes(PACKAGE_NAME)
      ? '组合结果里已包含本插件'
      : '组合结果里还没有本插件 —— 需要重启 DSH（bundle 列表在进程启动时确定）'
  })
}

// ── 部署配置（读 profile patch 里的真实 soulPath） ──────────────────────
console.log('\n部署配置')

/**
 * 从 profile 的 patch 层里取出 `- id: fairy-soul` 那一行的 `soulPath`。
 *
 * 只做本检查需要的极小子集解析：定位 id 行，向后扫到下一个顶层 `- id:` 行为止，
 * 在其中找 `soulPath:`。够用且不引入 YAML 依赖。
 *
 * @param text - patch 文件内容。
 * @returns soulPath 字面量；未配置时 undefined。
 */
function soulPathFromPatch(text) {
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => /^\s*-\s*id:\s*fairy-soul\s*$/.test(line))
  if (start === -1) return undefined
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*-\s*id:/.test(lines[index])) break
    const match = /^\s*soulPath:\s*(.+?)\s*$/.exec(lines[index])
    if (match !== null) return match[1].replace(/^['"]|['"]$/g, '')
  }
  return undefined
}

const patchPath = join(profileDir, 'cordis.patch.yml')
let configuredSoul

if (!existsSync(patchPath)) {
  results.push(`  ⚠ 找不到 ${patchPath}；跳过部署配置检查`)
} else {
  const patchText = readFileSync(patchPath, 'utf8')
  configuredSoul = soulPathFromPatch(patchText)

  check('profile patch 里有 fairy-soul 配置行', () => {
    if (!patchText.includes('id: fairy-soul')) throw new Error('patch 层里没有 fairy-soul 行')
    if (!patchText.includes(PACKAGE_NAME)) throw new Error(`patch 层里没有 ${PACKAGE_NAME}`)
    return '已声明'
  })
  check('配置行显式给出 soulPath', () => {
    if (configuredSoul === undefined) throw new Error('配置行里没有 soulPath 字段')
    return configuredSoul
  })
}

// ── 灵魂文件 ────────────────────────────────────────────────────────────
console.log('\n灵魂文件')
const rawConfigured = configuredSoul ?? DEFAULT_CONFIG.soulPath
const effectiveSoul = resolveSoulPath(rawConfigured, process.env, homedir())

check(`配置的 soulPath 可解析（${rawConfigured}）`, () => {
  if (typeof effectiveSoul !== 'string') throw new Error('无法解析为绝对路径')
  return effectiveSoul
})
check('该路径下的灵魂文件存在', () => {
  if (!existsSync(effectiveSoul)) {
    throw new Error(`找不到 ${effectiveSoul} —— 实际会回落到包内 soul.default.md，改动不会热重载`)
  }
  const text = readFileSync(effectiveSoul, 'utf8')
  return `${text.length} 字节，${text.split('\n').length} 行`
})
check('灵魂文件内容确实是 Fairy 设定', () => {
  const text = readFileSync(effectiveSoul, 'utf8')
  for (const needle of ['Fairy', '主人']) {
    if (!text.includes(needle)) throw new Error(`缺少关键内容：${needle}`)
  }
  return '含身份基底与称呼设定'
})
check('灵魂文件不含会干扰注入的字面 {{ }}', () => {
  const text = readFileSync(effectiveSoul, 'utf8')
  if (/\{\{|\}\}/.test(text)) {
    return '⚠ 含 {{ }}，但段落已设 interpolate:false，不受影响'
  }
  return '无'
})

console.log(`\n${results.join('\n')}\n`)
console.log(process.exitCode === 1 ? '结果：有失败项\n' : '结果：全部通过\n')
