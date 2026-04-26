export interface KnowledgeLocale {
  extractPersonName(text: string): string | undefined
  synthPromptSuffix: string
  digestPromptSuffix: string
}
