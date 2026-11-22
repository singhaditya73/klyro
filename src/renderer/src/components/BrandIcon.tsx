import React from 'react'

export type BrandType =
  | 'slack'
  | 'chatgpt'
  | 'openai'
  | 'anthropic'
  | 'claude'
  | 'claude-code'
  | 'google'
  | 'gemini'
  | 'grok'
  | 'xai'
  | 'groq'
  | 'antigravity'
  | 'codex'
  | 'opencode'
  | 'ollama'
  | 'github'
  | 'postgres'
  | 'postgresql'
  | 'hubspot'
  | 'salesforce'
  | 'crm'
  | 'openai-compatible'

interface Props extends React.SVGProps<SVGSVGElement> {
  brand?: BrandType | string
  size?: number
  className?: string
}

export function BrandIcon({ brand, size = 18, className = '', style, ...rest }: Props): React.JSX.Element | null {
  const normalized = (brand || '').toLowerCase().trim()

  const commonProps = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    className: `brand-icon ${className}`.trim(),
    style: { display: 'inline-block', verticalAlign: 'middle', flexShrink: 0, ...style },
    'aria-hidden': true,
    ...rest
  }

  // Slack
  if (normalized === 'slack') {
    return (
      <svg {...commonProps} fill="none" viewBox="0 0 24 24">
        <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A"/>
        <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0"/>
        <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312z" fill="#2EB67D"/>
        <path d="M15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#ECB22E"/>
      </svg>
    )
  }

  // ChatGPT / OpenAI
  if (normalized === 'openai' || normalized === 'chatgpt') {
    return (
      <svg {...commonProps} fill="currentColor" viewBox="0 0 24 24">
        <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 8.487a4.485 4.485 0 0 1 2.365-1.98v5.674a.78.78 0 0 0 .392.68l5.82 3.36-2.02 1.168a.078.078 0 0 1-.073.006L3.985 14.5a4.502 4.502 0 0 1-1.645-6.013zM17.11 11.2a.771.771 0 0 0-.78 0L10.487 14.57V12.24a.08.08 0 0 1 .033-.062l4.84-2.793a4.5 4.5 0 0 1 6.14 1.646 4.474 4.474 0 0 1 .536 3.014l-.142-.085-4.784-2.76zM20.25 15.513v-5.674a.78.78 0 0 0-.392-.68l-5.82-3.36 2.02-1.168a.078.078 0 0 1 .073-.006l4.839 2.885a4.502 4.502 0 0 1 1.645 6.013 4.485 4.485 0 0 1-2.365 1.99zM10.74 1.57a4.504 4.504 0 0 1 4.494 4.494v.001l-.141.08-4.779 2.76a.795.795 0 0 0-.392.68v6.738l-2.02-1.168a.071.071 0 0 1-.038-.052V9.52a4.504 4.504 0 0 1 2.876-7.95zM12 10.428l2.723 1.572v3.144L12 16.716l-2.723-1.572v-3.144z"/>
      </svg>
    )
  }

  // Google / Gemini
  if (normalized === 'google' || normalized === 'gemini') {
    return (
      <svg {...commonProps} viewBox="0 0 24 24" fill="none">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
      </svg>
    )
  }

  // Anthropic / Claude / Claude Code
  if (normalized === 'anthropic' || normalized === 'claude' || normalized === 'claude-code') {
    return (
      <svg {...commonProps} viewBox="0 0 24 24" fill="none">
        <path
          d="M13.827 2.502h-3.654L4.015 21.498h3.708l1.455-4.22h5.644l1.455 4.22h3.708L13.827 2.502zm-3.69 11.758 1.863-5.41 1.863 5.41h-3.726z"
          fill="#D97706"
        />
      </svg>
    )
  }

  // Antigravity (Google DeepMind)
  if (normalized === 'antigravity') {
    return (
      <svg {...commonProps} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="var(--accent)" strokeWidth="1.75" strokeDasharray="3 2" />
        <path d="M12 4L6 18h12L12 4z" fill="var(--accent)" fillOpacity="0.25" stroke="var(--accent)" strokeWidth="1.75" strokeLinejoin="round" />
        <circle cx="12" cy="13.5" r="2.2" fill="#ffffff" />
      </svg>
    )
  }

  // Codex
  if (normalized === 'codex') {
    return (
      <svg {...commonProps} viewBox="0 0 24 24" fill="none">
        <rect x="3" y="4" width="18" height="16" rx="4" fill="rgba(16, 185, 129, 0.12)" stroke="#10b981" strokeWidth="1.75" />
        <path d="M8 9l3 3-3 3" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="13" y1="15" x2="16" y2="15" stroke="#10b981" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  }

  // Grok / xAI
  if (normalized === 'grok' || normalized === 'xai') {
    return (
      <svg {...commonProps} viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
      </svg>
    )
  }

  // Groq
  if (normalized === 'groq') {
    return (
      <svg {...commonProps} viewBox="0 0 24 24" fill="none">
        <rect width="24" height="24" rx="5" fill="#F55036" />
        <path d="M16 11.5A4.5 4.5 0 1 0 11.5 16H16v-4.5z" fill="#ffffff" />
      </svg>
    )
  }

  // OpenCode
  if (normalized === 'opencode') {
    return (
      <svg {...commonProps} viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="18" height="18" rx="5" fill="rgba(249, 115, 22, 0.15)" stroke="#f97316" strokeWidth="1.75" />
        <path d="M8 8.5L4.5 12 8 15.5M16 8.5l3.5 3.5-3.5 3.5M13.5 7l-3 10" stroke="#f97316" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }

  // Ollama
  if (normalized === 'ollama') {
    return (
      <svg {...commonProps} viewBox="0 0 24 24" fill="currentColor">
        <path d="M10 2a2 2 0 0 0-2 2v2H7a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h1v4H7a2 2 0 0 0-2 2v2h2v2h2v-2h6v2h2v-2h2v-2a2 2 0 0 0-2-2h-1v-4h1a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-1V4a2 2 0 0 0-2-2h-4zm0 2h4v2h-4V4z"/>
      </svg>
    )
  }

  // GitHub
  if (normalized === 'github') {
    return (
      <svg {...commonProps} viewBox="0 0 24 24" fill="currentColor">
        <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/>
      </svg>
    )
  }

  // PostgreSQL
  if (normalized === 'postgres' || normalized === 'postgresql') {
    return (
      <svg {...commonProps} viewBox="0 0 24 24" fill="none">
        <rect width="24" height="24" rx="5" fill="#336791" />
        <path d="M12.016 4a8.5 8.5 0 0 0-3.96.98c-.39-.26-.83-.41-1.31-.41-1.44 0-2.62 1.35-2.62 3.02 0 .65.18 1.24.49 1.74C3.92 10.6 3.5 12.08 3.5 13.71c0 4.46 3.8 8.08 8.516 8.08 4.705 0 8.515-3.62 8.515-8.08 0-4.47-3.81-8.01-8.515-8.01zm3.22 3.26c.54 0 .98.49.98 1.1 0 .62-.44 1.12-.98 1.12-.54 0-.99-.5-.99-1.12 0-.61.45-1.1.99-1.1zm-6.46 0c.54 0 .99.49.99 1.1 0 .62-.45 1.12-.99 1.12-.54 0-.98-.5-.98-1.12 0-.61.44-1.1.98-1.1z" fill="#ffffff" />
      </svg>
    )
  }

  // HubSpot
  if (normalized === 'hubspot') {
    return (
      <svg {...commonProps} viewBox="0 0 24 24" fill="#FF7A59">
        <path d="M18.15 6.75V4.6a1.85 1.85 0 1 0-1.5 0v2.15a5.52 5.52 0 0 0-2.9 2.05l-5.6-4.36a1.85 1.85 0 1 0-1.2.95l5.5 4.3a5.52 5.52 0 0 0-1.2 3.56 5.52 5.52 0 0 0 1.2 3.56l-5.5 4.3a1.85 1.85 0 1 0 1.2.95l5.6-4.36a5.52 5.52 0 0 0 2.9 2.05V22a1.85 1.85 0 1 0 1.5 0v-2.15a5.55 5.55 0 1 0 0-13.1zm-4.7 9.8a4.05 4.05 0 1 1 0-6.5 4.05 4.05 0 0 1 0 6.5z"/>
      </svg>
    )
  }

  // Salesforce / CRM
  if (normalized === 'salesforce' || normalized === 'crm') {
    return (
      <svg {...commonProps} viewBox="0 0 24 24" fill="#00A1E0">
        <path d="M10.1 5.3a5.2 5.2 0 0 1 4.8 1.2 4.2 4.2 0 0 1 3.9 1.1 4.5 4.5 0 0 1 3.2 4.4 4.5 4.5 0 0 1-2.4 4 4.8 4.8 0 0 1-4.3 0 5 5 0 0 1-3.7 1.8 5.2 5.2 0 0 1-4.7-3.1 3.8 3.8 0 0 1-2.9-3.7 3.9 3.9 0 0 1 2.2-3.5 5.3 5.3 0 0 1 3.9-2.2z"/>
      </svg>
    )
  }

  // OpenAI-compatible / default generic neural node
  return (
    <svg {...commonProps} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v6m0 6v6M3 12h6m6 0h6M5.6 5.6l4.3 4.3m4.2 4.2l4.3 4.3M18.4 5.6l-4.3 4.3m-4.2 4.2l-4.3 4.3" strokeLinecap="round" opacity="0.6" />
    </svg>
  )
}

