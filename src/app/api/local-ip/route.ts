import { NextResponse } from 'next/server'
import os from 'os'

export const dynamic = 'force-dynamic'

export async function GET() {
  const nets = os.networkInterfaces()
  let ip = '127.0.0.1'

  for (const iface of Object.values(nets)) {
    if (!iface) continue
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        ip = addr.address
        break
      }
    }
    if (ip !== '127.0.0.1') break
  }

  return NextResponse.json({ ip })
}
