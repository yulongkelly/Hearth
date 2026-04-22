import type { ElementType } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface ComingSoonCardProps {
  icon: ElementType
  iconBg: string
  iconColor: string
  name: string
  description: string
}

export function ComingSoonCard({ icon: Icon, iconBg, iconColor, name, description }: ComingSoonCardProps) {
  return (
    <Card className="opacity-60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconBg}`}>
              <Icon className={`h-5 w-5 ${iconColor}`} />
            </div>
            <div>
              <CardTitle className="text-sm">{name}</CardTitle>
              <CardDescription className="text-xs">{description}</CardDescription>
            </div>
          </div>
          <Badge variant="secondary" className="text-[10px]">Coming soon</Badge>
        </div>
      </CardHeader>
      <CardContent />
    </Card>
  )
}
