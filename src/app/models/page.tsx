import { ModelManager } from '@/components/models/model-manager'

export default function ModelsPage() {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center border-b border-border px-6 h-14 flex-shrink-0">
        <h1 className="text-base font-semibold">Model Manager</h1>
      </div>
      <ModelManager />
    </div>
  )
}
