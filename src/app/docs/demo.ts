import type { EndpointDefinition, EndpointParam, ResponseField } from '~/composables/useDocsRegistry'

const CATEGORY = 'Demo'

const AUTH_PARAM: EndpointParam = {
  name: 'Authorization',
  in: 'header',
  type: 'string',
  description: 'Bearer token for authentication. Use the demo token to test this endpoint.',
  required: true,
  default: 'demo-token-pulse-trader-2026',
  example: 'demo-token-pulse-trader-2026',
  bearer: true,
}

const productResponseFields: ResponseField[] = [
  { name: 'id', type: 'string', description: 'Unique product identifier', required: true },
  { name: 'name', type: 'string', description: 'Product display name', required: true },
  { name: 'price', type: 'number', description: 'Product price in USD', required: true },
  { name: 'category', type: 'string', description: 'Product category', required: true },
  { name: 'description', type: 'string', description: 'Detailed product description', required: true },
  { name: 'inStock', type: 'boolean', description: 'Whether the product is currently in stock', required: true },
  { name: 'createdAt', type: 'string (ISO 8601)', description: 'Timestamp when the product was created', required: true },
  { name: 'updatedAt', type: 'string (ISO 8601)', description: 'Timestamp when the product was last updated', required: true },
]

const sampleProduct = {
  id: '1',
  name: 'Widget Pro',
  price: 29.99,
  category: 'Widgets',
  description: 'A professional-grade widget for everyday use.',
  inStock: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

export const demoEndpoints: EndpointDefinition[] = [
  // ─── List Products ───────────────────────────────────────────────────────────
  {
    slug: 'demo/products',
    title: 'List Products',
    description:
      'Returns a paginated list of demo products. Supports optional keyword search across product name, category, and description. Requires a valid bearer token in the Authorization header.',
    method: 'GET',
    path: '/api/demo/products',
    category: CATEGORY,
    params: [
      AUTH_PARAM,
      {
        name: 'page',
        in: 'query',
        type: 'integer',
        description: 'Page number to retrieve (1-based).',
        required: false,
        default: '1',
        example: '1',
      },
      {
        name: 'limit',
        in: 'query',
        type: 'integer',
        description: 'Number of items to return per page. Maximum is 100.',
        required: false,
        default: '10',
        example: '5',
      },
      {
        name: 'search',
        in: 'query',
        type: 'string',
        description: 'Case-insensitive keyword to filter products by name, category, or description.',
        required: false,
        example: 'widget',
      },
    ],
    responseDescription:
      'Returns a `data` array of product objects and a `meta` object containing pagination details.',
    responseFields: [
      {
        name: 'data',
        type: 'Product[]',
        description: 'Array of product objects matching the query',
        required: true,
        fields: productResponseFields,
      },
      {
        name: 'meta',
        type: 'object',
        description: 'Pagination metadata',
        required: true,
        fields: [
          { name: 'page', type: 'integer', description: 'Current page number', required: true },
          { name: 'limit', type: 'integer', description: 'Items per page', required: true },
          { name: 'total', type: 'integer', description: 'Total number of matching products', required: true },
          { name: 'totalPages', type: 'integer', description: 'Total number of pages', required: true },
        ],
      },
    ],
    sampleResponse: {
      data: [sampleProduct],
      meta: { page: 1, limit: 10, total: 5, totalPages: 1 },
    },
  },

  // ─── Create Product ──────────────────────────────────────────────────────────
  {
    slug: 'demo/products-create',
    title: 'Create Product',
    description:
      'Creates a new product and adds it to the in-memory demo store. The created product is returned in the response with a newly assigned ID. The store resets on server restart.',
    method: 'POST',
    path: '/api/demo/products',
    category: CATEGORY,
    params: [
      AUTH_PARAM,
      {
        name: 'name',
        in: 'body',
        type: 'string',
        description: 'Product display name. Required.',
        required: true,
        example: 'Super Gadget',
      },
      {
        name: 'price',
        in: 'body',
        type: 'number',
        description: 'Product price in USD. Required.',
        required: true,
        example: '59.99',
      },
      {
        name: 'category',
        in: 'body',
        type: 'string',
        description: 'Product category. Defaults to "Uncategorized" if omitted.',
        required: false,
        example: 'Gadgets',
      },
      {
        name: 'description',
        in: 'body',
        type: 'string',
        description: 'Optional product description.',
        required: false,
        example: 'A next-generation super gadget.',
      },
      {
        name: 'inStock',
        in: 'body',
        type: 'boolean',
        description: 'Whether the product is in stock. Defaults to true.',
        required: false,
        example: 'true',
      },
    ],
    responseDescription: 'Returns the newly created product object wrapped in a `data` key.',
    responseFields: [
      {
        name: 'data',
        type: 'object',
        description: 'The newly created product object',
        required: true,
        fields: productResponseFields,
      },
    ],
    sampleResponse: {
      data: {
        id: '6',
        name: 'Super Gadget',
        price: 59.99,
        category: 'Gadgets',
        description: 'A next-generation super gadget.',
        inStock: true,
        createdAt: '2026-03-08T12:00:00Z',
        updatedAt: '2026-03-08T12:00:00Z',
      },
    },
  },

  // ─── Get Product ─────────────────────────────────────────────────────────────
  {
    slug: 'demo/products-get',
    title: 'Get Product',
    description:
      'Retrieves a single product by its unique ID. Returns a 404 error if no product with the given ID exists in the demo store.',
    method: 'GET',
    path: '/api/demo/products/{id}',
    category: CATEGORY,
    params: [
      AUTH_PARAM,
      {
        name: 'id',
        in: 'path',
        type: 'string',
        description: 'The unique identifier of the product to retrieve.',
        required: true,
        example: '1',
      },
    ],
    responseDescription: 'Returns the matching product object wrapped in a `data` key.',
    responseFields: [
      {
        name: 'data',
        type: 'object',
        description: 'The matching product object',
        required: true,
        fields: productResponseFields,
      },
    ],
    sampleResponse: { data: sampleProduct },
  },

  // ─── Update Product ──────────────────────────────────────────────────────────
  {
    slug: 'demo/products-update',
    title: 'Update Product',
    description:
      'Performs a partial update on an existing product. Only fields provided in the request body will be changed; all other fields remain untouched. The `updatedAt` timestamp is automatically refreshed.',
    method: 'PATCH',
    path: '/api/demo/products/{id}',
    category: CATEGORY,
    params: [
      AUTH_PARAM,
      {
        name: 'id',
        in: 'path',
        type: 'string',
        description: 'The unique identifier of the product to update.',
        required: true,
        example: '1',
      },
      {
        name: 'name',
        in: 'body',
        type: 'string',
        description: 'New product name.',
        required: false,
        example: 'Widget Pro Max',
      },
      {
        name: 'price',
        in: 'body',
        type: 'number',
        description: 'Updated product price in USD.',
        required: false,
        example: '39.99',
      },
      {
        name: 'category',
        in: 'body',
        type: 'string',
        description: 'Updated product category.',
        required: false,
        example: 'Widgets',
      },
      {
        name: 'description',
        in: 'body',
        type: 'string',
        description: 'Updated product description.',
        required: false,
        example: 'An upgraded professional widget.',
      },
      {
        name: 'inStock',
        in: 'body',
        type: 'boolean',
        description: 'Updated stock status.',
        required: false,
        example: 'false',
      },
    ],
    responseDescription: 'Returns the updated product object wrapped in a `data` key.',
    responseFields: [
      {
        name: 'data',
        type: 'object',
        description: 'The updated product object',
        required: true,
        fields: productResponseFields,
      },
    ],
    sampleResponse: {
      data: {
        ...sampleProduct,
        name: 'Widget Pro Max',
        price: 39.99,
        updatedAt: '2026-03-08T12:30:00Z',
      },
    },
  },

  // ─── Delete Product ──────────────────────────────────────────────────────────
  {
    slug: 'demo/products-delete',
    title: 'Delete Product',
    description:
      'Permanently removes a product from the demo store by ID. Returns a success confirmation. The deletion is only in-memory and resets when the server restarts.',
    method: 'DELETE',
    path: '/api/demo/products/{id}',
    category: CATEGORY,
    params: [
      AUTH_PARAM,
      {
        name: 'id',
        in: 'path',
        type: 'string',
        description: 'The unique identifier of the product to delete.',
        required: true,
        example: '5',
      },
    ],
    responseDescription: 'Returns a success flag and a confirmation message.',
    responseFields: [
      { name: 'success', type: 'boolean', description: 'Always true on successful deletion', required: true },
      { name: 'message', type: 'string', description: 'Human-readable confirmation message', required: true },
    ],
    sampleResponse: {
      success: true,
      message: 'Product "5" has been deleted.',
    },
  },
]
