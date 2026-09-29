/**
 * Seed the Delta / Daves Farms parcel schedule from the Millard County zoning
 * map amendment exhibit (Sheet 1 of 2, JLD Development, September 2026).
 *
 *   node --experimental-strip-types --import ./deploy/register.mjs \
 *        --env-file=.env.local scripts/import-delta-parcels.mts
 *
 * The 11 rows below are transcribed from Exhibit A on the sheet — the deal's
 * own figures. Geometry and the assessor's acreage are fetched from Utah AGRC
 * by the same parcel ids, so nothing here is traced off the photograph.
 *
 * Re-running is safe: the import upserts on (record, parcel id).
 */

import { importParcels, type ScheduleEntry } from '@/lib/parcels/import'

const PROJECT_ID = 'bf6e5ac9-4d23-462d-85d1-70f37d7e976e'
const COUNTY = 'Millard'

// Colours are the exhibit's own fills, kept because people start referring to
// "the pink one" in correspondence long before they learn the parcel numbers.
const SCHEDULE: ScheduleEntry[] = [
  { parcelId: 'HD-5531-1', acres: 44.58, color: '#d8c06a' },
  { parcelId: 'HD-5530', acres: 100.0, color: '#c08a63' },
  { parcelId: 'HD-5535', acres: 160.0, color: '#c4615a' },
  { parcelId: 'HD-5534-A-1', acres: 13.0, color: '#9b7fb8' },
  { parcelId: 'HD-5534-1', acres: 69.0, color: '#4a90c4' },
  { parcelId: 'HD-5533-1', acres: 20.0, color: '#6fb3c9' },
  { parcelId: 'HD-5532', acres: 140.0, color: '#4c9a94' },
  { parcelId: 'HD-5536', acres: 160.0, color: '#b6bd6a' },
  { parcelId: 'HD-5536-B-1', acres: 62.4, color: '#9dc3e0' },
  { parcelId: 'HD-5536-A', acres: 80.0, color: '#b87f9e' },
  { parcelId: 'HD-5536-1-A', acres: 80.0, color: '#b9cf8a' },
]

const result = await importParcels({
  projectId: PROJECT_ID,
  county: COUNTY,
  schedule: SCHEDULE.map((row) => ({
    ...row,
    status: 'subject',
    ownerName: 'Daves Farms Property Holdings, LLC',
    existingZone: 'Agriculture',
    requestedZone: 'Heavy Industrial (HI)',
  })),
})

const scheduleAcres = SCHEDULE.reduce((sum, r) => sum + (r.acres ?? 0), 0)

console.log(`wrote ${result.written} parcels, ${result.withGeometry} with county geometry`)
console.log(`exhibit total: ${scheduleAcres.toFixed(2)} ac`)
if (result.lookupError) console.log(`⚠ AGRC lookup failed: ${result.lookupError}`)
if (result.missingFromCounty.length) {
  console.log(`⚠ not in the county layer: ${result.missingFromCounty.join(', ')}`)
}
for (const d of result.acreageDisagreements) {
  const delta = (d.schedule - d.assessor).toFixed(2)
  console.log(`⚠ ${d.parcelId}: exhibit ${d.schedule} ac vs assessor ${d.assessor} ac (${delta})`)
}
