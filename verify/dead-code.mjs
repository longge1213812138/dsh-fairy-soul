/**
 * 死代码审计：找出运行时代码里未被使用的导出与私有符号。
 *
 * 只扫**会被发布**的文件（`index.js`、`lib/*.js`），并按"是否被运行时代码或测试引用"
 * 判定。测试与验证脚本引用的导出算**被使用**——它们是契约的一部分。
 *
 * 运行：node verify/dead-code.mjs
 *
 * @module dsh-fairy-soul/verify/dead-code
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** 会随包发布的运行时代码。 */
const RUNTIME_FILES = ['index.js', 'lib/config.js', 'lib/soul.js']

/** 只用于本地校验、不发布的文件（它们引用导出即视为"被使用"）。 */
const CONSUMER_GLOBS = ['test/config.test.js', 'test/soul.test.js', 'verify/harness.mjs', 'verify/install-check.mjs', 'verify/render.mjs']

const sources = new Map()
for (const file of [...RUNTIME_FILES, ...CONSUMER_GLOBS]) {
  try {
    sources.set(file, readFileSync(join(PACKAGE_ROOT, file), 'utf8'))
  } catch {
    /* 可选文件缺失时跳过 */
  }
}

/**
 * 统计某个标识符在所有文件里出现的次数。
 * @param name - 标识符名。
 * @returns 出现次数（含定义处）。
 */
function countOccurrences(name) {
  const pattern = new RegExp(`\\b${name}\\b`, 'g')
  let total = 0
  for (const text of sources.values()) total += (text.match(pattern) ?? []).length
  return total
}

const problems = []
const notes = []

console.log('\n死代码审计 — dsh-fairy-soul\n')

// ── 导出的运行时符号是否真的被用到 ──────────────────────────────────────
for (const file of RUNTIME_FILES) {
  const text = sources.get(file)
  const exportPattern = /^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z_$][\w$]*)/gm
  const names = [...text.matchAll(exportPattern)].map((match) => match[1])
  for (const name of names) {
    const uses = countOccurrences(name)
    // 定义处 + 至少一处使用 = 2。仅 1 表示除定义外无人引用。
    if (uses <= 1) problems.push(`${file}: 导出 \`${name}\` 未被任何文件引用`)
    else notes.push(`  ✔ ${file} 的 \`${name}\` 被引用 ${uses - 1} 处`)
  }
}

// ── 运行时代码里不该出现的东西 ──────────────────────────────────────────
console.log('运行时代码卫生')
const forbidden = [
  [/91533/, '开发者用户名'],
  [/\bDesktop\b/, '开发机桌面路径'],
  [/AppData/, '临时/用户数据目录'],
  [/\bDocuments\b/, '开发机文档路径'],
  [/[A-Za-z]:[\\/]Users[\\/]/, '硬编码的用户目录绝对路径'],
]
for (const file of RUNTIME_FILES) {
  const text = sources.get(file)
  // 注释行允许出现示例路径；只看会被执行的代码。
  const code = text
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')
  for (const [pattern, label] of forbidden) {
    if (pattern.test(code)) problems.push(`${file}: 代码里含${label}`)
  }
}
if (!problems.some((message) => RUNTIME_FILES.some((file) => message.startsWith(file)))) {
  console.log('  ✔ 无硬编码路径、无开发者机器引用')
}

// ── 旧设计的残留标识 ────────────────────────────────────────────────────
console.log('\n旧设计残留')
const staleMarkers = ['soul.default', 'LEGACY_', 'stringOr', 'fallbackPath: undefined']
let staleFound = false
for (const file of RUNTIME_FILES) {
  const text = sources.get(file)
  for (const marker of staleMarkers) {
    if (text.includes(marker)) {
      problems.push(`${file}: 残留旧设计标识 \`${marker}\``)
      staleFound = true
    }
  }
}
if (!staleFound) console.log('  ✔ 无 soul.default / LEGACY / 其它旧设计残留')

console.log(`\n${notes.join('\n')}\n`)
if (problems.length > 0) {
  console.log('发现问题：')
  for (const problem of problems) console.log(`  ✖ ${problem}`)
  console.log()
  process.exitCode = 1
} else {
  console.log('结果：无死代码\n')
}
