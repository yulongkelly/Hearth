export const PLATFORMS = ['wechat', 'qq', 'telegram', 'discord', 'slack', 'whatsapp', 'matrix', 'email', 'mattermost'] as const
export type PlatformName = typeof PLATFORMS[number]

export type ConnectStatus = 'stopped' | 'scanning' | 'connecting' | 'connected' | 'error'

export interface PlatformState {
  platform: PlatformName
  status:   ConnectStatus
  qrImage:  string | null   // base64 data-URL; null for token-based platforms
  identity: string | null   // formatted display name after connect
  meta:     Record<string, unknown>  // platform-specific extras (guilds, uin, hasToken…)
  error:    string | null
}

export interface PlatformMessage {
  platform:  PlatformName
  from:      string        // sender display name
  room:      string | null // group / channel name; null for DMs
  text:      string
  timestamp: string        // ISO-8601
}

export interface QueryOptions {
  contact?: string
  channel?: string
  days?:    number
  limit?:   number
}

export interface ConnectOptions {
  token?:  string  // primary token / App ID
  secret?: string  // secondary credential (QQ client secret)
  uin?:    number  // unused, kept for compatibility
}

export interface BasePlatformAdapter {
  readonly name: PlatformName
  getState():    PlatformState
  connect(opts?: ConnectOptions):              Promise<void>
  disconnect():                                Promise<void>
  send(target: string, text: string):          Promise<string>
  queryMessages(opts?: QueryOptions):          PlatformMessage[]
  tryAutoConnect():                            Promise<void>
}
