/**
 * 安装与发布检查：从 profile 与 npm 打包两个视角验证本插件可被正确装载与分发。
 *
 * 单元测试验证代码行为，`harness.mjs` 验证段落契约，本脚本验证**装配与发布**：
 *   - 包清单字段是否足以让 DSH 装载、让 npm 发布；
 *   - `FairySOUL.md` 是否真的会被打进发布产物（`files` 白名单）；
 *   - profile 里能否解析到本包、bundles 是否已登记；
 *   - 灵魂文件是否可用，以及它是否**不依赖**开发工作区。
 *
 * 运行：node verify/install-check.mjs
 *
 * @module dsh-fairy-soul/verify/install-check
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_CONFIG, PACKAGED_SOUL_FILENAME } from '../lib/config.js'
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

const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))

console.log('\n安装与发布检查 — dsh-fairy-soul\n')

// ── 包清单：DSH 装载契约 ────────────────────────────────────────────────
console.log('包清单（DSH 装载）')
check('声明了 dsh.bundle.patch', () => {
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
check('patch 文件里有 fairy-soul 的 insert 行', () => {
  const text = readFileSync(join(PACKAGE_ROOT, 'cordis.patch.yml'), 'utf8')
  for (const needle of ['- insert:', 'id: fairy-soul', `name: '${PACKAGE_NAME}'`]) {
    if (!text.includes(needle)) throw new Error(`缺少 ${needle}`)
  }
  return 'insert + id + name 齐全'
})

// ── 包清单：npm 发布契约 ────────────────────────────────────────────────
console.log('\n包清单（npm 发布）')
check('未设置 private: true（否则 npm publish 会被拒绝）', () => {
  if (pkg.private === true) throw new Error('private: true 会阻止发布')
  return '可发布'
})
check(`files 白名单包含随包灵魂文件 ${PACKAGED_SOUL_FILENAME}`, () => {
  const files = pkg.files ?? []
  if (!files.includes(PACKAGED_SOUL_FILENAME)) {
    throw new Error(`${PACKAGED_SOUL_FILENAME} 不在 files 里 —— 发布产物将缺失人格文件，别人装到的是空人格`)
  }
  return PACKAGED_SOUL_FILENAME
})
check('files 白名单包含全部运行时必需项', () => {
  const files = pkg.files ?? []
  for (const required of ['index.js', 'lib', 'cordis.patch.yml']) {
    if (!files.includes(required)) throw new Error(`缺少 ${required}`)
  }
  return files.join(', ')
})
check('files 里的每一项都真实存在', () => {
  for (const entry of pkg.files ?? []) {
    if (!existsSync(join(PACKAGE_ROOT, entry))) throw new Error(`files 里有不存在的项：${entry}`)
  }
  return '全部存在'
})
check('随包灵魂文件存在且非空', () => {
  const path = join(PACKAGE_ROOT, PACKAGED_SOUL_FILENAME)
  const size = readFileSync(path, 'utf8').trim().length
  if (size === 0) throw new Error(`${PACKAGED_SOUL_FILENAME} 为空`)
  return `${size} 字符`
})
check('repository 字段已填真实地址（非占位符）', () => {
  const url = pkg.repository?.url ?? ''
  if (url.trim().length === 0) throw new Error('repository 为空 —— 别人无法从 GitHub 安装')
  if (/USERNAME|YOURNAME|example\.com/i.test(url)) throw new Error(`仍是占位符：${url}`)
  if (!/^git\+https:\/\/github\.com\/[^/]+\/[^/]+\.git$/.test(url)) {
    return `⚠ 地址格式非预期的 GitHub 形式：${url}`
  }
  return url
})

// ── 可移植性：不依赖开发工作区 ──────────────────────────────────────────
console.log('\n可移植性（发布/搬迁后必须照常工作）')
check('随包灵魂文件路径落在包根之内', () => {
  const path = join(PACKAGE_ROOT, PACKAGED_SOUL_FILENAME)
  if (!path.startsWith(PACKAGE_ROOT)) throw new Error('随包灵魂文件不在包内')
  return PACKAGED_SOUL_FILENAME
})
check('默认配置不引用任何绝对路径（否则别人装了会指向不存在的文件）', () => {
  if (isAbsolute(DEFAULT_CONFIG.soulPath)) {
    throw new Error(`默认 soulPath 是绝对路径：${DEFAULT_CONFIG.soulPath}`)
  }
  if (DEFAULT_CONFIG.soulPath !== '') {
    return `⚠ 默认 soulPath 非空但非绝对：${DEFAULT_CONFIG.soulPath}`
  }
  return '空串 = 使用随包 FairySOUL.md'
})
check('运行时源码不含硬编码的开发者路径', () => {
  const offenders = []
  // 匹配"任何机器上的绝对路径字面量"，因此不依赖开发者的用户名。
  const absolute = /[A-Za-z]:[\\/]{1,2}[^\\/\s'"]+[\\/]{1,2}[^\\/\s'"]+/
  for (const file of ['index.js', 'lib/config.js', 'lib/soul.js', 'cordis.patch.yml']) {
    const text = readFileSync(join(PACKAGE_ROOT, file), 'utf8')
    // 只检查会被执行的代码与生效的配置；注释里的示例路径不去管。
    const code = text
      .split(/\r?\n/)
      .filter((line) => !/^\s*(#|\/\/|\*|\/\*)/.test(line))
      .join('\n')
    if (absolute.test(code)) offenders.push(file)
  }
  if (offenders.length > 0) throw new Error(`残留硬编码绝对路径：${offenders.join(', ')}`)
  return 'index.js / lib/*.js / cordis.patch.yml 均干净'
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
  check('插件的 patch 层是否已被 profile 应用', () => {
    const composed = join(profileDir, 'cordis.yml')
    if (!existsSync(composed)) return 'cordis.yml 尚未生成'
    const text = readFileSync(composed, 'utf8')
    return text.includes(PACKAGE_NAME)
      ? '组合结果里已包含本插件'
      : '组合结果里还没有本插件 —— 需要重启 DSH（bundle 列表在进程启动时确定）'
  })
}

// ── 部署配置与实际生效的人格来源 ────────────────────────────────────────
console.log('\n部署配置与人格来源')

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
    const match = /^\s*soulPath:\s*(.*?)\s*$/.exec(lines[index])
    if (match !== null) return match[1].replace(/^['"]|['"]$/g, '')
  }
  return undefined
}

const patchPath = join(profileDir, 'cordis.patch.yml')
const patchText = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : undefined
const configuredSoul = patchText === undefined ? undefined : soulPathFromPatch(patchText)

if (patchText === undefined) {
  results.push(`  ⚠ 找不到 ${patchPath}；跳过部署配置检查`)
} else {
  check('profile patch 里有 fairy-soul 配置行', () => {
    if (!patchText.includes('id: fairy-soul')) throw new Error('patch 层里没有 fairy-soul 行')
    if (!patchText.includes(PACKAGE_NAME)) throw new Error(`patch 层里没有 ${PACKAGE_NAME}`)
    return '已声明'
  })
  check('profile 的 soulPath 未写死某台机器的绝对路径', () => {
    if (configuredSoul !== undefined && isAbsolute(configuredSoul)) {
      throw new Error(`soulPath 写死了绝对路径：${configuredSoul} —— 换机/删工作区后会失效`)
    }
    return configuredSoul === '' || configuredSoul === undefined
      ? '留空 = 使用随包 FairySOUL.md（推荐）'
      : configuredSoul
  })
}

// 实际生效的人格文件：配置为空时就是随包那份。
const rawConfigured = configuredSoul ?? DEFAULT_CONFIG.soulPath
const usingPackaged = rawConfigured.trim().length === 0
const effectiveSoul = usingPackaged
  ? join(PACKAGE_ROOT, PACKAGED_SOUL_FILENAME)
  : resolveSoulPath(rawConfigured, process.env, homedir())

check('实际生效的灵魂文件存在', () => {
  if (!existsSync(effectiveSoul)) throw new Error(`找不到 ${effectiveSoul}`)
  const text = readFileSync(effectiveSoul, 'utf8')
  return `${usingPackaged ? '[随包] ' : '[外部] '}${effectiveSoul}（${text.length} 字节）`
})
check('该文件内容确实是 Fairy 设定', () => {
  const text = readFileSync(effectiveSoul, 'utf8')
  for (const needle of ['Fairy', '主人']) {
    if (!text.includes(needle)) throw new Error(`缺少关键内容：${needle}`)
  }
  return '含身份基底与称呼设定'
})
check('该文件不含会干扰注入的字面 {{ }}', () => {
  if (/\{\{|\}\}/.test(readFileSync(effectiveSoul, 'utf8'))) {
    return '⚠ 含 {{ }}，但段落已设 interpolate:false，不受影响'
  }
  return '无'
})

console.log(`\n${results.join('\n')}\n`)
console.log(process.exitCode === 1 ? '结果：有失败项\n' : '结果：全部通过\n')
