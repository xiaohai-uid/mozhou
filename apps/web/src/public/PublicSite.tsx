/**
 * apps/web/src/public · 公共产品介绍与合规门户 (Public Site · F16 · T13)。
 * 
 * 依照 reference/02-features.md T13 规格：
 * - 未登录可直接访问；
 * - 从服务端定价目录 billingCatalog 读取 Pro/Max 真实价格 (19/39 元)，不捏造虚假价格；
 * - 声明 Windows 客户端下载状态（未发布时诚实提示，不指向旧包）；
 * - 明确服务条款、隐私政策、数据本地优先与退款说明；
 * - 不包含任何系统 Secret 或凭据。
 */
import React, { useState } from 'react'
import { billingCatalog } from '../../server/billing/catalog'

export const PublicSite: React.FC = () => {
  const [tab, setTab] = useState<'intro' | 'pricing' | 'download' | 'terms'>('intro')

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans">
      {/* 顶栏 */}
      <header className="border-b border-neutral-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <span className="text-xl font-bold tracking-wider text-amber-500">墨舟 NOVEL OS</span>
          <span className="text-xs bg-neutral-800 text-neutral-400 px-2 py-0.5 rounded border border-neutral-700">
            Technical Preview
          </span>
        </div>
        <nav className="flex space-x-6 text-sm">
          <button
            type="button"
            className={`cursor-pointer ${tab === 'intro' ? 'text-amber-400 font-semibold' : 'text-neutral-400 hover:text-white'}`}
            onClick={() => setTab('intro')}
          >
            产品介绍
          </button>
          <button
            type="button"
            className={`cursor-pointer ${tab === 'pricing' ? 'text-amber-400 font-semibold' : 'text-neutral-400 hover:text-white'}`}
            onClick={() => setTab('pricing')}
          >
            价格方案
          </button>
          <button
            type="button"
            className={`cursor-pointer ${tab === 'download' ? 'text-amber-400 font-semibold' : 'text-neutral-400 hover:text-white'}`}
            onClick={() => setTab('download')}
          >
            下载桌面版
          </button>
          <button
            type="button"
            className={`cursor-pointer ${tab === 'terms' ? 'text-amber-400 font-semibold' : 'text-neutral-400 hover:text-white'}`}
            onClick={() => setTab('terms')}
          >
            服务与隐私
          </button>
        </nav>
      </header>

      {/* 主内容 */}
      <main className="max-w-5xl mx-auto px-6 py-12">
        {tab === 'intro' && (
          <section className="space-y-8">
            <div className="space-y-3">
              <h1 className="text-4xl font-extrabold text-white">长篇网文操作系统</h1>
              <p className="text-neutral-400 text-lg leading-relaxed">
                本地优先、工业级长程因果契约、11 项机械门禁与真模型流式创作工作台。
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
              <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-lg space-y-2">
                <h3 className="font-bold text-amber-400">本地优先与数据掌控</h3>
                <p className="text-sm text-neutral-400">所有小说正典、草稿与因果流水均存储在本地 SQLite 与 Markdown 中，永不锁死。</p>
              </div>
              <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-lg space-y-2">
                <h3 className="font-bold text-amber-400">双模型调用轨道</h3>
                <p className="text-sm text-neutral-400">支持作者自带 API Key (BYOK) 自由调用 DeepSeek / OpenAI，安全脱敏存储。</p>
              </div>
              <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-lg space-y-2">
                <h3 className="font-bold text-amber-400">真实多格式导出</h3>
                <p className="text-sm text-neutral-400">一键导出符合排版标准的 OOXML Word (.docx)、EPUB 3 电子书与纯净 TXT。</p>
              </div>
            </div>
          </section>
        )}

        {tab === 'pricing' && (
          <section className="space-y-8">
            <h2 className="text-3xl font-bold">价格方案（唯一官方定价）</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* 免费基础版 */}
              <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-lg flex flex-col justify-between">
                <div className="space-y-4">
                  <h3 className="text-xl font-bold">社区基础版</h3>
                  <div className="text-3xl font-extrabold text-white">免费</div>
                  <ul className="text-sm text-neutral-400 space-y-2">
                    <li>✓ 本地建书与章节创作</li>
                    <li>✓ 基础正典与本地事实追踪</li>
                    <li>✓ 原生 Word / EPUB / TXT 导出</li>
                    <li>✓ 完整备份与迁移功能</li>
                  </ul>
                </div>
              </div>

              {/* Pro 版 */}
              <div className="bg-neutral-900 border-2 border-amber-500/60 p-6 rounded-lg flex flex-col justify-between relative">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xl font-bold text-amber-400">{billingCatalog.pro.name}</h3>
                    <span className="text-xs bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded">推荐</span>
                  </div>
                  <div className="text-3xl font-extrabold text-white">
                    ¥{(billingCatalog.pro.amountFen / 100).toFixed(2)}
                    <span className="text-sm font-normal text-neutral-400"> / 月</span>
                  </div>
                  <ul className="text-sm text-neutral-300 space-y-2">
                    <li>✓ 包含基础版所有能力</li>
                    <li>✓ 动态分镜改编流水线</li>
                    <li>✓ 原文风格画像蒸馏</li>
                    <li>✓ 叙事架构与质量门禁审查</li>
                    <li>✓ 资料检索与全网榜单扫描</li>
                  </ul>
                </div>
              </div>

              {/* Max 版 */}
              <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-lg flex flex-col justify-between">
                <div className="space-y-4">
                  <h3 className="text-xl font-bold">{billingCatalog.max.name}</h3>
                  <div className="text-3xl font-extrabold text-white">
                    ¥{(billingCatalog.max.amountFen / 100).toFixed(2)}
                    <span className="text-sm font-normal text-neutral-400"> / 月</span>
                  </div>
                  <ul className="text-sm text-neutral-400 space-y-2">
                    <li>✓ 包含 Pro 版所有高级功能</li>
                    <li>✓ 官方托管模型配额（额度核算中）</li>
                    <li>✓ 专属优先推理通道</li>
                  </ul>
                </div>
              </div>
            </div>
          </section>
        )}

        {tab === 'download' && (
          <section className="space-y-6">
            <h2 className="text-3xl font-bold">下载 Windows 桌面版</h2>
            <div className="bg-neutral-900 border border-neutral-800 p-8 rounded-lg space-y-4">
              <p className="text-neutral-300">
                当前运行环境处于 <strong>Technical Preview / 内部预发布阶段</strong>。正式官方安装包由发布流水线自动化打包并签署校验。
              </p>
              <div className="inline-block bg-neutral-800 text-neutral-400 px-4 py-2 rounded text-sm font-mono border border-neutral-700">
                MoZhou-Novel-OS-v0.1.0-Setup.exe (构建就绪中)
              </div>
              <p className="text-xs text-neutral-500">
                系统要求：Windows 10 / 11 64-bit，WebView2 运行时（系统内置），支持完全离线创作。
              </p>
            </div>
          </section>
        )}

        {tab === 'terms' && (
          <section className="space-y-6 text-sm text-neutral-300 leading-relaxed">
            <h2 className="text-3xl font-bold text-white">服务条款、隐私政策与退款政策</h2>
            <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-lg space-y-4">
              <h3 className="text-base font-bold text-amber-400">一、用户数据自主权</h3>
              <p>
                用户在墨舟创作的一切小说文本、大纲、分镜和设定，版权完全归创作者所有。本地模式下所有数据均保存在创作者设备本地磁盘中，服务端绝不上传或窃取创作内容。
              </p>
              <h3 className="text-base font-bold text-amber-400">二、大模型调用说明</h3>
              <p>
                使用作者自备密钥 (BYOK) 时，请求直接流向目标上游大模型提供商（如 DeepSeek/OpenAI）；密钥采用 AES-256-GCM 强加密存储，绝不向第三方泄露。
              </p>
              <h3 className="text-base font-bold text-amber-400">三、退款政策</h3>
              <p>
                订阅购买后若遇到技术故障导致服务不可用，支持有界退款。退款确认后对应会期权益与额度同步撤销，但已保存的本地作品永远保留。
              </p>
            </div>
          </section>
        )}
      </main>

      <footer className="border-t border-neutral-900 py-6 text-center text-xs text-neutral-600">
        墨舟 Novel OS · 商业发行版本地服务器 · 保留所有权利
      </footer>
    </div>
  )
}
