import type { EndpointDefinition } from '~/composables/useDocsRegistry'

const CATEGORY = 'General'

export const generalEndpoints: EndpointDefinition[] = [
  {
    slug: 'general/version',
    title: 'Version',
    description:
      'Returns the current application name and version number. Use this endpoint to verify API connectivity and check which version of the service is running.',
    method: 'GET',
    path: '/api/version',
    category: CATEGORY,
    responseDescription:
      'Returns an object containing the application identifier and its semantic version.',
    responseFields: [
      { name: 'name', type: 'string', description: 'The application identifier' },
      { name: 'version', type: 'string', description: 'The current semantic version (e.g. "0.1.0")' },
    ],
    sampleResponse: {
      name: 'pulse-trader',
      version: '0.1.0',
    },
  },
]
