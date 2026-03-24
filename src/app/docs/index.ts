import type { EndpointDefinition } from '~/composables/useDocsRegistry'
import { generalEndpoints } from './general'
import { demoEndpoints } from './demo'
import { settingsEndpoints } from './settings'

// ─── Endpoint Registry ───────────────────────────────────────
// To add a new category:
//   1. Create a new file (e.g. users.ts) exporting a named array
//   2. Import it below and spread it into `endpoints`
// ─────────────────────────────────────────────────────────────

export const endpoints: EndpointDefinition[] = [
  ...generalEndpoints,
  ...settingsEndpoints,
  ...demoEndpoints,
]
