import { ToolPage } from '@/components/tools/tool-page'

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ToolPage id={id} />
}
