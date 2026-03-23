export interface EndpointParam {
  name: string
  in: 'query' | 'path' | 'header' | 'body'
  type: string
  description: string
  required: boolean
  default?: string
  example?: string
  /** If true, the tester will prepend "Bearer " to this header value automatically */
  bearer?: boolean
  /** Nested child params for complex object types */
  fields?: EndpointParam[]
}

export interface ResponseField {
  name: string
  type: string
  description: string
  required?: boolean
  /** Nested child fields for complex object / array-of-object types */
  fields?: ResponseField[]
}

export interface EndpointDefinition {
  slug: string
  title: string
  description: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  path: string
  category: string
  params?: EndpointParam[]
  responseDescription?: string
  responseFields?: ResponseField[]
  sampleResponse?: Record<string, unknown>
}

export interface DocsCategory {
  name: string
  endpoints: EndpointDefinition[]
}

import { endpoints } from '~/docs/index'

// ─── Composable ──────────────────────────────────────────────

export function useDocsRegistry() {
  const getEndpoints = () => endpoints

  const getEndpoint = (slug: string) =>
    endpoints.find((e) => e.slug === slug)

  const getCategories = (): DocsCategory[] => {
    const map = new Map<string, EndpointDefinition[]>()
    for (const ep of endpoints) {
      if (!map.has(ep.category)) map.set(ep.category, [])
      map.get(ep.category)!.push(ep)
    }
    return Array.from(map.entries()).map(([name, eps]) => ({
      name,
      endpoints: eps,
    }))
  }

  return { getEndpoints, getEndpoint, getCategories }
}
