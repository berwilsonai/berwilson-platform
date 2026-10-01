// The rail network as the map reads it back to a person: the tile properties
// written by scripts/setup-rail-data.sh, and the reporting marks expanded into
// names. NARN identifies an owner by its FRA reporting mark ("CSXT"), which is
// exactly the kind of stored code §7 says never to print at a reader raw — but
// unlike an enum this is an open list of ~600 marks, so the map covers the
// Class I railroads and Amtrak (almost all STRACNET route-miles) and falls
// back to the mark itself for everyone else.

/**
 * The STRACNET designation as NARN stores it. NOT a yes/no — the DoD network
 * is two things, and the published map is titled for both: the strategic
 * corridors themselves and the connector lines that reach installations and
 * ports. Absent means the line carries no defense designation.
 */
export type StracnetClass = 'S' | 'C'

export const STRACNET_LABELS: Record<StracnetClass, string> = {
  S: 'STRACNET',
  C: 'Defense connector',
}

/** Properties carried on every rail feature in the vector tiles. */
export interface RailFeatureProps {
  /** FRAARCID — the FRA's permanent arc id. The key a corridor is pinned by. */
  id?: number
  owner?: string
  /** Reporting mark of the operator holding trackage rights, if any. */
  rights?: string
  subdiv?: string
  branch?: string
  /** 'S' strategic corridor, 'C' defense connector, absent otherwise. */
  strac?: StracnetClass
  /** NARN network class — see RAIL_NET_LABELS. */
  net?: string
  /** NARN passenger-service class — see RAIL_PASSENGER_LABELS. */
  passenger?: string
  tracks?: number
  miles?: number
  state?: string
}

// Reporting marks taken from THIS dataset, ranked by route-miles, not from
// memory: the Class Is here are UP/BNSF/CN/CPKC/CSXT/NS (CP and KCS merged
// into CPKC and their old marks are gone), and the rest are the operators that
// actually carry STRACNET mileage. An unlisted mark prints as itself.
const RAIL_OWNERS: Record<string, string> = {
  UP: 'Union Pacific',
  BNSF: 'BNSF Railway',
  CN: 'Canadian National',
  CPKC: 'Canadian Pacific Kansas City',
  CSXT: 'CSX Transportation',
  NS: 'Norfolk Southern',
  FXE: 'Ferromex',
  AMTK: 'Amtrak',
  VIA: 'Via Rail Canada',
  ONT: 'Ontario Northland',
  ARR: 'Alaska Railroad',
  USG: 'U.S. Government',
  CSAO: 'Conrail Shared Assets',
  FEC: 'Florida East Coast',
  INRD: 'Indiana Rail Road',
  WSOR: 'Wisconsin & Southern',
  SCAX: 'Metrolink (SCRRA)',
  SFRC: 'Tri-Rail (SFRTA)',
  BRC: 'Belt Railway of Chicago',
  TRRA: 'Terminal Railroad Association of St. Louis',
}

/** "CSXT" → "CSX Transportation"; an unknown mark prints as itself. */
export function railOwnerName(mark: string | null | undefined): string | null {
  if (!mark) return null
  const key = mark.trim().toUpperCase()
  if (!key) return null
  return RAIL_OWNERS[key] ?? key
}

// Verbatim from the geodatabase's own `net` coded-value domain — the dataset
// names its codes, so none of these is guessed.
const RAIL_NET_LABELS: Record<string, string> = {
  M: 'Main line',
  I: 'Major industrial lead',
  O: 'Minor industrial lead',
  S: 'Passing siding',
  Y: 'Yard track',
  F: 'Rail ferry connection',
  X: 'Out of service',
  A: 'Abandoned',
  R: 'Abandoned — track removed',
  T: 'Trail on former right-of-way',
  Z: 'Transit / tourist only',
}

export function railNetLabel(net: string | null | undefined): string | null {
  if (!net) return null
  const key = net.trim().toUpperCase()
  if (!key) return null
  return RAIL_NET_LABELS[key] ?? key
}

// The `passngr` domain, same source. Worth surfacing: a line carrying Amtrak
// or commuter service has windows in its freight capacity, which is a
// scheduling constraint on anything shipped over it.
const RAIL_PASSENGER_LABELS: Record<string, string> = {
  A: 'Amtrak',
  B: 'Amtrak & commuter',
  C: 'Commuter',
  D: 'Alaska Railroad passenger',
  E: 'Intercity HSR & commuter',
  I: 'Intercity HSR',
  O: 'Ontario Northland',
  R: 'Rapid transit',
  T: 'Tourist / museum',
  V: 'Via Rail Canada',
}

export function railPassengerLabel(code: string | null | undefined): string | null {
  if (!code) return null
  const key = code.trim().toUpperCase()
  if (!key) return null
  return RAIL_PASSENGER_LABELS[key] ?? key
}

/** The line's own name where NARN has one — subdivision first, then branch. */
export function railLineName(props: RailFeatureProps): string | null {
  const sub = props.subdiv?.trim()
  const branch = props.branch?.trim()
  if (sub && branch && sub !== branch) return `${sub} Sub · ${branch}`
  if (sub) return `${sub} Sub`
  return branch || null
}
