import type { KnowledgeLocale } from './types'

// 常见中文单字姓氏（含前200高频姓）
const HAN_SURNAMES = '赵钱孙李刘陈杨黄吴张王周徐朱林郑吕高何罗郭谢萧唐冯许邓韩曹曾彭肖蔡潘田董袁于余叶蒋石阮龙江史金苏丁魏侯顾孟熊秦尹薛叶闫段雷侯龙史金庞江邵毛钟谭贺武谷邱卢孔褚卫蒋沈韩秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董杜阮蓝闵席季麻强贾路娄危童颜郭梅盛林刁钟徐骆高夏蔡田樊胡凌霍虞万柯莫房干解应宗丁宣贲郁单杭洪包诸左石崔吉钮龚程嵇邢裴陆荣翁荀于惠甄家封芮储靳段富巫焦弓隗谷车侯宓全班仰秋仲伊宫宁仇栾暴甘厉戎'

/**
 * 从中文文本中提取人名（用于 relationship 信号的 fallback）。
 * 策略：姓氏锚定 + 上下文词边界。
 */
function extractChinesePersonName(text: string): string | undefined {
  const sn = `[${HAN_SURNAMES}]`
  const cn = '[一-鿿]'  // CJK 基本汉字范围
  // 前置词 + 姓（1字）+ 名（1字）= 最常见的两字名
  const reBefore = new RegExp(`(?:和|给|跟|与|找|问|告诉|回复|联系|邮件给|邮件回)(${sn}${cn})`)
  // 姓名 + 后置词（前瞻，不消耗边界字）：张伟说、李明帮、王芳发
  const reAfter  = new RegExp(`(${sn}${cn}{1,2}?)(?=说|帮|发|回|做|确|提|看|问|告诉|的邮件)`)
  return (text.match(reBefore) ?? text.match(reAfter))?.[1]
}

export const zhLocale: KnowledgeLocale = {
  extractPersonName: extractChinesePersonName,
  synthPromptSuffix: '请用中文输出。',
  digestPromptSuffix: '用中文写摘要，保持简洁。',
}
