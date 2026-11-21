/**
 * Direct CRM Webhook Dispatch & Autonomous Ghost Email Engine
 *
 * Supports 1-click dispatch to:
 * - HubSpot CRM Deals API v3
 * - Salesforce Opportunities SObject API
 * - Notion Database Pages API
 * - Generic Webhook (Zapier, Make, n8n, internal webhooks)
 *
 * Plus Ghost Email direct-to-mailbox drafting via mailto: and rich HTML clipboard.
 */

export type CrmPlatform = 'hubspot' | 'salesforce' | 'notion' | 'webhook'

export interface CrmDealPayload {
  company: string
  dealName: string
  dealStage: string
  dealAmount: string
  dealCloseDate: string
  dealNextSteps: string
  executiveSummary: string
  keyDecisions: string[]
  actionItems: Array<{ task: string; owner?: string; deadline?: string }>
  hesitationScore?: number
  timestamp?: number
}

export interface CrmDispatchConfig {
  platform: CrmPlatform
  webhookUrl: string
  apiKey?: string
}

export interface CrmDispatchResult {
  success: boolean
  statusCode: number
  statusMessage: string
  dispatchedAt: number
  platform: CrmPlatform
  destinationUrl: string
}

export interface EmailDraftParams {
  to: string
  subject: string
  bodyText: string
  company: string
  keyDecisions: string[]
  actionItems: Array<{ task: string; owner?: string; deadline?: string }>
}

const STORAGE_KEY_CRM_PLATFORM = 'klyro_crm_platform'
const STORAGE_KEY_CRM_WEBHOOK = 'klyro_crm_webhook_url'

/** Load persisted CRM preferences from localStorage */
export function getSavedCrmConfig(): { platform: CrmPlatform; webhookUrl: string } {
  try {
    if (typeof localStorage === 'undefined') {
      return { platform: 'hubspot', webhookUrl: '' }
    }
    const platform = (localStorage.getItem(STORAGE_KEY_CRM_PLATFORM) as CrmPlatform) || 'hubspot'
    const webhookUrl = localStorage.getItem(STORAGE_KEY_CRM_WEBHOOK) || ''
    return { platform, webhookUrl }
  } catch {
    return { platform: 'hubspot', webhookUrl: '' }
  }
}

/** Save CRM preferences to localStorage */
export function saveCrmConfig(platform: CrmPlatform, webhookUrl: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY_CRM_PLATFORM, platform)
      localStorage.setItem(STORAGE_KEY_CRM_WEBHOOK, webhookUrl)
    }
  } catch {
    // Ignore in sandboxed / non-browser environments
  }
}

/**
 * Format payload according to CRM-specific schema standards.
 */
export function formatCrmPayload(platform: CrmPlatform, deal: CrmDealPayload): Record<string, unknown> {
  const numericAmount = parseFloat(deal.dealAmount.replace(/[^0-9.]/g, '')) || 0

  switch (platform) {
    case 'hubspot':
      return {
        properties: {
          dealname: deal.dealName,
          pipeline: 'default',
          dealstage: deal.dealStage.toLowerCase().replace(/[^a-z0-9]/g, '_'),
          amount: numericAmount.toString(),
          closedate: deal.dealCloseDate,
          description: `${deal.executiveSummary}\n\nKey Decisions:\n${deal.keyDecisions.map((d) => `• ${d}`).join('\n')}`,
          hs_next_step: deal.dealNextSteps,
          buyer_hesitation_index: deal.hesitationScore ?? 0,
          klyro_source: 'Klyro Autonomous GTM Deck'
        }
      }

    case 'salesforce':
      return {
        Name: deal.dealName,
        StageName: deal.dealStage,
        Amount: numericAmount,
        CloseDate: deal.dealCloseDate,
        NextStep: deal.dealNextSteps,
        Description: `${deal.executiveSummary}\n\nKey Action Items:\n${deal.actionItems.map((a) => `• ${a.task}`).join('\n')}`,
        LeadSource: 'Klyro Desktop Co-Pilot'
      }

    case 'notion':
      return {
        parent: { database_id: 'auto' },
        properties: {
          Name: { title: [{ text: { content: deal.dealName } }] },
          Stage: { select: { name: deal.dealStage } },
          Amount: { number: numericAmount },
          CloseDate: { date: { start: deal.dealCloseDate } },
          Summary: { rich_text: [{ text: { content: deal.executiveSummary.slice(0, 2000) } }] },
          NextStep: { rich_text: [{ text: { content: deal.dealNextSteps } }] }
        }
      }

    case 'webhook':
    default:
      return {
        event: 'gtm.deal.dispatched',
        timestamp: deal.timestamp || Date.now(),
        deal: {
          name: deal.dealName,
          company: deal.company,
          stage: deal.dealStage,
          amountRaw: deal.dealAmount,
          amountParsed: numericAmount,
          closeDate: deal.dealCloseDate,
          nextSteps: deal.dealNextSteps
        },
        executiveSummary: deal.executiveSummary,
        keyDecisions: deal.keyDecisions,
        actionItems: deal.actionItems,
        buyerAcoustics: {
          hesitationScore: deal.hesitationScore ?? 0
        }
      }
  }
}

/**
 * Dispatch formatted deal data to the designated CRM webhook.
 */
export async function dispatchCrmDeal(
  config: CrmDispatchConfig,
  deal: CrmDealPayload
): Promise<CrmDispatchResult> {
  const url = config.webhookUrl.trim()
  if (!url) {
    throw new Error('Please enter a valid webhook URL for ' + config.platform)
  }

  const payload = formatCrmPayload(config.platform, deal)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {})
      },
      body: JSON.stringify(payload)
    })

    return {
      success: response.ok,
      statusCode: response.status,
      statusMessage: response.statusText || (response.ok ? 'OK' : 'Dispatch Failed'),
      dispatchedAt: Date.now(),
      platform: config.platform,
      destinationUrl: url
    }
  } catch (error) {
    // If running offline or test environment without mock
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      statusCode: 503,
      statusMessage: `Network error: ${message}`,
      dispatchedAt: Date.now(),
      platform: config.platform,
      destinationUrl: url
    }
  }
}

/**
 * Generates an RFC-compliant mailto: URI for opening in the user's default desktop email client.
 */
export function generateMailtoUri(params: EmailDraftParams): string {
  const encodedTo = encodeURIComponent(params.to.trim())
  const encodedSubject = encodeURIComponent(params.subject.trim())
  const encodedBody = encodeURIComponent(params.bodyText.trim())

  return `mailto:${encodedTo}?subject=${encodedSubject}&body=${encodedBody}`
}

/**
 * Writes rich HTML and plain text to the system clipboard for pasting directly into Gmail/Outlook.
 */
export async function copyRichEmailToClipboard(params: EmailDraftParams): Promise<boolean> {
  const plainText = params.bodyText.trim()
  const htmlDecisions = params.keyDecisions.map((d) => `<li>${d}</li>`).join('')
  const htmlActions = params.actionItems
    .map(
      (a) =>
        `<li><strong>${a.task}</strong>${a.owner ? ` (<em>@${a.owner}</em>)` : ''}${a.deadline ? ` &mdash; Due: ${a.deadline}` : ''}</li>`
    )
    .join('')

  const htmlFormatted = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #1e293b;">
  <p>Hi Team,</p>
  <p>Thank you for the productive discussion today regarding <strong>${params.company}</strong>.</p>
  ${
    params.keyDecisions.length > 0
      ? `<p><strong>Key Takeaways & Decisions:</strong></p><ul>${htmlDecisions}</ul>`
      : ''
  }
  ${
    params.actionItems.length > 0
      ? `<p><strong>Action Items:</strong></p><ul>${htmlActions}</ul>`
      : ''
  }
  <p>Best regards,<br/><strong>${params.company} Account Team</strong></p>
</div>
`.trim()

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      const textBlob = new Blob([plainText], { type: 'text/plain' })
      const htmlBlob = new Blob([htmlFormatted], { type: 'text/html' })
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': textBlob,
          'text/html': htmlBlob
        })
      ])
      return true
    } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(plainText)
      return true
    }
    return false
  } catch {
    return false
  }
}

