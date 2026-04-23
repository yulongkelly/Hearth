import { NextRequest, NextResponse } from 'next/server'
import { sendWechatMessage } from '@/lib/wechat-bot'

export async function POST(req: NextRequest) {
  const { contact, message } = await req.json()
  if (!contact || !message)
    return NextResponse.json({ error: 'contact and message are required' }, { status: 400 })
  const result = await sendWechatMessage(String(contact), String(message))
  return NextResponse.json({ result })
}
