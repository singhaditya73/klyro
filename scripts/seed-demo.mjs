/**
 * Seeds a demo conversation (rich markdown) into the local Klyro store so the
 * chat surface can be reviewed with realistic content.
 *
 * Usage: node scripts/seed-demo.mjs [--restore]
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const store = process.env.KLYRO_SEED_STORE
  || join(homedir(), '.config', 'klyro', 'conversations.json')
const backup = `${store}.design-review-backup`

if (process.argv.includes('--restore')) {
  if (existsSync(backup)) {
    copyFileSync(backup, store)
    console.log('restored original conversations.json')
  } else {
    console.log('no backup to restore')
  }
  process.exit(0)
}

if (!existsSync(store)) {
  console.log('no store at', store)
  process.exit(1)
}
copyFileSync(store, backup)

const now = Date.now()
const id = 'design-review-demo'
const answer = `Here is a quick tour of what Klyro can do — formatted the way a real answer looks.

## Highlights

- **Streaming answers** with full conversation memory
- Documents and memories are **grounded**, not guessed
- Every consequential action is **audited locally**

### A small table

| Capability | Status | Notes |
| --- | --- | --- |
| Chat | Shipped | Streaming, markdown, history |
| Meetings | Shipped | Transcript, summary, action items |
| Tools | Shipped | MCP servers, approval-gated |

\`\`\`ts
// The approval gate lives in the chat domain
const approved = await requestApproval(call)
if (!approved) return 'The user declined this tool call.'
\`\`\`

> Everything stays on your device unless you send it to your own provider.

Ready when you are — ask about anything.`

const data = JSON.parse(readFileSync(store, 'utf8'))
const conversation = {
  id,
  title: 'What can Klyro do?',
  createdAt: now,
  updatedAt: now,
  messages: [
    { id: `${id}-m1`, role: 'user', content: 'What can Klyro do?', createdAt: now },
    { id: `${id}-m2`, role: 'assistant', content: answer, createdAt: now, model: 'llama-3.3-70b-versatile' }
  ]
}
data.conversations = [conversation, ...data.conversations.filter((c) => c.id !== id)]
writeFileSync(store, JSON.stringify(data, null, 2))
console.log('seeded demo conversation')
