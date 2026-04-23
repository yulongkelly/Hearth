import { NextResponse } from 'next/server'
import { getBotState, isXpAvailable } from '@/lib/wechat-bot'
import QRCode from 'qrcode'

export const dynamic = 'force-dynamic'

export async function GET() {
  const state = getBotState()
  let qrImage: string | null = null
  if (state.qr) {
    try { qrImage = await QRCode.toDataURL(state.qr) } catch {}
  }
  return NextResponse.json({ ...state, qrImage, xpAvailable: isXpAvailable() })
}
