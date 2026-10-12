/**
 * 装配级验证：在一个最小假宿主上跑真实的 `apply()`，证明插件遵守 DSH 的段落契约。
 *
 * 单元测试验证的是各个函数；这里验证的是**接线**：段落名、排序值、返回值形状、
 * `interpolate` 标志，以及"读不到文件时退化成空段落而不是抛错"这条容错承诺。
 *
 * 内置段落的排序常量取自 DSH 的 `dsh-system-prompt`（SECTION_ORDERS）。若 DSH 升级后
 * 这些值变了，本脚本会失败——那正是它存在的意义。
 *
 * 运行：node verify/harness.mjs
 *
 * @module dsh-fairy-soul/verify/harness
 */

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { PACKAGED_SOUL_PATH, apply, inject, name, SECTION_NAME } from '../index.js'

/** DSH `dsh-system-prompt` 的 SECTION_ORDERS 全表（用于校验我们的排序位置）。 */
const SECTION_ORDERS = {
  HARNESS_IDENTITY: -1000,
  DEPLOYMENT_PERSONA_PREFIX: 0,
  PLAN_POLICY: 500,
  TEAM_POLICY: 600,
  PTC_ONLY: 800,
  FILE_REFERENCE: 900,
  TOOL_BASH: 1000,
  TOOL_PWSH: 1010,
  TOOL_READ: 1100,
  TOOL_WRITE: 1200,
  TOOL_EDIT: 1300,
  TOOL_GLOB: 1400,
  TOOL_GREP: 1500,
  TOOL_JOBS: 1600,
  TOOL_PTY: 1700,
  TOOL_WEB_SEARCH: 2000,
  TOOL_WEB_FETCH: 2100,
  TOOL_LSP: 2200,
  TOOL_SESSION_QUERY: 2300,
  TOOL_GOAL: 2400,
  TOOL_WORKFLOW: 2600,
  TOOL_RALPH: 2700,
  TOOL_SUBAGENT: 2800,
  TOOL_REPORT: 2900,
  TOOL_COMPUTER_USE: 3000,
  MCP_SERVERS: 3100,
  TOOLS_SDK: 5000,
  DELIVERABLE_FILE_REFERENCES: 9000,
  STRUCTURED_OUTPUT: 9900,
  HARNESS_SOURCE: 10000,
  WEB_SURFACE: 10100,
  DEPLOYMENT_PERSONA_SUFFIX: 10200,
}

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const created = []
const results = []

function check(label, fn) {
  try {
    fn()
    results.push(`  ✔ ${label}`)
  } catch (error) {
    results.push(`  ✖ ${label}\n      ${error.message}`)
    process.exitCode = 1
  }
}

/** 造一个最小假宿主：只实现插件真正会用到的那几个成员。 */
function fakeHost() {
  const registered = []
  const logs = []
  const disposers = []
  const ctx = {
    logger: () => ({
      info: (...args) => logs.push(['info', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
    }),
    effect: (factory, label) => {
      const disposer = factory()
      disposers.push({ label, disposer })
      return disposer
    },
    systemPrompt: {
      section: (section) => {
        registered.push(section)
        return () => {}
      },
      getSectionOrder: (key) => SECTION_ORDERS[key],
    },
  }
  return { ctx, registered, logs, disposers }
}

function tempSoul(content) {
  const dir = mkdtempSync(join(tmpdir(), 'fairy-verify-'))
  created.push(dir)
  const path = join(dir, 'SOUL.md')
  writeFileSync(path, content, 'utf8')
  return path
}

const SOUL = '---\ntitle: t\nread_when: x\n---\n\n# Who You Are\n\n*You are Fairy.*\n\n## Voice\n\n- 自称 Fairy\n\n## Continuity\n\nEach session, you wake up fresh.\n'

console.log('\n装配级验证 — dsh-fairy-soul\n')

// ── 契约面 ──────────────────────────────────────────────────────────────
console.log('契约面')
check('导出 Cordis 插件所需的 name / inject / apply', () => {
  assert.equal(typeof name, 'string')
  assert.deepEqual(inject, ['systemPrompt'])
  assert.equal(typeof apply, 'function')
})
check('段落名落在 fairy 命名空间且不占用 Harness 预留槽位', () => {
  assert.match(SECTION_NAME, /^fairy:/)
  assert.notEqual(SECTION_NAME, 'deployment:persona-prefix')
  assert.notEqual(SECTION_NAME, 'deployment:persona-suffix')
})

// ── 注册行为 ────────────────────────────────────────────────────────────
console.log('\n注册行为')
{
  const soulPath = tempSoul(SOUL)
  const host = fakeHost()
  apply(host.ctx, { soulPath, language: 'zh' })
  const section = host.registered[0]

  check('恰好注册一个段落', () => {
    assert.equal(host.registered.length, 1)
  })
  check('段落用 effect 注册，可被 Cordis 回收', () => {
    assert.equal(host.disposers.length, 1)
    assert.equal(typeof host.disposers[0].disposer, 'function')
  })
  check('text 是函数（每次组装求值，支持热重载）', () => {
    assert.equal(typeof section.text, 'function')
  })
  check('关闭插值，避免字面 {{ 让整次组装抛错', () => {
    assert.equal(section.interpolate, false)
  })
  check('order 排在全部内置段落之后（力度最强位置）', () => {
    const last = Math.max(...Object.values(SECTION_ORDERS))
    assert.equal(last, SECTION_ORDERS.DEPLOYMENT_PERSONA_SUFFIX)
    assert.ok(section.order > last, `order=${section.order} 应大于 ${last}`)
  })
  check('渲染结果含划界声明、灵魂正文与 Continuity 标注', () => {
    const text = section.text({})
    assert.match(text, /只\*\*定义你如何表达/, '应有划界声明')
    assert.match(text, /You are Fairy/, '应含灵魂正文')
    assert.ok(!text.includes('title: t'), 'frontmatter 应被剥掉')
    assert.match(text, /长期协作约定/, 'Continuity 应被标注')
  })
  check('划界声明出现在灵魂正文之前', () => {
    const text = section.text({})
    assert.ok(text.indexOf('只**定义你如何表达') < text.indexOf('You are Fairy'))
  })
  check('激活时打印 armed 日志', () => {
    assert.ok(host.logs.some(([level, msg]) => level === 'info' && String(msg).startsWith('armed')))
  })
}

// ── 热重载 ──────────────────────────────────────────────────────────────
console.log('\n热重载')
{
  const soulPath = tempSoul('FIRST VERSION\n')
  const host = fakeHost()
  apply(host.ctx, { soulPath, annotateContinuity: false })
  const section = host.registered[0]
  const before = section.text({})
  writeFileSync(soulPath, 'SECOND VERSION\n', 'utf8')
  // 显式推进 mtime，绕开文件系统时间戳精度问题。
  const future = Date.now() / 1000 + 10
  const { utimesSync } = await import('node:fs')
  utimesSync(soulPath, future, future)
  check('灵魂文件改动后，下一次组装读到新内容', () => {
    const after = section.text({})
    assert.match(before, /FIRST VERSION/)
    assert.match(after, /SECOND VERSION/)
  })
}

// ── 随包灵魂文件：默认人格来源 ──────────────────────────────────────────
console.log('\n随包灵魂文件（默认人格来源）')
{
  const host = fakeHost()
  apply(host.ctx, {})
  const section = host.registered[0]
  check('默认配置（soulPath 留空）也能注入人格', () => {
    const text = section.text({})
    assert.match(text, /Fairy/, '应注入随包 FairySOUL.md 的内容')
    assert.match(text, /主人/, '应含称呼设定')
  })
  check('默认来源是包内的 FairySOUL.md，而非某个外部绝对路径', () => {
    const armed = host.logs.find(([level, msg]) => level === 'info' && String(msg).startsWith('armed'))
    assert.ok(armed !== undefined, '应打印 armed 日志')
    const message = String(armed[1])
    assert.match(message, /soul=packaged:/, '应标注为随包来源')
    assert.ok(message.includes(PACKAGED_SOUL_PATH), `日志里应出现 ${PACKAGED_SOUL_PATH}`)
  })
}
check('随包 FairySOUL.md 确实存在且含 Fairy 设定', async () => {
  const { readFileSync } = await import('node:fs')
  const soul = readFileSync(PACKAGED_SOUL_PATH, 'utf8')
  assert.match(soul, /Fairy/)
  assert.match(soul, /称用户为"主人"/)
})
check('随包 FairySOUL.md 路径落在包根之内（可发布、可移植）', () => {
  assert.ok(
    PACKAGED_SOUL_PATH.startsWith(PACKAGE_ROOT),
    `${PACKAGED_SOUL_PATH} 应在 ${PACKAGE_ROOT} 之内`,
  )
  assert.equal(PACKAGED_SOUL_PATH, join(PACKAGE_ROOT, 'FairySOUL.md'))
})

// ── 脱离工作区工作（发布/搬迁后的核心保证） ─────────────────────────────
console.log('\n脱离开发工作区（复制到别处后必须照常工作）')
{
  // 把包完整复制到一个临时目录，模拟"用户从 GitHub 装下来、原工作区已删除"。
  const { cpSync, readFileSync, rmSync: rm } = await import('node:fs')
  const staging = mkdtempSync(join(tmpdir(), 'fairy-detached-'))
  created.push(staging)
  cpSync(PACKAGE_ROOT, join(staging, 'dsh-fairy-soul'), {
    recursive: true,
    filter: (src) => !src.includes(`${sep}.git${sep}`) && !src.includes(`${sep}node_modules${sep}`),
  })
  const detachedRoot = join(staging, 'dsh-fairy-soul')

  check('复制出来的是完整可运行包（含 FairySOUL.md 与 patch）', () => {
    for (const file of ['package.json', 'index.js', 'cordis.patch.yml', 'FairySOUL.md']) {
      const path = join(detachedRoot, file)
      if (!existsSync(path)) throw new Error(`缺少 ${file}`)
    }
    return `${detachedRoot}`
  })

  // 从副本目录导入并运行——证明模块不依赖原工作区。
  const detached = await import(pathToFileURL(join(detachedRoot, 'index.js')).href)
  const host = fakeHost()
  detached.apply(host.ctx, {})
  check('从副本运行时，人格来源指向副本自己（而非原工作区）', () => {
    const text = host.registered[0].text({})
    assert.match(text, /Fairy/)
    const armed = host.logs.find(([level, msg]) => level === 'info' && String(msg).startsWith('armed'))
    const message = String(armed[1])
    assert.ok(message.includes(detachedRoot), '日志里应出现副本路径')
    assert.ok(!message.includes(PACKAGE_ROOT), '不应再引用原工作区路径')
  })

  check('副本不引用任何硬编码的开发者绝对路径', () => {
    for (const file of ['index.js', 'lib/config.js', 'lib/soul.js']) {
      const text = readFileSync(join(detachedRoot, file), 'utf8')
      if (/91533|Desktop[\\/]Fairy/i.test(text)) {
        throw new Error(`${file} 里残留硬编码的开发者路径`)
      }
    }
  })

  // 删掉副本里的 FairySOUL.md 也不应崩：段落退化成空串。
  rm(join(detachedRoot, 'FairySOUL.md'), { force: true })
  const host2 = fakeHost()
  detached.apply(host2.ctx, {})
  check('副本缺少 FairySOUL.md 时退化为空段落，而不是抛错', () => {
    assert.equal(host2.registered[0].text({}), '')
  })
}

// ── 容错 ────────────────────────────────────────────────────────────────
console.log('\n容错（人格读取失败不得让请求失败）')
{
  const host = fakeHost()
  apply(host.ctx, { soulPath: join(PACKAGE_ROOT, 'no', 'such', 'file.md'), language: 'zh' })
  const section = host.registered[0]
  check('外部路径缺失时回落到随包 FairySOUL.md', () => {
    assert.match(section.text({}), /Fairy/)
  })
  check('回落时留下一条 warn 日志', () => {
    assert.ok(host.logs.some(([level, msg]) => level === 'warn' && /cannot read/.test(String(msg))))
  })
}
{
  // 直接对读取器验证"无任何可读路径"这一格，不经过 apply()。
  const { createSoulSource } = await import('../lib/soul.js')
  const silent = { warn: () => {} }
  check('无任何可读路径时返回空串且不抛错（空段落会被组装丢弃）', () => {
    assert.equal(createSoulSource({ soulPath: undefined, fallbackPath: undefined }, silent)(), '')
    assert.equal(
      createSoulSource({ soulPath: join(PACKAGE_ROOT, 'no.md'), fallbackPath: join(PACKAGE_ROOT, 'no2.md') }, silent)(),
      '',
    )
  })
}
{
  const host = fakeHost()
  apply(host.ctx, { enabled: false })
  check('enabled: false 时不注册任何段落', () => {
    assert.equal(host.registered.length, 0)
    assert.ok(host.logs.some(([, msg]) => /disabled/.test(String(msg))))
  })
}

console.log(`\n${results.join('\n')}\n`)
for (const dir of created) rmSync(dir, { recursive: true, force: true })
console.log(process.exitCode === 1 ? '结果：有失败项\n' : '结果：全部通过\n')
