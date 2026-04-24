export interface CredentialField {
  name: string
  label: string
  type: 'text' | 'password' | 'url'
  hint?: string
}

export interface CapabilityAction {
  id: string
  name: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  description: string
}

export interface CapabilitySpec {
  id: string
  domain: string
  service: string
  aliases: string[]
  description: string
  entryType: 'service' | 'device'
  auth: {
    type: 'api_key' | 'bearer_token' | 'oauth2' | 'basic' | 'webhook'
    template: string
    fields: CredentialField[]
    testUrl?: string
    testMethod?: 'GET' | 'POST'
    devPortalUrl: string
    setupInstructions: string
  }
  baseUrl: string
  actions: CapabilityAction[]
  tags: string[]
}

const CAPABILITY_GRAPH: CapabilitySpec[] = [
  {
    id: 'spotify',
    domain: 'music',
    service: 'Spotify',
    aliases: ['spotify'],
    description: 'Spotify music streaming — control playback, query tracks, manage playlists.',
    entryType: 'service',
    auth: {
      type: 'bearer_token',
      template: 'Bearer {access_token}',
      fields: [
        { name: 'access_token', label: 'Access Token', type: 'password', hint: 'OAuth2 access token from Spotify developer dashboard' },
      ],
      testUrl: 'https://api.spotify.com/v1/me',
      testMethod: 'GET',
      devPortalUrl: 'https://developer.spotify.com/dashboard',
      setupInstructions: 'Go to developer.spotify.com/dashboard → Create App → copy Client ID/Secret → use OAuth2 PKCE flow or generate an access token in the OAuth2 token tool.',
    },
    baseUrl: 'https://api.spotify.com/v1',
    actions: [
      { id: 'get_current_track', name: 'Get Currently Playing', method: 'GET', path: '/me/player/currently-playing', description: 'Get the currently playing track' },
      { id: 'pause_playback',    name: 'Pause Playback',        method: 'PUT', path: '/me/player/pause',            description: 'Pause playback' },
      { id: 'resume_playback',   name: 'Resume Playback',       method: 'PUT', path: '/me/player/play',             description: 'Resume playback' },
      { id: 'next_track',        name: 'Skip to Next',          method: 'POST', path: '/me/player/next',            description: 'Skip to next track' },
      { id: 'search',            name: 'Search',                method: 'GET', path: '/search',                     description: 'Search for tracks, albums, artists' },
    ],
    tags: ['music', 'streaming', 'playback'],
  },
  {
    id: 'github',
    domain: 'devtools',
    service: 'GitHub',
    aliases: ['github', 'gh'],
    description: 'GitHub — repos, issues, pull requests, commits.',
    entryType: 'service',
    auth: {
      type: 'bearer_token',
      template: 'Bearer {token}',
      fields: [
        { name: 'token', label: 'Personal Access Token', type: 'password', hint: 'Generate at github.com → Settings → Developer settings → Personal access tokens' },
      ],
      testUrl: 'https://api.github.com/user',
      testMethod: 'GET',
      devPortalUrl: 'https://github.com/settings/tokens',
      setupInstructions: 'Go to github.com → Settings → Developer settings → Personal access tokens → Generate new token (classic). Select repo and read:user scopes.',
    },
    baseUrl: 'https://api.github.com',
    actions: [
      { id: 'list_repos',   name: 'List Repos',   method: 'GET', path: '/user/repos',                  description: 'List authenticated user\'s repositories' },
      { id: 'list_issues',  name: 'List Issues',  method: 'GET', path: '/repos/{owner}/{repo}/issues',  description: 'List issues for a repository' },
      { id: 'list_prs',     name: 'List PRs',     method: 'GET', path: '/repos/{owner}/{repo}/pulls',   description: 'List pull requests for a repository' },
      { id: 'get_user',     name: 'Get User',     method: 'GET', path: '/user',                         description: 'Get authenticated user profile' },
    ],
    tags: ['git', 'code', 'devtools'],
  },
  {
    id: 'notion',
    domain: 'productivity',
    service: 'Notion',
    aliases: ['notion'],
    description: 'Notion — read and write pages, databases, and blocks.',
    entryType: 'service',
    auth: {
      type: 'bearer_token',
      template: 'Bearer {api_key}',
      fields: [
        { name: 'api_key', label: 'Integration Token', type: 'password', hint: 'Create an internal integration at notion.so/my-integrations' },
      ],
      testUrl: 'https://api.notion.com/v1/users/me',
      testMethod: 'GET',
      devPortalUrl: 'https://www.notion.so/my-integrations',
      setupInstructions: 'Go to notion.so/my-integrations → New integration → copy Internal Integration Token. Then share your pages/databases with the integration.',
    },
    baseUrl: 'https://api.notion.com/v1',
    actions: [
      { id: 'search',          name: 'Search',          method: 'POST', path: '/search',              description: 'Search pages and databases' },
      { id: 'get_page',        name: 'Get Page',        method: 'GET',  path: '/pages/{page_id}',     description: 'Retrieve a page by ID' },
      { id: 'create_page',     name: 'Create Page',     method: 'POST', path: '/pages',               description: 'Create a new page' },
      { id: 'query_database',  name: 'Query Database',  method: 'POST', path: '/databases/{id}/query', description: 'Query a database' },
    ],
    tags: ['notes', 'wiki', 'productivity'],
  },
  {
    id: 'openweathermap',
    domain: 'weather',
    service: 'OpenWeatherMap',
    aliases: ['openweathermap', 'openweather', 'weather api', 'owm'],
    description: 'OpenWeatherMap — current weather and forecasts worldwide.',
    entryType: 'service',
    auth: {
      type: 'api_key',
      template: '',
      fields: [
        { name: 'api_key', label: 'API Key', type: 'password', hint: 'Get a free key at openweathermap.org/api' },
      ],
      testUrl: 'https://api.openweathermap.org/data/2.5/weather?q=London&appid={api_key}',
      testMethod: 'GET',
      devPortalUrl: 'https://openweathermap.org/api',
      setupInstructions: 'Sign up at openweathermap.org → API Keys → copy the default key. The key may take a few minutes to activate. Pass it as the "appid" query parameter.',
    },
    baseUrl: 'https://api.openweathermap.org/data/2.5',
    actions: [
      { id: 'current_weather', name: 'Current Weather', method: 'GET', path: '/weather',  description: 'Get current weather by city or coordinates. Pass ?q=CityName&appid={api_key}' },
      { id: 'forecast',        name: '5-Day Forecast',  method: 'GET', path: '/forecast', description: 'Get 5-day 3-hour forecast. Pass ?q=CityName&appid={api_key}' },
    ],
    tags: ['weather', 'forecast'],
  },
  {
    id: 'airtable',
    domain: 'productivity',
    service: 'Airtable',
    aliases: ['airtable'],
    description: 'Airtable — read and write records in spreadsheet-style databases.',
    entryType: 'service',
    auth: {
      type: 'bearer_token',
      template: 'Bearer {api_key}',
      fields: [
        { name: 'api_key',  label: 'API Key',   type: 'password', hint: 'Find at airtable.com/account under API' },
        { name: 'base_id',  label: 'Base ID',   type: 'text',     hint: 'Found in the API docs URL: airtable.com/appXXXXXX/api/docs' },
      ],
      testUrl: 'https://api.airtable.com/v0/meta/bases',
      testMethod: 'GET',
      devPortalUrl: 'https://airtable.com/account',
      setupInstructions: 'Go to airtable.com/account → API → Generate API key. Find your Base ID in the URL when viewing your base.',
    },
    baseUrl: 'https://api.airtable.com/v0',
    actions: [
      { id: 'list_records',   name: 'List Records',   method: 'GET',  path: '/{base_id}/{table_name}', description: 'List records in a table' },
      { id: 'create_record',  name: 'Create Record',  method: 'POST', path: '/{base_id}/{table_name}', description: 'Create a new record' },
      { id: 'update_record',  name: 'Update Record',  method: 'PUT',  path: '/{base_id}/{table_name}/{record_id}', description: 'Update an existing record' },
    ],
    tags: ['spreadsheet', 'database', 'productivity'],
  },
  {
    id: 'linear',
    domain: 'devtools',
    service: 'Linear',
    aliases: ['linear'],
    description: 'Linear — issues, projects, and team workflows for engineering teams.',
    entryType: 'service',
    auth: {
      type: 'bearer_token',
      template: 'Bearer {api_key}',
      fields: [
        { name: 'api_key', label: 'API Key', type: 'password', hint: 'Generate at linear.app → Settings → API → Personal API Keys' },
      ],
      testUrl: 'https://api.linear.app/graphql',
      testMethod: 'POST',
      devPortalUrl: 'https://linear.app/settings/api',
      setupInstructions: 'Go to linear.app → Settings → API → Create new personal API key.',
    },
    baseUrl: 'https://api.linear.app',
    actions: [
      { id: 'graphql_query', name: 'GraphQL Query', method: 'POST', path: '/graphql', description: 'Run any GraphQL query or mutation (issues, projects, teams, etc.)' },
    ],
    tags: ['issues', 'project management', 'devtools'],
  },
  {
    id: 'slack_webhook',
    domain: 'messaging',
    service: 'Slack',
    aliases: ['slack', 'slack webhook'],
    description: 'Slack — post messages to channels via incoming webhooks.',
    entryType: 'service',
    auth: {
      type: 'webhook',
      template: '',
      fields: [
        { name: 'webhook_url', label: 'Webhook URL', type: 'password', hint: 'Incoming webhook URL from api.slack.com/apps' },
      ],
      testUrl: '{webhook_url}',
      testMethod: 'POST',
      devPortalUrl: 'https://api.slack.com/apps',
      setupInstructions: 'Go to api.slack.com/apps → Create app → Incoming Webhooks → Activate → Add to workspace → copy Webhook URL.',
    },
    baseUrl: '',
    actions: [
      { id: 'send_message', name: 'Send Message', method: 'POST', path: '{webhook_url}', description: 'Post a message to the webhook channel. Body: {"text": "..."}' },
    ],
    tags: ['messaging', 'notifications', 'slack'],
  },
  {
    id: 'twilio',
    domain: 'messaging',
    service: 'Twilio',
    aliases: ['twilio', 'twilio sms', 'sms api'],
    description: 'Twilio — send SMS messages programmatically.',
    entryType: 'service',
    auth: {
      type: 'basic',
      template: 'Basic {account_sid}:{auth_token}',
      fields: [
        { name: 'account_sid', label: 'Account SID',  type: 'text',     hint: 'Found on console.twilio.com dashboard' },
        { name: 'auth_token',  label: 'Auth Token',   type: 'password', hint: 'Found on console.twilio.com dashboard' },
        { name: 'from_number', label: 'From Number',  type: 'text',     hint: 'Your Twilio phone number in E.164 format, e.g. +12025551234' },
      ],
      testUrl: 'https://api.twilio.com/2010-04-01/Accounts/{account_sid}.json',
      testMethod: 'GET',
      devPortalUrl: 'https://console.twilio.com',
      setupInstructions: 'Sign up at twilio.com → get Account SID and Auth Token from console. Buy a phone number to send from.',
    },
    baseUrl: 'https://api.twilio.com/2010-04-01',
    actions: [
      { id: 'send_sms', name: 'Send SMS', method: 'POST', path: '/Accounts/{account_sid}/Messages.json', description: 'Send an SMS. Body: To=+1XXX&From={from_number}&Body=...' },
    ],
    tags: ['sms', 'messaging', 'twilio'],
  },
  {
    id: 'stripe',
    domain: 'finance',
    service: 'Stripe',
    aliases: ['stripe', 'stripe payments', 'stripe api'],
    description: 'Stripe — payments, customers, subscriptions, and charges.',
    entryType: 'service',
    auth: {
      type: 'bearer_token',
      template: 'Bearer {api_key}',
      fields: [
        { name: 'api_key', label: 'Secret Key', type: 'password', hint: 'Use the sk_test_... or sk_live_... key from dashboard.stripe.com/apikeys' },
      ],
      testUrl: 'https://api.stripe.com/v1/balance',
      testMethod: 'GET',
      devPortalUrl: 'https://dashboard.stripe.com/apikeys',
      setupInstructions: 'Go to dashboard.stripe.com/apikeys → copy the Secret key (starts with sk_). Use test keys (sk_test_...) for development.',
    },
    baseUrl: 'https://api.stripe.com/v1',
    actions: [
      { id: 'list_customers', name: 'List Customers', method: 'GET',  path: '/customers',        description: 'List customers' },
      { id: 'list_charges',   name: 'List Charges',   method: 'GET',  path: '/charges',          description: 'List charges' },
      { id: 'get_balance',    name: 'Get Balance',    method: 'GET',  path: '/balance',           description: 'Retrieve account balance' },
    ],
    tags: ['payments', 'billing', 'finance'],
  },
  {
    id: 'google_sheets',
    domain: 'productivity',
    service: 'Google Sheets',
    aliases: ['google sheets', 'sheets', 'google spreadsheet'],
    description: 'Google Sheets — read and write spreadsheet cells and ranges.',
    entryType: 'service',
    auth: {
      type: 'api_key',
      template: '',
      fields: [
        { name: 'api_key',         label: 'API Key',        type: 'password', hint: 'Create at console.cloud.google.com → APIs & Services → Credentials' },
        { name: 'spreadsheet_id',  label: 'Spreadsheet ID', type: 'text',     hint: 'Found in the spreadsheet URL between /d/ and /edit' },
      ],
      testUrl: 'https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}?key={api_key}',
      testMethod: 'GET',
      devPortalUrl: 'https://console.cloud.google.com/apis/credentials',
      setupInstructions: 'Enable Sheets API at console.cloud.google.com → Create API key → restrict to Sheets API. Spreadsheet must be set to "Anyone with link can view".',
    },
    baseUrl: 'https://sheets.googleapis.com/v4',
    actions: [
      { id: 'get_values',    name: 'Get Values',    method: 'GET',  path: '/spreadsheets/{spreadsheet_id}/values/{range}', description: 'Read cell range, e.g. Sheet1!A1:D10' },
      { id: 'update_values', name: 'Update Values', method: 'PUT',  path: '/spreadsheets/{spreadsheet_id}/values/{range}', description: 'Write values to a range' },
      { id: 'append_values', name: 'Append Values', method: 'POST', path: '/spreadsheets/{spreadsheet_id}/values/{range}:append', description: 'Append rows to a sheet' },
    ],
    tags: ['spreadsheet', 'google', 'productivity'],
  },
  {
    id: 'home_assistant',
    domain: 'smarthome',
    service: 'Home Assistant',
    aliases: ['home assistant', 'homeassistant', 'hass', 'ha'],
    description: 'Home Assistant — control and query any smart home entity (lights, switches, climate, media players, etc.) via the local REST API.',
    entryType: 'device',
    auth: {
      type: 'bearer_token',
      template: 'Bearer {token}',
      fields: [
        { name: 'ha_url', label: 'Home Assistant URL', type: 'url',      hint: 'Local IP or hostname, e.g. http://homeassistant.local:8123' },
        { name: 'token',  label: 'Long-Lived Access Token', type: 'password', hint: 'HA Profile → Long-Lived Access Tokens → Create Token' },
      ],
      testUrl: '{ha_url}/api/',
      testMethod: 'GET',
      devPortalUrl: 'http://homeassistant.local:8123/profile',
      setupInstructions: 'Open HA → Profile → Long-Lived Access Tokens → Create Token. Your ha_url is the local IP or hostname (e.g. http://homeassistant.local:8123).',
    },
    baseUrl: '{ha_url}/api',
    actions: [
      { id: 'list_entities',    name: 'List Entities',     method: 'GET',  path: '/states',                              description: 'Returns all entities; each has entity_id (e.g. light.living_room), state, attributes' },
      { id: 'get_entity_state', name: 'Get Entity State',  method: 'GET',  path: '/states/{entity_id}',                  description: 'Read current state and attributes of any entity' },
      { id: 'call_service',     name: 'Call Service',      method: 'POST', path: '/services/{domain}/{service}',          description: 'Control any entity. Body: {"entity_id": "light.living_room"}. Domain examples: light, switch, climate, media_player' },
    ],
    tags: ['smarthome', 'iot', 'automation', 'lights', 'switches'],
  },
]

export function queryCapabilities(query: string): CapabilitySpec | undefined {
  const q = query.toLowerCase().trim()
  if (!q) return undefined
  // Sort each spec's aliases longest first, then scan for substring match
  for (const spec of CAPABILITY_GRAPH) {
    const sorted = [...spec.aliases].sort((a, b) => b.length - a.length)
    for (const alias of sorted) {
      if (q.includes(alias) || alias.includes(q)) return spec
    }
  }
  return undefined
}

export function formatCapabilitySpec(spec: CapabilitySpec): string {
  const lines: string[] = [
    `[CAPABILITY GRAPH] ${spec.service} (${spec.entryType} — ${spec.domain})`,
    `Aliases: ${spec.aliases.join(', ')}`,
    '',
    `Auth: ${spec.auth.type}`,
    `  Setup: ${spec.auth.setupInstructions}`,
    `  Developer portal: ${spec.auth.devPortalUrl}`,
    `  Fields:`,
    ...spec.auth.fields.map(f => {
      const parts = [`name: "${f.name}"`, `label: "${f.label}"`, `type: "${f.type}"`]
      if (f.hint) parts.push(`hint: "${f.hint}"`)
      return `    - ${parts.join(', ')}`
    }),
    `  Authorization: ${spec.auth.template || '(none — credentials passed as query params or in body)'}`,
  ]
  if (spec.auth.testUrl) {
    lines.push(`  Test: ${spec.auth.testMethod ?? 'GET'} ${spec.auth.testUrl}`)
  }
  lines.push('')
  lines.push(`Base URL: ${spec.baseUrl}`)
  lines.push('')
  lines.push('Actions:')
  for (const action of spec.actions) {
    lines.push(`  - ${action.id}: ${action.method} ${action.path} — ${action.description}`)
  }
  lines.push('')
  lines.push(`Use connection name "${spec.service}" in http_request workflow steps.`)
  return lines.join('\n')
}
