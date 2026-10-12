/**
 * 灵魂文件读取、清洗与热重载的单元测试。
 *
 * @module dsh-fairy-soul/test/soul.test
 */

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import {
  annotateContinuitySection,
  createSoulSource,
  prepareSoul,
  resolveSoulPath,
  stripFrontmatter,
} from '../lib/soul.js'

const HOME = join(tmpdir(), 'fairy-soul-home')
const created = []

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'fairy-soul-'))
  created.push(dir)
  return dir
}

function tempFile(name, content) {
  const path = join(tempDir(), name)
  writeFileSync(path, content, 'utf8')
  return path
}

/** 记录 warn 调用的假日志器。 */
function fakeLogger() {
  const warnings = []
  return { warnings, warn: (...args) => warnings.push(args) }
}

after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

describe('resolveSoulPath', () => {
  it('展开 ~ 与 ~/ 前缀', () => {
    assert.equal(resolveSoulPath('~', {}, HOME), HOME)
    assert.equal(resolveSoulPath('~/a/b.md', {}, HOME), join(HOME, 'a', 'b.md'))
  })

  it('绝对路径原样返回', () => {
    const abs = join(HOME, 'x.md')
    assert.equal(resolveSoulPath(abs, {}, HOME), abs)
  })

  it('相对路径锚定 DSH_HOME，未设置时回落到 ~/.dsh', () => {
    assert.equal(resolveSoulPath('s.md', { DSH_HOME: HOME }, HOME), join(HOME, 's.md'))
    assert.equal(resolveSoulPath('s.md', {}, join(HOME, 'u')), join(HOME, 'u', '.dsh', 's.md'))
  })

  it('空白或非字符串输入返回 undefined', () => {
    for (const bad of ['', '   ', undefined, null, 42, {}]) {
      assert.equal(resolveSoulPath(bad, {}, HOME), undefined)
    }
  })
})

describe('stripFrontmatter', () => {
  it('剥掉闭合的 frontmatter', () => {
    const raw = '---\ntitle: x\n---\n\n# Body\n\ntext\n'
    assert.deepEqual(stripFrontmatter(raw), { text: '# Body\n\ntext\n', stripped: true })
  })

  it('接受 ... 作为结束围栏', () => {
    const { text, stripped } = stripFrontmatter('---\na: 1\n...\nbody')
    assert.equal(stripped, true)
    assert.equal(text, 'body')
  })

  it('无 frontmatter 时原样返回', () => {
    const raw = '# Title\n\nno frontmatter here\n'
    assert.deepEqual(stripFrontmatter(raw), { text: raw, stripped: false })
  })

  it('未闭合的围栏按正文处理，不吞内容', () => {
    const raw = '---\ntitle: x\n# Body\n'
    assert.deepEqual(stripFrontmatter(raw), { text: raw, stripped: false })
  })

  it('剥掉 BOM 后仍能识别围栏', () => {
    const { stripped } = stripFrontmatter('\uFEFF---\na: 1\n---\nbody')
    assert.equal(stripped, true)
  })

  it('容忍 CRLF 行尾，并把正文行尾规范成 \\n', () => {
    const { text, stripped } = stripFrontmatter('---\r\na: 1\r\n---\r\nbody\r\n')
    assert.equal(stripped, true)
    assert.equal(text, 'body\n')
  })

  it('容忍围栏行尾空格', () => {
    assert.equal(stripFrontmatter('---  \na: 1\n---  \nbody').stripped, true)
  })
})

describe('annotateContinuitySection', () => {
  it('在 Continuity 标题后插入标注', () => {
    const { text, annotated } = annotateContinuitySection('## Vibe\n\nx\n\n## Continuity\n\ny\n', 'NOTE')
    assert.equal(annotated, true)
    assert.match(text, /## Continuity\n\nNOTE\n\ny/)
  })

  it('标题大小写与层级都不敏感', () => {
    assert.equal(annotateContinuitySection('# continuity\ny', 'N').annotated, true)
    assert.equal(annotateContinuitySection('####  CONTINUITY  \ny', 'N').annotated, true)
  })

  it('只标注第一个匹配的标题', () => {
    const { text } = annotateContinuitySection('## Continuity\na\n## Continuity\nb', 'N')
    assert.equal(text.split('N').length - 1, 1)
  })

  it('没有该标题时不改动', () => {
    const raw = '## Vibe\n\nx\n'
    assert.deepEqual(annotateContinuitySection(raw, 'N'), { text: raw, annotated: false })
  })

  it('不误伤含该词的普通句子', () => {
    assert.equal(annotateContinuitySection('there is continuity here', 'N').annotated, false)
  })

  it('标注为空时不做任何事', () => {
    const raw = '## Continuity\nx'
    assert.deepEqual(annotateContinuitySection(raw, ''), { text: raw, annotated: false })
  })
})

describe('prepareSoul', () => {
  const raw = '---\ntitle: t\n---\n\n# Who\n\nbody\n\n## Continuity\n\nfresh\n'

  it('同时剥 frontmatter 与标注 Continuity', () => {
    const out = prepareSoul(raw, { annotateContinuity: true, language: 'zh' })
    assert.ok(!out.includes('title: t'), 'frontmatter 应被剥掉')
    assert.ok(out.includes('长期协作约定'), '应插入中文标注')
    assert.ok(out.startsWith('# Who'), '应以正文开头')
  })

  it('关闭标注时保留原文结构', () => {
    const out = prepareSoul(raw, { annotateContinuity: false })
    assert.ok(out.includes('## Continuity'))
    assert.ok(!out.includes('长期协作约定'))
  })

  it('en 使用英文标注', () => {
    assert.match(prepareSoul(raw, { language: 'en' }), /working agreement/)
  })

  it('未知语言回落到中文标注', () => {
    assert.match(prepareSoul(raw, { language: 'fr' }), /长期协作约定/)
  })

  it('保留正文里的字面 {{ }}，不做任何转义或替换', () => {
    const out = prepareSoul('# T\n\nuse {{cwd}} and {{ model }}\n')
    assert.ok(out.includes('{{cwd}}'))
    assert.ok(out.includes('{{ model }}'))
  })
})

describe('createSoulSource', () => {
  it('读取指定文件', () => {
    const path = tempFile('a.md', '---\nt: 1\n---\nHELLO\n')
    const read = createSoulSource({ soulPath: path, annotateContinuity: false }, fakeLogger())
    assert.equal(read(), 'HELLO')
  })

  it('mtime 变化后重新读取（热重载）', () => {
    const path = tempFile('b.md', 'FIRST\n')
    const read = createSoulSource({ soulPath: path, annotateContinuity: false }, fakeLogger())
    assert.equal(read(), 'FIRST')
    writeFileSync(path, 'SECOND\n', 'utf8')
    const future = new Date(Date.now() + 5000)
    utimesSync(path, future, future)
    assert.equal(read(), 'SECOND')
  })

  it('mtime 与大小都不变时命中缓存，不重读磁盘', () => {
    const path = tempFile('c.md', 'FIRST\n')
    let reads = 0
    let content = 'FIRST\n'
    const info = statSync(path)
    const io = {
      statSync: () => info,
      readFileSync: () => {
        reads += 1
        return content
      },
    }
    const read = createSoulSource({ soulPath: path, annotateContinuity: false, io }, fakeLogger())
    assert.equal(read(), 'FIRST')
    assert.equal(reads, 1)
    // 键不变：即使底层内容已换，也必须命中缓存。
    content = 'SECND\n'
    assert.equal(read(), 'FIRST')
    assert.equal(reads, 1, '缓存命中时不应再读盘')
  })

  it('mtime 推进后缓存失效并重读', () => {
    const path = tempFile('d.md', 'FIRST\n')
    let reads = 0
    let mtimeMs = 1000
    const io = {
      statSync: () => ({ mtimeMs, size: 6 }),
      readFileSync: () => {
        reads += 1
        return reads === 1 ? 'FIRST\n' : 'SECOND\n'
      },
    }
    const read = createSoulSource({ soulPath: path, annotateContinuity: false, io }, fakeLogger())
    assert.equal(read(), 'FIRST')
    assert.equal(read(), 'FIRST')
    assert.equal(reads, 1)
    mtimeMs = 2000
    assert.equal(read(), 'SECOND')
    assert.equal(reads, 2)
  })

  it('主路径缺失时回落到兜底副本，并只告警一次', () => {
    const missing = join(HOME, 'nope', 'missing.md')
    const fallback = tempFile('fallback.md', 'FALLBACK\n')
    const logger = fakeLogger()
    const read = createSoulSource({ soulPath: missing, fallbackPath: fallback, annotateContinuity: false }, logger)
    assert.equal(read(), 'FALLBACK')
    assert.equal(read(), 'FALLBACK')
    assert.equal(logger.warnings.length, 1, '同一条告警不应每次都报')
    assert.match(String(logger.warnings[0][0]), /falling back/)
  })

  it('主路径与兜底都不可读时返回空串，且每个根因只告警一次', () => {
    const logger = fakeLogger()
    const read = createSoulSource(
      { soulPath: join(HOME, 'no1.md'), fallbackPath: join(HOME, 'no2.md'), annotateContinuity: false },
      logger,
    )
    assert.equal(read(), '')
    assert.equal(read(), '')
    assert.equal(logger.warnings.length, 2, '主路径与兜底各一条，不再追加总结告警')
  })

  it('未配置路径时返回空串并告警一次', () => {
    const logger = fakeLogger()
    assert.equal(createSoulSource({}, logger)(), '')
    assert.equal(logger.warnings.length, 1)
  })

  it('主路径是目录（读取抛错）时不崩溃，且只告警一次', () => {
    const logger = fakeLogger()
    const read = createSoulSource({ soulPath: tempDir(), annotateContinuity: false }, logger)
    assert.equal(read(), '')
    assert.equal(logger.warnings.length, 1)
  })
})
