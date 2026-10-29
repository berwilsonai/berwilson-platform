import { notFound } from 'next/navigation'
import { readRoomStatus } from '@/lib/dataroom/status'
import DataRoomView from '@/components/dataroom/DataRoomView'

export const metadata = { title: 'Data room — Ber Wilson Intelligence' }

interface PageProps {
  params: Promise<{ id: string }>
}

/**
 * ⚠ 404 RATHER THAN AN EMPTY ROOM when the record is not on the data-room
 * template. Nineteen "Missing" rows on a consultant relationship is noise that
 * teaches people to ignore the surface, and the tab is hidden for those records
 * anyway — so reaching here by URL is a mistake, not a state.
 */
export default async function OpportunityDataRoomPage({ params }: PageProps) {
  const { id } = await params
  const status = await readRoomStatus('opportunity', id)
  if (!status) notFound()
  return <DataRoomView status={status} />
}
