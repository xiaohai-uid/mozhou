/**
 * 漫剧分镜 · 客户端类型出口（T02）。
 * 类型真源 = server/storyboard/contract.ts（服务端权威 + 运行时校验唯一入口）；
 * 本文件仅做 type-only 转出口，供 StoryboardView 等客户端模块消费——
 * 运行时契约（上限/校验/路径/revision）以服务端为准，客户端不得自行放宽。
 */
export type {
  AspectRatio,
  ShotFraming,
  AdaptationOrigin,
  SourceSnapshot,
  AdaptationOptions,
  CharacterReference,
  ShotDialogueLine,
  Shot,
  StoryboardContent,
  StoryboardDocument,
} from '../../server/storyboard/contract.js'
