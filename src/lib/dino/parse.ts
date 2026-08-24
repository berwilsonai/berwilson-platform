// Shared validation for Dino revenue + payment writes — used by both the
// create (POST) and update (PATCH) API routes. Route files can't export
// helpers, so the parsing lives here.

import type { TablesInsert } from '@/lib/supabase/types'
import { dinoSource } from '@/lib/utils/dino'

export type Body = Record<string, unknown>

function str(body: Body, key: string): string | null {
  const v = body[key]
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

function num(body: Body, key: string): number | null | 'invalid' {
  const v = body[key]
  if (v == null || v === '') return null
  const parsed = typeof v === 'number' ? v : parseFloat(String(v))
  return isNaN(parsed) || parsed < 0 ? 'invalid' : parsed
}

// ─── Revenue ─────────────────────────────────────────────────────────────────

export type RevenueFields = TablesInsert<'dino_revenue'>

export function parseRevenueFields(
  body: Body
): { ok: true; fields: RevenueFields } | { ok: false; error: string } {
  const source = dinoSource(str(body, 'source_type'))

  const amount = num(body, 'amount')
  if (amount === 'invalid') return { ok: false, error: 'Amount must be a positive number.' }

  const revenue_date = str(body, 'revenue_date')
  if (!revenue_date) return { ok: false, error: 'A revenue date is required.' }

  return {
    ok: true,
    fields: {
      source_type: source,
      // internal jobs link to a Ber Wilson project; external jobs name a client
      project_id: source === 'internal' ? str(body, 'project_id') : null,
      client_name: source === 'external' ? str(body, 'client_name') : null,
      description: str(body, 'description'),
      amount: amount ?? 0,
      revenue_date,
      notes: str(body, 'notes'),
    },
  }
}

// ─── Payment (installment on the amount we owe Dino) ─────────────────────────

export type PaymentFields = TablesInsert<'dino_payments'>

export function parsePaymentFields(
  body: Body
): { ok: true; fields: PaymentFields } | { ok: false; error: string } {
  const amount = num(body, 'amount')
  if (amount === 'invalid') return { ok: false, error: 'Amount must be a positive number.' }

  const paid = body.paid === true || body.paid === 'true'

  return {
    ok: true,
    fields: {
      label: str(body, 'label'),
      amount: amount ?? 0,
      due_date: str(body, 'due_date'),
      paid,
      // stamp a paid date when marking paid and none was supplied
      paid_date: paid ? str(body, 'paid_date') ?? new Date().toISOString().slice(0, 10) : null,
      notes: str(body, 'notes'),
    },
  }
}
