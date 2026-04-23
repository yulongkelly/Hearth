import { ToolDispatcher } from '@/components/tools/tool-dispatcher'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ToolDispatcher id={id} />
}
