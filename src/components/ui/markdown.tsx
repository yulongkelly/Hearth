'use client'

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/cjs/styles/prism'
import { Copy, Check } from 'lucide-react'

function CodeBlock({ language, children }: { language: string; children: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(children)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative my-3 rounded-lg overflow-hidden border border-border">
      <div className="flex items-center justify-between px-4 py-1.5 bg-zinc-900 border-b border-border">
        <span className="text-xs text-muted-foreground font-mono">{language || 'code'}</span>
        <button
          onClick={copy}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <SyntaxHighlighter
        style={oneDark}
        language={language}
        PreTag="div"
        customStyle={{
          margin: 0,
          borderRadius: 0,
          background: 'hsl(240 10% 6%)',
          fontSize: '0.85rem',
        }}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  )
}

interface MarkdownProps {
  content: string
  streaming?: boolean
}

export function Markdown({ content, streaming }: MarkdownProps) {
  return (
    <div className="prose prose-invert prose-sm max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ node, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '')
            if (match) {
              return (
                <CodeBlock language={match[1]}>
                  {String(children).replace(/\n$/, '')}
                </CodeBlock>
              )
            }
            return (
              <code
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
                {...props}
              >
                {children}
              </code>
            )
          },
          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="mb-3 list-disc pl-4 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3 list-decimal pl-4 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="text-sm">{children}</li>,
          h1: ({ children }) => <h1 className="text-lg font-bold mb-2 mt-4">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-bold mb-2 mt-3">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-bold mb-1 mt-2">{children}</h3>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-primary/40 pl-3 italic text-muted-foreground">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:no-underline">
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto my-3">
              <table className="w-full text-xs border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border px-3 py-1.5 bg-muted font-semibold text-left">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border border-border px-3 py-1.5">{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
      {streaming && (
        <span className="inline-block h-4 w-2 bg-primary/70 animate-pulse ml-0.5 rounded-sm" />
      )}
    </div>
  )
}
