import { NextRequest } from 'next/server'
import {
  getExpiringSubscriptions,
  renewSubscription,
} from '@/lib/integrations/microsoft-graph'

/**
 * GET /api/cron/renew-subscriptions
 *
 * Vercel Cron job — runs every 2 days.
 * Renews any Microsoft Graph webhook subscriptions expiring within 24 hours.
 *
 * Protected by CRON_SECRET to prevent unauthorized invocation.
 */
export async function GET(request: NextRequest) {
  // Verify this is a legitimate cron invocation
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Find subscriptions expiring within the next 52 hours.
    // Cron runs every 2 days (48h gap), so we check 52h ahead to ensure nothing slips through.
    const expiring = await getExpiringSubscriptions(52 * 60 * 60 * 1000)

    if (expiring.length === 0) {
      return Response.json({ message: 'No subscriptions need renewal', renewed: 0 })
    }

    const results: { subscriptionId: string; status: string; error?: string }[] = []

    for (const sub of expiring) {
      try {
        await renewSubscription(sub.subscription_id)
        results.push({ subscriptionId: sub.subscription_id, status: 'renewed' })
        console.log(`[cron] Renewed subscription ${sub.subscription_id}`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        results.push({ subscriptionId: sub.subscription_id, status: 'failed', error: msg })
        console.error(`[cron] Failed to renew ${sub.subscription_id}:`, msg)
      }
    }

    const renewed = results.filter((r) => r.status === 'renewed').length
    const failed = results.filter((r) => r.status === 'failed').length

    return Response.json({
      message: `Processed ${expiring.length} subscriptions: ${renewed} renewed, ${failed} failed`,
      renewed,
      failed,
      results,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[cron] Subscription renewal error:', message)
    return Response.json({ error: message }, { status: 500 })
  }
}
