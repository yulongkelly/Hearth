import type { ChatMessage } from '@/lib/model-adapter'
import type { ModelAdapter } from '@/lib/model-adapter'
import type { PreferenceSignal } from './types'

const VALID_TYPES = new Set([
  'preference', 'fact', 'pattern',
  'relationship', 'concern', 'identity', 'learning', 'goal', 'progress',
])

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

const EXTRACTOR_SYSTEM = `You are an observation extractor for a personal AI assistant.
Analyze the conversation and extract user signals. Return ONLY a valid JSON array — no markdown, no explanation.

Each element:
{"type":"<type>","domain":"<domain>","value":"<concise description>","tags":["<tag1>","<tag2>"],"metadata":{...}}

Signal types and when to use them:
- preference: communication style, format choices, tool preferences
- fact: objective facts about the user (job, location, name)
- pattern: recurring behavior across multiple interactions
- relationship: person the user mentions, emails, or asks about
  → domain="people", metadata={"person":"<Full Name>","sentiment":"positive|neutral|negative"}
  → Extract from: "I need to email Alice", "what did Bob say?", sender names in inbox results
- concern: worry, stress, anxiety signal ("I'm worried about X", "this is stressful", "I'm behind on Y")
  → domain="wellbeing"
- identity: value, self-perception, priority ("I care about privacy", "I want to be more disciplined")
  → domain="values"
- learning: topic being studied or practiced ("I'm learning Rust", "trying to get better at X")
  → domain="learning"
- goal: explicit target or intention ("I want to finish X by May", "my goal is Y")
  → domain="goals", metadata={"declared":true}
- progress: completion event, milestone ("I finished X", "finally got Y working", "done with Z")
  → domain="progress"

Rules:
- Only extract clear, explicit, or strongly implied signals. If nothing warrants extraction, return [].
- For relationship signals: extract sender names from email tool results (not body content).
- metadata is optional; only include relevant fields.
- Max 5 tags per signal, max 200 chars for value, domain max 50 chars lowercase.`

function buildExtractionPrompt(
  messages:    ChatMessage[],
  toolResults: Map<string, string>,
): string {
  const userLines = messages
    .filter(m => m.role === 'user')
    .map(m => `- "${String(m.content).slice(0, 200)}"`)
    .join('\n')

  const toolNames = Array.from(toolResults.keys()).slice(0, 10).join(', ')

  // Include a snippet of email inbox results for relationship extraction
  // Only sender names and subjects — cap at 500 chars total, never full bodies
  const emailSnippets: string[] = []
  for (const [key, val] of toolResults) {
    if (key.includes('inbox') || key.includes('email')) {
      // Extract sender-like lines (From:, sender, name fields) only
      const senderLines = val
        .split('\n')
        .filter(l => /from:|sender:|"name":|"from":/i.test(l))
        .slice(0, 10)
        .join('\n')
        .slice(0, 500)
      if (senderLines) emailSnippets.push(`Email senders:\n${senderLines}`)
    }
  }

  const parts: string[] = []
  if (userLines) parts.push(`User messages:\n${userLines}`)
  if (toolNames) parts.push(`Tool calls made: ${toolNames}`)
  if (emailSnippets.length > 0) parts.push(emailSnippets.join('\n'))
  return parts.join('\n\n')
}

function parseSignals(raw: string, sessionId: string): PreferenceSignal[] {
  try {
    const start = raw.indexOf('[')
    const end   = raw.lastIndexOf(']')
    if (start < 0 || end <= start) return []
    const arr = JSON.parse(raw.slice(start, end + 1))
    if (!Array.isArray(arr)) return []
    return arr
      .filter(item =>
        item && typeof item === 'object' &&
        typeof item.domain === 'string' &&
        typeof item.value  === 'string'
      )
      .map(item => {
        const sig: PreferenceSignal = {
          id:        crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          type:      (VALID_TYPES.has(item.type) ? item.type : 'preference') as PreferenceSignal['type'],
          domain:    String(item.domain).toLowerCase().slice(0, 50),
          value:     String(item.value).slice(0, 200),
          tags:      Array.isArray(item.tags) ? item.tags.map(String).slice(0, 5) : [String(item.domain).toLowerCase()],
          sessionId,
        }
        if (item.metadata && typeof item.metadata === 'object') {
          const md: PreferenceSignal['metadata'] = {}
          if (typeof item.metadata.person === 'string') md.person = item.metadata.person.slice(0, 100)
          if (['positive', 'neutral', 'negative'].includes(item.metadata.sentiment)) md.sentiment = item.metadata.sentiment
          if (typeof item.metadata.week === 'string') md.week = item.metadata.week
          if (typeof item.metadata.declared === 'boolean') md.declared = item.metadata.declared
          if (Object.keys(md).length > 0) sig.metadata = md
        }
        // Fallback：relationship 信号缺少 person 时，从 value 里提取中文姓名
        if (sig.type === 'relationship' && !sig.metadata?.person) {
          const extracted = extractChinesePersonName(sig.value)
          if (extracted) sig.metadata = { ...sig.metadata, person: extracted }
        }
        return sig
      })
  } catch { return [] }
}

export async function extractObservations(
  messages:    ChatMessage[],
  toolResults: Map<string, string>,
  sessionId:   string,
  adapter:     ModelAdapter,
  model:       string,
): Promise<PreferenceSignal[]> {
  const userMessages = messages.filter(m => m.role === 'user')
  if (userMessages.length === 0) return []

  try {
    const result = await adapter.chat({
      model,
      messages: [
        { role: 'system', content: EXTRACTOR_SYSTEM },
        { role: 'user',   content: buildExtractionPrompt(messages, toolResults) },
      ],
      signal: AbortSignal.timeout(15_000),
    })
    return parseSignals(result.content.trim(), sessionId)
  } catch { return [] }
}
