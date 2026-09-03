export interface GenreKit {
  id: string;
  name: string;
  category: '男频爽文' | '都市异能' | '悬疑灵异' | '女频古言';
  tag: string;
  synopsis: string;
  goldenFinger: string;
  coreRule: string;
  bannedTropes: string[];
  openingBeats: string[];
}

export const GENRE_PRESETS: GenreKit[] = [
  {
    id: 'fake_god_occult',
    name: '灵异复苏 · 伪装神明流',
    category: '悬疑灵异',
    tag: '真假难辨 / 幕后黑手',
    synopsis: '主角本是走方骗子，在荒山破庙搭台立神坛，不料引来真神借像显灵。主角在官府特事处与恐怖邪祟之间刀尖起舞。',
    goldenFinger: '假神成真系统 / 香火愿力转化池',
    coreRule: '凡是显灵必有代价；凡人香火越盛，石像神明复苏越深。',
    bannedTropes: ['开局直接天下无敌', '无脑倒贴女主', '机械降神式无代价反转'],
    openingBeats: ['破庙立身：骗子设局招摇撞骗', '初次显灵：绝症患者奇迹康复引发轰动', '神像活化：深夜石像清嗓发出老者哼声'],
  },
  {
    id: 'fanqie_brainhole',
    name: '番茄脑洞 · 概念神打脸流',
    category: '男频爽文',
    tag: '反套路 / 爆笑爽文',
    synopsis: '觉醒规则系因果律技能，只要被嘲讽就能将对方话语变成强制执行的现实。',
    goldenFinger: '因果律言出法随（嘲讽即反噬）',
    coreRule: '越离谱的嘲讽，转化出的天道神罚威力越大。',
    bannedTropes: ['苦大仇深强行虐主', '长篇累牍解释设定', '圣母放过反派'],
    openingBeats: ['退婚羞辱：反派当众扬言你若能筑基我当场吃翔', '概念神启动：天地变色神雷助主角原地突破', '直播兑现：全宗门围观反派履约'],
  },
  {
    id: 'traditional_xianxia',
    name: '凡人修仙 · 苟道长生流',
    category: '男频爽文',
    tag: '稳健谨慎 / 炼丹种田',
    synopsis: '资质平平的杂役弟子，凭借一尊能催熟灵药的小绿瓶，在残酷修仙界步步为营，不争一时之气，只求万载长生。',
    goldenFinger: '神秘造化掌天瓶（催熟天地万物）',
    coreRule: '杀人必扬灰，凡事留三手；未有十成把握绝不出关。',
    bannedTropes: ['为了面子强行越级拼命', '收留来历不明的绝美女子', '在闹市大肆招摇显摆宝物'],
    openingBeats: ['深山偶得：跌落断崖意外捡到无名青铜残瓶', '暗中催熟：三年份黄龙草一夜蜕变为千年灵药', '隐忍蛰伏：用上品丹药暗中换取保命隐匿秘术'],
  },
  {
    id: 'urban_detective',
    name: '都市异能 · 特事处调查官',
    category: '都市异能',
    tag: '硬核推理 / 规则怪谈',
    synopsis: '灵异复苏时代的守夜人，依靠严谨的逻辑推演与物理法则，在诡异污染的封锁区收容一个个失控规则实体。',
    goldenFinger: '绝对理智之眼（解析万物规则弱点）',
    coreRule: '不可直视高维本体；遵循怪谈守则可规避必死攻击。',
    bannedTropes: ['不讲逻辑的唯心暴种', '队友全部降智', '特事局高层全是反派内奸'],
    openingBeats: ['凶案现场：雨夜密闭公寓里的全员消失谜案', '规则初显：电梯在不存在的十三层无故停滞', '逻辑破局：利用重力差反向卡死异化实体'],
  },
];
