/**
 * 公网目标解析与校验（出站 SSRF 防护第二半的**共享内核**）。
 *
 * `ssrfGuard` 只做字面 host / IP 网段分类；「解析 → 逐条校验 → 返回同一份结果供连接绑定」
 * 抽到这里，供爬虫与检索两个出站调用方共用，避免各自维护一份解析+校验而漂移
 * （与 `ssrfGuard` 当初抽出来的理由同源：两份网段清单必然分叉）。
 *
 * 调用方各自保留自己的**策略层**：字面 host 预检、协议白名单、部署者显式授权的私有
 * 网络例外（LLM 侧 `openaiStream.resolveVerifiedAddresses` 有该例外，不走本函数）。
 * 本函数只管「解析结果本身可不可信」。
 */
import { lookup } from 'node:dns/promises'
import { isPrivateOrReservedAddress } from '../ssrfGuard.js'
import type { PinnedAddress } from './pinnedHttp.js'
import { withAbort } from './abortWait.js'

export type AddressLookup = (hostname: string) => Promise<readonly PinnedAddress[]>

/** 缺省解析：Node DNS，取全部答案（verbatim 保序）。 */
export const defaultAddressLookup: AddressLookup = (hostname) => lookup(hostname, { all: true, verbatim: true })

/**
 * 解析并校验**全部**地址：空解析、或任一条落入私有/环回/保留地址即整体拒绝（fail closed）。
 * 返回的列表就是连接绑定要用的那一份——校验与连接同源，杜绝 DNS rebinding
 * （前检解析到公网、连接时解析到 127.0.0.1）。
 */
export async function resolvePublicAddresses(
  hostname: string,
  lookupAll: AddressLookup = defaultAddressLookup,
  signal?: AbortSignal,
): Promise<readonly PinnedAddress[]> {
  const addresses = await withAbort(() => lookupAll(hostname), signal)
  if (addresses.length === 0) {
    throw new Error(`SECURITY_REJECT: ${hostname} 未解析出可验证地址，已被安全策略拦截`)
  }
  const blocked = addresses.find((entry) => isPrivateOrReservedAddress(entry.address))
  if (blocked !== undefined) {
    throw new Error(`SECURITY_REJECT: ${hostname} 解析到私有/环回/保留地址 ${blocked.address}，已被安全策略拦截`)
  }
  return addresses
}
