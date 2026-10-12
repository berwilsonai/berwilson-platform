/** Dry run of the internal-thread auto-task pass. Writes nothing. */
import { promoteInternalCommitments } from '@/lib/commitments/internal-tasks'
console.log(await promoteInternalCommitments({ dryRun: true }))
