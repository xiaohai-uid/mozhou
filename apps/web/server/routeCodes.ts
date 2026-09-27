/**
 * 跨路由文件复用的错误码——客户端据此分支处理，所以它是一条**契约**，
 * 不是各文件自选的措辞。
 *
 * 为什么收口：'PROVIDER_UNAVAILABLE' 此前在 4 个路由文件各写一份字面量。
 * 四份拷贝里只要有一处改名或打错，界面就只在那一条路径上失去「AI 未配置」
 * 的正确呈现（多半退化成通用报错）。这种漂移不报错、测试也未必覆盖，
 * 恰恰是最贵的一类。
 *
 * 约定：只在**跨文件**重复且被客户端依赖的码登记于此；单文件内多次使用
 * 仍由该文件自持局部常量。
 */

/** 草稿 provider 未配置 / 不可用。客户端据此引导作者去设置页配 Key。 */
export const PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE'

/** 契约 404：盘上无此章。proseRoutes 与 storyboardRoutes 共用同一语义。 */
export const CHAPTER_MISSING = 'CHAPTER_MISSING'
