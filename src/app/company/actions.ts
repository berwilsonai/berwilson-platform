'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'

export type CompanyFormState = { error: string } | { ok: true } | null

// ─── Update company profile singleton ───────────────────────────────────────

export async function updateCompanyProfile(
  _prev: CompanyFormState,
  formData: FormData
): Promise<CompanyFormState> {
  const supabase = createAdminClient()

  const str = (key: string) => (formData.get(key) as string | null)?.trim() || null

  const naicsRaw = str('naics_codes') ?? ''
  const sicRaw = str('sic_codes') ?? ''
  const naicsCodes = naicsRaw ? naicsRaw.split(',').map(s => s.trim()).filter(Boolean) : []
  const sicCodes = sicRaw ? sicRaw.split(',').map(s => s.trim()).filter(Boolean) : []

  const bondingCapacityRaw = str('bonding_capacity')
  const aggregateBondingRaw = str('aggregate_bonding')
  const foundedYearRaw = str('founded_year')

  const bondingCapacity = bondingCapacityRaw ? parseFloat(bondingCapacityRaw) : null
  const aggregateBonding = aggregateBondingRaw ? parseFloat(aggregateBondingRaw) : null
  const foundedYear = foundedYearRaw ? parseInt(foundedYearRaw) : null

  // Fetch the singleton id
  const { data: existing } = await supabase
    .from('company_profile')
    .select('id')
    .limit(1)
    .single()

  if (!existing) return { error: 'Company profile not found.' }

  const { error } = await supabase
    .from('company_profile')
    .update({
      legal_name: str('legal_name') ?? 'Ber Wilson Corporation',
      dba_name: str('dba_name'),
      founded_year: foundedYear,
      hq_address: str('hq_address'),
      website: str('website'),
      phone: str('phone'),
      email: str('email'),
      about: str('about'),
      capabilities: str('capabilities'),
      naics_codes: naicsCodes,
      sic_codes: sicCodes,
      dbe_certified: formData.get('dbe_certified') === 'true',
      mbe_certified: formData.get('mbe_certified') === 'true',
      wbe_certified: formData.get('wbe_certified') === 'true',
      sbe_certified: formData.get('sbe_certified') === 'true',
      bonding_capacity: bondingCapacity,
      aggregate_bonding: aggregateBonding,
      bonding_company: str('bonding_company'),
      updated_at: new Date().toISOString(),
    })
    .eq('id', existing.id)

  if (error) return { error: error.message }

  revalidatePath('/company')
  return { ok: true }
}

// ─── Certifications ──────────────────────────────────────────────────────────

export type CertFormState = { error: string } | { ok: true } | null

export async function createCertification(
  _prev: CertFormState,
  formData: FormData
): Promise<CertFormState> {
  const supabase = createAdminClient()

  const name = (formData.get('name') as string | null)?.trim() ?? ''
  if (!name) return { error: 'Certification name is required.' }

  const str = (key: string) => (formData.get(key) as string | null)?.trim() || null

  const { error } = await supabase.from('certifications').insert({
    name,
    issuing_body: str('issuing_body'),
    cert_number: str('cert_number'),
    issued_date: str('issued_date'),
    expiration_date: str('expiration_date'),
    is_active: formData.get('is_active') !== 'false',
    notes: str('notes'),
  })

  if (error) return { error: error.message }

  revalidatePath('/company')
  return { ok: true }
}

export async function updateCertification(
  certId: string,
  _prev: CertFormState,
  formData: FormData
): Promise<CertFormState> {
  const supabase = createAdminClient()

  const name = (formData.get('name') as string | null)?.trim() ?? ''
  if (!name) return { error: 'Certification name is required.' }

  const str = (key: string) => (formData.get(key) as string | null)?.trim() || null

  const { error } = await supabase
    .from('certifications')
    .update({
      name,
      issuing_body: str('issuing_body'),
      cert_number: str('cert_number'),
      issued_date: str('issued_date'),
      expiration_date: str('expiration_date'),
      is_active: formData.get('is_active') !== 'false',
      notes: str('notes'),
    })
    .eq('id', certId)

  if (error) return { error: error.message }

  revalidatePath('/company')
  return { ok: true }
}
