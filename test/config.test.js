/**
 * 配置归一化与段落组装的单元测试。
 *
 * @module dsh-fairy-soul/test/config.test
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { DEFAULT_CONFIG, DEFAULT_ORDER, SECTION_NAME, normalizeConfig } from '../lib/config.js'
import { composeSectionText } from '../index.js'

describe('normalizeConfig', () => {
  it('空输入给出完整默认值', () => {
    for (const empty of [undefined, null, {}, 'x', 42]) {
      assert.deepEqual(normalizeConfig(empty), {
        enabled: true,
        soulPath: '',
        language: 'zh',
        annotateContinuity: true,
        order: DEFAULT_ORDER,
      })
    }
  })

  it('默认 soulPath 为空串，表示使用随包发布的那份灵魂文件', () => {
    assert.equal(DEFAULT_CONFIG.soulPath, '')
    assert.equal(normalizeConfig({}).soulPath, '')
  })

  it('只有显式 false 才关闭开关', () => {
    assert.equal(normalizeConfig({ enabled: false }).enabled, false)
    for (const truthy of [0, '', null, 'false', 1]) {
      assert.equal(normalizeConfig({ enabled: truthy }).enabled, true)
    }
  })

  it('清理路径首尾空白', () => {
    assert.equal(normalizeConfig({ soulPath: '  ~/x.md  ' }).soulPath, '~/x.md')
  })

  it('清空 soulPath 是有效操作：回到随包版本，而不是回落到某个默认路径', () => {
    assert.equal(normalizeConfig({ soulPath: '/some/external.md' }).soulPath, '/some/external.md')
    assert.equal(normalizeConfig({ soulPath: '' }).soulPath, '')
    assert.equal(normalizeConfig({ soulPath: '   ' }).soulPath, '')
  })

  it('非字符串的 soulPath 回落到空串（即随包版本）', () => {
    for (const bad of [null, 42, {}, []]) {
      assert.equal(normalizeConfig({ soulPath: bad }).soulPath, '')
    }
  })

  it('只接受 zh 与 en 作为语言', () => {
    assert.equal(normalizeConfig({ language: 'en' }).language, 'en')
    assert.equal(normalizeConfig({ language: 'zh' }).language, 'zh')
    for (const bad of ['EN', 'jp', '', 7]) {
      assert.equal(normalizeConfig({ language: bad }).language, 'zh')
    }
  })

  it('order 只接受有限数值', () => {
    assert.equal(normalizeConfig({ order: 500 }).order, 500)
    assert.equal(normalizeConfig({ order: -1 }).order, -1)
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, 'x', null]) {
      assert.equal(normalizeConfig({ order: bad }).order, DEFAULT_ORDER)
    }
  })
})

describe('composeSectionText', () => {
  const soul = '# Who\n\nI am Fairy.\n'

  it('带划界声明，且声明在灵魂正文之前', () => {
    const out = composeSectionText(() => soul, 'zh')
    const framingAt = out.indexOf('只**定义你如何表达')
    const soulAt = out.indexOf('I am Fairy.')
    assert.ok(framingAt >= 0, '应含中文划界声明')
    assert.ok(soulAt > framingAt, '划界声明必须在灵魂正文之前')
  })

  it('声明中明确运行基底优先', () => {
    assert.match(composeSectionText(() => soul, 'zh'), /优先级高于本段/)
    assert.match(composeSectionText(() => soul, 'en'), /they win/)
  })

  it('en 使用英文声明', () => {
    const out = composeSectionText(() => soul, 'en')
    assert.match(out, /only\*\* how you express yourself/)
    assert.ok(!out.includes('只**定义你如何表达'))
  })

  it('未知语言回落到中文声明', () => {
    assert.match(composeSectionText(() => soul, 'fr'), /只\*\*定义你如何表达/)
  })

  it('灵魂为空时返回空串（段落会被组装流程丢弃）', () => {
    for (const empty of ['', '   ', '\n\n', undefined, null]) {
      assert.equal(composeSectionText(() => empty, 'zh'), '')
    }
  })

  it('灵魂为有效内容时不以空串返回', () => {
    assert.notEqual(composeSectionText(() => 'x', 'zh'), '')
  })
})

describe('常量', () => {
  it('段落名限定在 fairy 命名空间内', () => {
    assert.match(SECTION_NAME, /^fairy:/)
  })

  it('默认 order 排在最后一个内置段落之后', () => {
    assert.ok(DEFAULT_ORDER > 10200, '应大于 DEPLOYMENT_PERSONA_SUFFIX')
  })
})
