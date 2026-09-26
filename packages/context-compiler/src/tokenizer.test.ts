/**
 * 精确 Token 计量测试。
 *
 * 断言值全部来自**随仓词表实测**（bge-small-zh-v1.5 WordPiece，21128 词条），
 * 不是估算。核心回归意义：这批数值与「1 码点 ≈ 1 token」估算器的结果差距巨大
 * （英文尤其明显），任何退回估算器的改动都会让这些断言失败。
 */
import { describe, expect, it } from 'vitest'
import { createLocalTokenizer, TokenizerAssetsError } from './tokenizer.js'

const tokenizer = createLocalTokenizer()

describe('createLocalTokenizer · 真实 WordPiece 计量', () => {
  it('空串计 0', () => {
    expect(tokenizer.count('')).toBe(0)
  })

  it('中文按单字成词（词表覆盖常用汉字）', () => {
    expect(tokenizer.count('你好')).toBe(2)
    expect(tokenizer.count('你好世界')).toBe(4)
    expect(tokenizer.count('天地玄黄，宇宙洪荒。')).toBe(10)
  })

  it('英文按词与子词切分——与码点估算器结果显著不同', () => {
    // 'hello world' 两个词都在词表内 ⇒ 2 token，码点计数是 11
    expect(tokenizer.count('hello world')).toBe(2)
    // 'internationalization' 被切成子词 ⇒ 4 token，码点计数是 20
    expect(tokenizer.count('internationalization')).toBe(4)
  })

  it('超过 max_input_chars_per_word 的长词整体落 [UNK]，计 1', () => {
    // 101 字符超过 100 上限 ⇒ 整词 1 个 [UNK]，而码点计数是 101
    expect(tokenizer.count('a'.repeat(101))).toBe(1)
    // 恰好 100 字符仍在限内，走正常子词切分（每 token 约 2 字符）
    expect(tokenizer.count('a'.repeat(100))).toBe(50)
    expect(tokenizer.count('a'.repeat(150))).toBe(1)
    // 大写：'A' 在词表内但续接形 '##A' 不在，于是整词落 [UNK]——
    // 这是 WordPiece 的既定语义（任一位无法匹配则整词 UNK），不是实现缺陷
    expect(tokenizer.count('A'.repeat(100))).toBe(1)
  })

  it('标点独立成段', () => {
    // HTTP / 2 / 协 / 议 —— 斜杠单独成段
    expect(tokenizer.count('HTTP/2 协议')).toBe(5)
    expect(tokenizer.count('他说：「你来了。」')).toBe(9)
  })

  it('确定性：同输入恒同输出', () => {
    const text = '她在渡口等了一整夜，雾从江面漫上来。The ship never came.'
    const first = tokenizer.count(text)
    for (let i = 0; i < 5; i += 1) {
      expect(tokenizer.count(text)).toBe(first)
    }
  })

  it('计量随文本单调不减（拼接更长则更多）', () => {
    const base = '第一章 启程'
    const longer = `${base} 他在渡口站了很久，直到雾散。`
    expect(tokenizer.count(longer)).toBeGreaterThan(tokenizer.count(base))
  })

  it('version 反映真实词表（进 Receipt，影响可复算性）', () => {
    expect(tokenizer.version).toBe('mozhou-bert-wordpiece-bge-small-zh-v1.5-v1')
  })

  it('资产缺失时响亮失败，不退化到估算器', () => {
    expect(() => createLocalTokenizer({ assetDir: 'C:/nonexistent-tokenizer-assets' })).toThrow(
      TokenizerAssetsError,
    )
  })
})
