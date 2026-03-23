# Pulse Trader API Documentation System

This document explains how the interactive API documentation at `/docs` works and how to add new endpoints to it.

---

## Overview

The docs system is **registry-driven**: all endpoint documentation lives in a single source-of-truth file. Adding one entry to the registry automatically generates:

- A sidebar navigation link (grouped by category)
- An overview card on the `/docs` landing page
- A full detail page at `/docs/<slug>` with parameters, response attributes, and an interactive API tester

No routing config, no new page files, no manual wiring needed.

---

## Architecture

```
src/app/
├── docs/
│   ├── index.ts                    ← Aggregates all category files (register new categories here)
│   ├── general.ts                  ← General category endpoints
│   └── [category].ts              ← One file per category
├── composables/
│   └── useDocsRegistry.ts          ← Types, interfaces & composable logic
├── components/docs/
│   ├── DocsSidebar.vue             ← Auto-generated sidebar from registry
│   ├── DocsMethodBadge.vue         ← Color-coded HTTP method badge
│   └── DocsApiTester.vue           ← Interactive request / response panel
├── layouts/
│   └── docs.vue                    ← Full-screen docs shell (header + sidebar)
├── pages/docs/
│   ├── index.vue                   ← /docs overview page
│   └── [...slug].vue               ← Dynamic catch-all — renders any endpoint
└── assets/styles/
    └── docs.css                    ← All docs-specific styles
```

---

## Adding a New Endpoint

Open the relevant category file in `src/app/docs/` and append an entry to the exported array.

For example, to add an endpoint to the General category, edit `src/app/docs/general.ts`.

> The types (`EndpointDefinition`, `EndpointParam`, `ResponseField`) are defined in `useDocsRegistry.ts` and imported automatically — you do not need to touch that file.

## Adding a New Category

1. Create `src/app/docs/<category>.ts` exporting a named array — e.g. `usersEndpoints`
2. Open `src/app/docs/index.ts` and spread it into `endpoints`:

```ts
import { usersEndpoints } from './users'

export const endpoints: EndpointDefinition[] = [
  ...generalEndpoints,
  ...usersEndpoints, // ← add here
]
```

The sidebar, overview cards, and detail pages are all generated automatically.

### Minimal example

```ts
{
  slug: 'general/ping',
  title: 'Ping',
  description: 'Health-check endpoint. Returns a simple pong response.',
  method: 'GET',
  path: '/api/ping',
  category: 'General',
}
```

This alone will create the sidebar link and overview card. The detail page will render with no parameters or response fields.

### Full example

```ts
{
  slug: 'users/get-user',           // URL path under /docs — use category/kebab-name
  title: 'Get User',               // Display title (sidebar + page heading)
  description: 'Fetches a single user record by their unique ID.',
  method: 'GET',                   // 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  path: '/api/users/:id',          // Actual API path (shown in the URL bar)
  category: 'Users',               // Groups endpoints in the sidebar

  // ── Parameters (optional) ─────────────────────────────────
  params: [
    {
      name: 'id',
      in: 'path',                  // 'query' | 'path' | 'header' | 'body'
      type: 'string',
      description: 'The unique identifier of the user.',
      required: true,
      example: 'usr_abc123',
    },
    {
      name: 'include',
      in: 'query',
      type: 'string',
      description: 'Comma-separated list of relations to include (e.g. "profile,roles").',
      required: false,
      default: 'none',
    },
  ],

  // ── Response documentation (optional) ─────────────────────
  responseDescription: 'Returns the user object matching the provided ID.',
  responseFields: [
    { name: 'id',       type: 'string',  description: 'Unique user identifier.',         required: true },
    { name: 'email',    type: 'string',  description: 'The user\'s email address.',       required: true },
    { name: 'name',     type: 'string',  description: 'Display name.',                   required: false },
    { name: 'createdAt',type: 'string',  description: 'ISO 8601 creation timestamp.',    required: false },
  ],

  // ── Sample response (shown in the "Sample Response" tab) ──
  sampleResponse: {
    id: 'usr_abc123',
    email: 'alice@example.com',
    name: 'Alice',
    createdAt: '2026-01-15T08:30:00Z',
  },
}
```

---

## Type Reference

### `EndpointDefinition`

| Field                | Type                                          | Required | Description                                                   |
|----------------------|-----------------------------------------------|----------|---------------------------------------------------------------|
| `slug`               | `string`                                      | ✅        | URL path under `/docs/` (e.g. `users/get-user`)              |
| `title`              | `string`                                      | ✅        | Display title shown in the sidebar and page heading           |
| `description`        | `string`                                      | ✅        | Human-readable description of what the endpoint does          |
| `method`             | `'GET' \| 'POST' \| 'PUT' \| 'DELETE' \| 'PATCH'` | ✅   | HTTP method — controls the color of the method badge         |
| `path`               | `string`                                      | ✅        | Actual API path (e.g. `/api/users/:id`)                       |
| `category`           | `string`                                      | ✅        | Sidebar group name — new categories are created automatically |
| `params`             | `EndpointParam[]`                             | —        | List of parameters (query, path, header, or body)             |
| `responseDescription`| `string`                                      | —        | Narrative description of the response object                  |
| `responseFields`     | `ResponseField[]`                             | —        | Individual response fields shown in the Response Attributes section |
| `sampleResponse`     | `Record<string, unknown>`                     | —        | Static JSON shown in the "Sample Response" tab                |

### `EndpointParam`

| Field         | Type                                        | Required | Description                                |
|---------------|---------------------------------------------|----------|--------------------------------------------|
| `name`        | `string`                                    | ✅        | Parameter name                             |
| `in`          | `'query' \| 'path' \| 'header' \| 'body'`  | ✅        | Where the parameter is sent                |
| `type`        | `string`                                    | ✅        | Data type (e.g. `string`, `number`, `boolean`) |
| `description` | `string`                                    | ✅        | What the parameter controls                |
| `required`    | `boolean`                                   | ✅        | Whether the parameter is mandatory         |
| `default`     | `string`                                    | —        | Default value if omitted                   |
| `example`     | `string`                                    | —        | Example value shown in the tester input    |

### `ResponseField`

| Field         | Type      | Required | Description                                     |
|---------------|-----------|----------|-------------------------------------------------|
| `name`        | `string`  | ✅        | Field name in the response object               |
| `type`        | `string`  | ✅        | Data type (e.g. `string`, `number`, `object`)   |
| `description` | `string`  | ✅        | What the field contains                         |
| `required`    | `boolean` | —        | Whether the field is always present in the response |

---

## Slug Naming Convention

The `slug` becomes the URL: `/docs/<slug>`. Use lowercase kebab-case, prefixed with the category in lowercase:

| Category  | Endpoint title | Slug                  |
|-----------|----------------|-----------------------|
| General   | Version        | `general/version`     |
| Users     | Get User       | `users/get-user`      |
| Users     | List Users     | `users/list-users`    |
| Products  | Create Product | `products/create-product` |

---

## Category Grouping

Categories are derived automatically from the `category` field. Endpoints sharing the same `category` string are grouped together in the sidebar. Categories appear in the order their first endpoint is defined in the array.

---

## Interactive API Tester

The right-side panel (`DocsApiTester.vue`) is wired automatically for every endpoint. It:

1. Builds the request URL from `path` + any query params the user fills in
2. Shows the `curl` command equivalent in real time
3. Sends the actual HTTP request from the browser on **Run Query**
4. Displays the live JSON response in the **Query Response** tab
5. Always shows the `sampleResponse` in the **Sample Response** tab

Path parameters (`:id`, `:slug`, etc.) appear as editable text inputs and are substituted into the URL before the request is sent.
