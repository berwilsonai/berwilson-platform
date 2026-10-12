/** Run the internal-thread promotion for real. Idempotent — safe to re-run. */
import { promoteInternalCommitments } from '@/lib/commitments/internal-tasks'
console.log(await promoteInternalCommitments())
