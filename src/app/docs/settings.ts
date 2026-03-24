import type { EndpointDefinition } from '~/composables/useDocsRegistry'

const CATEGORY = 'Settings'

export const settingsEndpoints: EndpointDefinition[] = [
  {
    slug: 'settings/get-settings',
    title: 'Get Settings',
    description:
      'Returns all application settings as a key/value map. Sensitive fields (API keys, secrets) are masked in the response — only the first and last characters are shown. JSON settings such as broker details are decrypted internally and then masked before being returned.',
    method: 'GET',
    path: '/api/settings',
    category: CATEGORY,
    responseDescription:
      'Returns a `data` object whose keys are the setting names. Null means the setting has not been saved yet. When migrations have not been run, a `migrationRequired: true` flag is included and all values are null.',
    responseFields: [
      { name: 'success', type: 'boolean', description: 'Whether the request succeeded', required: true },
      {
        name: 'data',
        type: 'object',
        description: 'Map of every known setting key to its current value (or null)',
        required: true,
        fields: [
          { name: 'local-currency',         type: 'string',  description: 'ISO 4217 currency code used for P&L display (e.g. "USD")',             required: false },
          { name: 'default-position-size',  type: 'number',  description: 'Default number of shares / contracts per trade',                      required: false },
          { name: 'risk-per-trade',         type: 'number',  description: 'Maximum percentage of account equity to risk on a single trade',       required: false },
          { name: 'confirm-trades',         type: 'boolean', description: 'Whether the UI should prompt for confirmation before placing an order', required: false },
          { name: 'active-data-broker',     type: 'string',  description: 'Identifier of the currently active market-data provider',             required: false },
          {
            name: 'data-broker-details',
            type: 'object',
            description: 'Connection details for the data broker (sensitive fields masked)',
            required: false,
            fields: [
              { name: 'apiKey',  type: 'string', description: 'API key for the data broker (masked)',        required: false },
              { name: 'apiUrl',  type: 'string', description: 'Base URL of the data broker REST API',        required: false },
              { name: 'wsUrl',   type: 'string', description: 'WebSocket URL for the data broker stream',    required: false },
            ],
          },
          { name: 'active-trading-broker',  type: 'string',  description: 'Identifier of the currently active order-execution broker',           required: false },
          {
            name: 'trading-broker-details',
            type: 'object',
            description: 'Connection details for the trading broker (sensitive fields masked)',
            required: false,
            fields: [
              { name: 'apiUrl',           type: 'string', description: 'Base URL of the trading broker REST API',                    required: false },
              { name: 'liveAccount',      type: 'string', description: 'Live trading account identifier',                            required: false },
              { name: 'liveApiKeyId',     type: 'string', description: 'API key ID for the live account (masked)',                   required: false },
              { name: 'liveApiKeySecret', type: 'string', description: 'API key secret for the live account (masked)',               required: false },
              { name: 'paperAccount',     type: 'string', description: 'Paper trading account identifier',                           required: false },
              { name: 'paperApiKeyId',    type: 'string', description: 'API key ID for the paper account (masked)',                  required: false },
              { name: 'paperApiKeySecret',type: 'string', description: 'API key secret for the paper account (masked)',              required: false },
            ],
          },
        ],
      },
      { name: 'migrationRequired', type: 'boolean', description: 'Present and true when the settings table does not yet exist in the DB', required: false },
    ],
    sampleResponse: {
      success: true,
      data: {
        'local-currency': 'USD',
        'default-position-size': '100',
        'risk-per-trade': '1',
        'confirm-trades': 'true',
        'active-data-broker': 'example-data-broker',
        'data-broker-details': {
          apiKey: 'abcd●●●●ef01',
          apiUrl: 'https://api.example-broker.com',
          wsUrl: 'wss://stream.example-broker.com',
        },
        'active-trading-broker': 'example-trading-broker',
        'trading-broker-details': {
          apiUrl: 'https://trading.example-broker.com/',
          liveAccount: 'LIVE123',
          liveApiKeyId: '1111●●●●2222',
          liveApiKeySecret: 'aaaa●●●●bbbb',
          paperAccount: 'PAPER456',
          paperApiKeyId: '3333●●●●4444',
          paperApiKeySecret: 'cccc●●●●dddd',
        },
      },
    },
  },

  {
    slug: 'settings/update-settings',
    title: 'Update Settings',
    description:
      'Saves one or more settings in a single request. Send a JSON body whose keys are setting names and values are their new values. Unknown keys are rejected and returned in a `rejected` array — no error is thrown. JSON settings (broker details) are merged with any existing values, so you can update individual sub-fields without overwriting the entire object. Sensitive JSON sub-fields (API keys, secrets) are encrypted at rest.',
    method: 'POST',
    path: '/api/settings',
    category: CATEGORY,
    params: [
      {
        name: 'local-currency',
        in: 'body',
        type: 'string',
        description: 'ISO 4217 currency code for P&L display (e.g. "USD", "EUR")',
        required: false,
        example: 'USD',
      },
      {
        name: 'default-position-size',
        in: 'body',
        type: 'number',
        description: 'Default number of shares / contracts to use when placing an order',
        required: false,
        example: '100',
      },
      {
        name: 'risk-per-trade',
        in: 'body',
        type: 'number',
        description: 'Maximum percentage of account equity to risk on a single trade',
        required: false,
        example: '1',
      },
      {
        name: 'confirm-trades',
        in: 'body',
        type: 'boolean',
        description: 'When true the UI will prompt for confirmation before placing an order',
        required: false,
        example: 'true',
      },
      {
        name: 'active-data-broker',
        in: 'body',
        type: 'string',
        description: 'Identifier of the market-data provider to activate',
        required: false,
        example: 'tradovate',
      },
      {
        name: 'data-broker-details',
        in: 'body',
        type: 'object',
        description: 'Connection details for the data broker. Merged with the existing object — only supplied sub-fields are updated. Sensitive values are encrypted at rest.',
        required: false,
        fields: [
          { name: 'apiKey',  in: 'body', type: 'string', description: 'API key for the data broker', required: false, example: 'sk_live_...' },
          { name: 'apiUrl',  in: 'body', type: 'string', description: 'Base URL of the data broker REST API', required: false, example: 'https://api.massive.com' },
          { name: 'wsUrl',   in: 'body', type: 'string', description: 'WebSocket URL for real-time data streaming', required: false, example: 'wss://socket.massive.com' },
        ],
      },
      {
        name: 'active-trading-broker',
        in: 'body',
        type: 'string',
        description: 'Identifier of the order-execution broker to activate',
        required: false,
        example: 'tradovate',
      },
      {
        name: 'trading-broker-details',
        in: 'body',
        type: 'object',
        description: 'Connection details for the trading broker. Merged with the existing object — only supplied sub-fields are updated. Sensitive values are encrypted at rest.',
        required: false,
        fields: [
          { name: 'apiUrl',            in: 'body', type: 'string', description: 'Base URL of the trading broker REST API', required: false, example: 'https://webapi.tradezero.com/' },
          { name: 'liveAccount',       in: 'body', type: 'string', description: 'Live trading account identifier', required: false, example: 'GKN92910' },
          { name: 'liveApiKeyId',      in: 'body', type: 'string', description: 'API key ID for the live account', required: false, example: 'key_id_...' },
          { name: 'liveApiKeySecret',  in: 'body', type: 'string', description: 'API key secret for the live account', required: false, example: 'key_secret_...' },
          { name: 'paperAccount',      in: 'body', type: 'string', description: 'Paper trading account identifier', required: false, example: 'TZPA7A7F' },
          { name: 'paperApiKeyId',     in: 'body', type: 'string', description: 'API key ID for the paper account', required: false, example: 'key_id_...' },
          { name: 'paperApiKeySecret', in: 'body', type: 'string', description: 'API key secret for the paper account', required: false, example: 'key_secret_...' },
        ],
      },
    ],
    responseDescription:
      'Returns the list of keys that were successfully saved and, if any unknown keys were supplied, a `rejected` array listing them.',
    responseFields: [
      { name: 'success',  type: 'boolean',  description: 'Whether the request was processed',                            required: true },
      { name: 'saved',    type: 'string[]', description: 'Keys that were accepted and persisted',                         required: true },
      { name: 'rejected', type: 'string[]', description: 'Keys that were not recognised and therefore not saved',         required: false },
    ],
    sampleResponse: {
      success: true,
      saved: ['local-currency', 'risk-per-trade'],
      rejected: ['unknown-key'],
    },
  },
]
