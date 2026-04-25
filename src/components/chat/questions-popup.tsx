'use client'

import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface ClarificationQuestion {
  question: string
  options: string[]
}

interface QuestionsPopupProps {
  id: string
  questions: ClarificationQuestion[]
  onSubmit: (answers: string[]) => void
}

function QuestionRow({
  q,
  index,
  selected,
  customValue,
  submitted,
  onSelect,
  onCustomChange,
}: {
  q: ClarificationQuestion
  index: number
  selected: string | null
  customValue: string
  submitted: boolean
  onSelect: (value: string | 'other') => void
  onCustomChange: (value: string) => void
}) {
  const isOtherSelected = selected === 'other'

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-foreground">{index + 1}. {q.question}</p>
      <div className="space-y-0.5">
        {q.options.map(opt => {
          const isSelected = selected === opt
          return (
            <button
              key={opt}
              onClick={() => !submitted && onSelect(opt)}
              disabled={submitted}
              className={cn(
                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors',
                isSelected
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                submitted && 'cursor-default',
              )}
            >
              <ChevronRight className={cn('h-3 w-3 flex-shrink-0 transition-opacity', isSelected ? 'opacity-100' : 'opacity-0')} />
              {opt}
            </button>
          )
        })}
        {/* Other — custom answer */}
        <button
          onClick={() => !submitted && onSelect('other')}
          disabled={submitted}
          className={cn(
            'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors',
            isOtherSelected
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            submitted && 'cursor-default',
          )}
        >
          <ChevronRight className={cn('h-3 w-3 flex-shrink-0 transition-opacity', isOtherSelected ? 'opacity-100' : 'opacity-0')} />
          Other…
        </button>
        {isOtherSelected && (
          <Input
            autoFocus
            value={customValue}
            onChange={e => onCustomChange(e.target.value)}
            disabled={submitted}
            placeholder="Type your answer…"
            className="mt-1 h-8 text-sm"
          />
        )}
      </div>
    </div>
  )
}

export function QuestionsPopup({ questions, onSubmit }: QuestionsPopupProps) {
  const [selections, setSelections] = useState<(string | null)[]>(() => questions.map(() => null))
  const [customValues, setCustomValues] = useState<string[]>(() => questions.map(() => ''))
  const [submitted, setSubmitted] = useState(false)

  function handleSelect(qIndex: number, value: string | 'other') {
    setSelections(prev => prev.map((s, i) => i === qIndex ? value : s))
  }

  function handleCustomChange(qIndex: number, value: string) {
    setCustomValues(prev => prev.map((v, i) => i === qIndex ? value : v))
  }

  const canSubmit = !submitted && questions.every((_, i) => {
    const sel = selections[i]
    if (!sel) return false
    if (sel === 'other') return customValues[i].trim().length > 0
    return true
  })

  function handleSubmit() {
    if (!canSubmit) return
    setSubmitted(true)
    const answers = questions.map((_, i) => {
      const sel = selections[i]
      return sel === 'other' ? customValues[i].trim() : (sel ?? '')
    })
    onSubmit(answers)
  }

  return (
    <div className="border-t border-border bg-card flex flex-col max-h-[50vh]">
      <div className="px-4 pt-3 pb-1 flex-shrink-0">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          The AI has a few questions
        </p>
      </div>
      <div className="px-4 pb-2 space-y-4 overflow-y-auto flex-1">
        {questions.map((q, i) => (
          <QuestionRow
            key={i}
            q={q}
            index={i}
            selected={selections[i]}
            customValue={customValues[i]}
            submitted={submitted}
            onSelect={(v) => handleSelect(i, v)}
            onCustomChange={(v) => handleCustomChange(i, v)}
          />
        ))}
      </div>
      <div className="flex justify-end px-4 py-3 flex-shrink-0 border-t border-border">
        <Button size="sm" onClick={handleSubmit} disabled={!canSubmit}>
          Submit answers
        </Button>
      </div>
    </div>
  )
}
