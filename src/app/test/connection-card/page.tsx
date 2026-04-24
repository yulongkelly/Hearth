'use client'

// Test-only page for Playwright component isolation tests.
// Not linked from the main app — only reachable by tests.

import { ConnectionSetupCard } from '@/components/chat/connection-setup-card'
import type { PendingConnection } from '@/lib/chat-store'

const MOCK: PendingConnection = {
  id: 'test-conn-id',
  service: 'TestService',
  instructions: 'Go to testservice.com/api → create a key.',
  links: [{ label: 'Developer Portal', url: 'https://example.com/dev' }],
  fields: [
    { name: 'api_key', label: 'API Key', type: 'password', placeholder: 'sk-...' },
    { name: 'region',  label: 'Region',  type: 'text',     placeholder: 'us-east' },
  ],
  test_url:    'https://jsonplaceholder.typicode.com/todos/1',
  test_method: 'GET',
}

export default function TestConnectionCardPage() {
  return (
    <div className="max-w-lg mx-auto mt-16">
      <ConnectionSetupCard
        connection={MOCK}
        onSuccess={(id) => { document.title = `success:${id}` }}
        onCancel={() => { document.title = 'cancelled' }}
      />
    </div>
  )
}
