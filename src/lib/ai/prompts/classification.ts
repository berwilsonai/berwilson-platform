/**
 * Classification prompt — maps incoming email content to a project.
 * Called by Haiku to determine which project (if any) an email relates to.
 */

export const CLASSIFICATION_SYSTEM_PROMPT = `You are a project classifier for a construction executive intelligence platform.

Given an email's subject, sender, recipients, and body text, determine which active project (if any) it most likely relates to.

You will be provided with a list of active projects including:
- Project name
- Solicitation number (for government projects)
- Client entity
- Sector (government, infrastructure, real_estate, prefab, institutional)
- Key parties/players

CLASSIFICATION RULES:
- Match based on project names, solicitation numbers, client entities, key parties, or subject matter
- A direct mention of a project name or solicitation number = high confidence (0.85-1.0)
- A mention of a known party + relevant sector context = medium confidence (0.6-0.8)
- General sector relevance without specific project indicators = low confidence (0.3-0.5)
- No discernible project connection = very low confidence (0.0-0.3)
- If multiple projects could match, pick the one with highest confidence. If truly ambiguous between two, choose the more specific match and note the ambiguity in reasoning.
- Internal admin emails (IT, HR, general company) that don't relate to any project = confidence 0.0

Return ONLY valid JSON matching this exact schema:
{
  "project_id": "uuid of the matched project or null if no match",
  "confidence": 0.0,
  "reasoning": "brief explanation of why this project was selected or why no match was found"
}

Return ONLY valid JSON. No explanation. No markdown fences. No commentary.`

export const CLASSIFICATION_PROMPT_VERSION = '1.0'

/**
 * Build the user message for the classification prompt.
 * Includes the email content + all active projects for matching.
 */
export function buildClassificationMessage(
  email: {
    subject: string
    senderName: string
    senderEmail: string
    recipients: string[]
    bodyText: string
  },
  projects: {
    id: string
    name: string
    solicitation_number: string | null
    client_entity: string | null
    sector: string
    players: string[] // "Name (role)" format
  }[]
): string {
  const projectList = projects
    .map(
      (p) =>
        `- ID: ${p.id}\n  Name: ${p.name}\n  Sector: ${p.sector}${
          p.solicitation_number ? `\n  Solicitation: ${p.solicitation_number}` : ''
        }${p.client_entity ? `\n  Client: ${p.client_entity}` : ''}${
          p.players.length > 0 ? `\n  Key Players: ${p.players.join(', ')}` : ''
        }`
    )
    .join('\n\n')

  return `ACTIVE PROJECTS:
${projectList}

EMAIL TO CLASSIFY:
Subject: ${email.subject}
From: ${email.senderName} <${email.senderEmail}>
To: ${email.recipients.join(', ')}

Body:
${email.bodyText.slice(0, 8000)}`
}
