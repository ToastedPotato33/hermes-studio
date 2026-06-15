#!/usr/bin/env node
/**
 * Auto-generate OpenAPI specification from existing Koa routes and controllers
 *
 * This script scans both route files and controller files to generate comprehensive
 * OpenAPI documentation without requiring code changes or decorators.
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs'
import { resolve, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const rootDir = resolve(__dirname, '..')
const routesDir = join(rootDir, 'packages/server/src/routes')
const controllersDir = join(rootDir, 'packages/server/src/controllers')
const packageJson = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'))

// OpenAPI template
const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'Hermes Studio API',
    description: 'Hermes Studio API — chat sessions, scheduled jobs, platform channels, model management, skills, memory, logs, file browser, group chat, and terminal.',
    version: packageJson.version,
  },
  servers: [
    { url: 'http://localhost:8648', description: 'Local development' },
  ],
  tags: [],
  paths: {},
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'API Token',
      },
    },
    schemas: {},
    responses: {},
  },
}

// Tag mappings based on route directories
const tagMappings = {
  'routes/hermes/sessions.ts': { name: 'Sessions', description: 'Chat session management' },
  'routes/hermes/profiles.ts': { name: 'Profiles', description: 'Hermes profile management' },
  'routes/hermes/gateways.ts': { name: 'Gateways', description: 'Gateway process management' },
  'routes/hermes/models.ts': { name: 'Models', description: 'Model configuration' },
  'routes/hermes/providers.ts': { name: 'Providers', description: 'Model provider management' },
  'routes/hermes/skills.ts': { name: 'Skills', description: 'Skill browsing and management' },
  'routes/hermes/memory.ts': { name: 'Memory', description: 'Agent memory files' },
  'routes/hermes/logs.ts': { name: 'Logs', description: 'Log file access' },
  'routes/hermes/jobs.ts': { name: 'Jobs', description: 'Scheduled job management' },
  'routes/hermes/cron-history.ts': { name: 'Jobs', description: 'Cron job history' },
  'routes/hermes/weixin.ts': { name: 'Weixin', description: 'WeChat QR code login' },
  'routes/hermes/codex-auth.ts': { name: 'Codex Auth', description: 'OpenAI Codex OAuth' },
  'routes/hermes/nous-auth.ts': { name: 'Nous Auth', description: 'Nous Research OAuth' },
  'routes/hermes/copilot-auth.ts': { name: 'Copilot Auth', description: 'GitHub Copilot OAuth' },
  'routes/hermes/group-chat.ts': { name: 'Group Chat', description: 'Group chat management' },
  'routes/hermes/chat-run.ts': { name: 'Chat Run', description: 'Chat run HTTP and Socket.IO bridge operations' },
  'routes/hermes/config.ts': { name: 'Config', description: 'Configuration management' },
  'routes/hermes/files.ts': { name: 'Files', description: 'Hermes file browser' },
  'routes/hermes/download.ts': { name: 'Download', description: 'File download' },
  'routes/hermes/terminal.ts': { name: 'Terminal', description: 'WebSocket terminal' },
  'routes/hermes/proxy.ts': { name: 'Proxy', description: 'Gateway proxy' },
  'routes/health.ts': { name: 'Health', description: 'Health check' },
  'routes/update.ts': { name: 'Update', description: 'Self-update management' },
  'routes/upload.ts': { name: 'Upload', description: 'File upload' },
  'routes/webhook.ts': { name: 'Webhook', description: 'Incoming webhooks' },
  'routes/auth.ts': { name: 'Auth', description: 'Authentication management' },
  'routes/api-docs.ts': { name: 'API Docs', description: 'OpenAPI route catalog' },
}

// Extract route definitions from route files
function scanRoutes() {
  const paths = {}

  // Scan hermes routes
  const hermesRoutesDir = join(routesDir, 'hermes')
  const hermesRouteFiles = readdirSync(hermesRoutesDir).filter(f => f.endsWith('.ts'))

  for (const file of hermesRouteFiles) {
    const routePath = join('hermes', file)
    const tagInfo = tagMappings[`routes/${routePath}`]
    if (tagInfo) {
      scanRouteFile(join(hermesRoutesDir, file), tagInfo, paths)
    }
  }

  // Scan top-level routes
  for (const [routeFile, tagInfo] of Object.entries(tagMappings)) {
    if (!routeFile.startsWith('routes/hermes/')) {
      const filePath = join(routesDir, routeFile.replace('routes/', ''))
      try {
        scanRouteFile(filePath, tagInfo, paths)
      } catch (e) {
        // File might not exist, skip
      }
    }
  }

  return paths
}

function scanRouteFile(filePath, tagInfo, paths) {
  const content = readFileSync(filePath, 'utf-8')

  // Pattern 1: controller functions - sessionRoutes.get('/path', ctrl.method)
  const ctrlRouteRegex = /\w+Routes?\.(get|post|put|delete|patch)\(['"]([^'"]+)['"],\s*ctrl\.(\w+)/g

  let match
  while ((match = ctrlRouteRegex.exec(content)) !== null) {
    const [, method, path, controllerMethod] = match
    addEndpoint(paths, method, path, controllerMethod, tagInfo, content, match.index)
  }

  // Pattern 2: inline functions - groupChatRoutes.post('/path', async (ctx) => {...})
  const inlineRouteRegex = /\w+Routes?\.(get|post|put|delete|patch)\(['"]([^'"]+)['"],\s*async\s*\(ctx\)/g

  while ((match = inlineRouteRegex.exec(content)) !== null) {
    const [, method, path] = match
    const controllerMethod = generateOperationIdFromPath(path, method)
    addEndpoint(paths, method, path, controllerMethod, tagInfo, content, match.index)
  }
}

function addEndpoint(paths, method, path, controllerMethod, tagInfo, content, matchIndex) {
  // Clean path parameters
  const openapiPath = path
    .replace(/:([^/]+)/g, '{$1}')
    .replace(/\*\*([^/]*)/g, '{$1}')

  if (!paths[openapiPath]) {
    paths[openapiPath] = {}
  }

  // Generate operation ID
  const operationId = `${controllerMethod}`

  // Generate description from JSDoc comments above the route
  const precedingContent = content.substring(Math.max(0, matchIndex - 500), matchIndex)
  const description = extractJsDocDescription(precedingContent) || `${method.toUpperCase()} ${path}`

  paths[openapiPath][method] = {
    tags: [tagInfo.name],
    summary: generateSummary(path, method, controllerMethod),
    description,
    operationId,
    security: [{ BearerAuth: [] }],
    responses: generateResponses(path, method),
  }
}

function generateOperationIdFromPath(path, method) {
  const parts = path.split('/').filter(Boolean)
  const lastPart = parts[parts.length - 1]

  if (lastPart && !lastPart.includes(':') && !lastPart.includes('*')) {
    const actionMap = {
      get: 'get',
      post: 'create',
      put: 'update',
      patch: 'patch',
      delete: 'delete',
    }
    return `${actionMap[method]}${lastPart.charAt(0).toUpperCase() + lastPart.slice(1)}`
  }

  const parentPart = parts[parts.length - 2]
  if (parentPart) {
    return `${method}${parentPart.charAt(0).toUpperCase() + parentPart.slice(1)}`
  }

  return method
}

function extractJsDocDescription(content) {
  const jsDocRegex = /\/\*\*[\s\S]*?\*\//
  const match = content.match(jsDocRegex)
  if (match) {
    const jsDoc = match[0]
    // Extract description text
    const description = jsDoc
      .replace(/\/\*\*|\*\//g, '')
      .split('\n')
      .map(line => line.replace(/^\s*\*\s?/, '').trim())
      .filter(line => line && !line.startsWith('@'))
      .join('\n')
    return description || null
  }
  return null
}

function generateSummary(path, method, controllerMethod) {
  const parts = path.split('/').filter(Boolean)
  const resource = parts[parts.length - 1] || 'root'

  // Use controller method name to generate better summary
  const methodMap = {
    list: 'List',
    get: 'Get',
    create: 'Create',
    update: 'Update',
    remove: 'Delete',
    delete: 'Delete',
    rename: 'Rename',
    pause: 'Pause',
    resume: 'Resume',
    run: 'Run',
    search: 'Search',
    add: 'Add',
  }

  const action = methodMap[controllerMethod] || {
    get: 'Get',
    post: 'Create',
    put: 'Update',
    patch: 'Update',
    delete: 'Delete',
  }[method]

  if (resource.includes('{')) {
    const paramName = resource.match(/\{([^}]+)\}/)?.[1] || 'id'
    const parentResource = parts[parts.length - 2] || 'resource'
    return `${action} ${parentResource} by ${paramName}`
  }

  return `${action} ${resource}`
}

function generateResponses(path, method) {
  const responses = {
    '200': {
      description: 'Success',
    },
    '401': {
      $ref: '#/components/responses/Unauthorized',
    },
  }

  if (method === 'get' && path.includes('/')) {
    responses['404'] = { description: 'Not found' }
  }

  if (method === 'post' || method === 'put' || method === 'patch') {
    responses['400'] = { $ref: '#/components/responses/BadRequest' }
  }

  return responses
}

// Add standard responses
openapi.components.responses = {
  Unauthorized: {
    description: 'Unauthorized - Invalid or missing authentication token',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Unauthorized' },
          },
        },
      },
    },
  },
  BadRequest: {
    description: 'Bad Request - Invalid parameters',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Invalid request' },
          },
        },
      },
    },
  },
  NotFound: {
    description: 'Resource not found',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Not found' },
          },
        },
      },
    },
  },
}

// Add proxy endpoints that forward to upstream Hermes API
openapi.paths['/api/hermes/{*any}'] = {
  'get': {
    tags: ['Proxy'],
    summary: 'Proxy to upstream Hermes API',
    description: 'Forwards unmatched /api/hermes/* requests to upstream Hermes gateway. Supports all upstream endpoints.',
    operationId: 'proxyHermes',
    responses: {
      '200': { description: 'Proxied response from upstream' },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '502': { description: 'Proxy failure' },
    },
  },
  'post': {
    tags: ['Proxy'],
    summary: 'Proxy to upstream Hermes API',
    description: 'Forwards unmatched /api/hermes/* requests to upstream Hermes gateway. Supports all upstream endpoints.',
    operationId: 'proxyHermesPost',
    responses: {
      '200': { description: 'Proxied response from upstream' },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '502': { description: 'Proxy failure' },
    },
  },
  'put': {
    tags: ['Proxy'],
    summary: 'Proxy to upstream Hermes API',
    description: 'Forwards unmatched /api/hermes/* requests to upstream Hermes gateway. Supports all upstream endpoints.',
    operationId: 'proxyHermesPut',
    responses: {
      '200': { description: 'Proxied response from upstream' },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '502': { description: 'Proxy failure' },
    },
  },
  'delete': {
    tags: ['Proxy'],
    summary: 'Proxy to upstream Hermes API',
    description: 'Forwards unmatched /api/hermes/* requests to upstream Hermes gateway. Supports all upstream endpoints.',
    operationId: 'proxyHermesDelete',
    responses: {
      '200': { description: 'Proxied response from upstream' },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '502': { description: 'Proxy failure' },
    },
  },
}

// Add Proxy tag
if (!openapi.tags.find(t => t.name === 'Proxy')) {
  openapi.tags.push({ name: 'Proxy', description: 'Gateway proxy to upstream Hermes API' })
}

// Add WebSocket terminal endpoint
openapi.paths['/api/hermes/terminal'] = {
  'get': {
    tags: ['Terminal'],
    summary: 'WebSocket terminal connection',
    description: 'Establish a WebSocket connection for interactive terminal access. Uses the `ws` or `wss` protocol with `?token=` for authentication.',
    operationId: 'terminalWebSocket',
    responses: {
      '101': { description: 'Switching Protocols - WebSocket connection established' },
      '401': { $ref: '#/components/responses/Unauthorized' },
    },
  },
}

// Add Chat streaming endpoint
openapi.paths['/api/hermes/v1/runs/{runId}/events'] = {
  'get': {
    tags: ['Chat'],
    summary: 'Server-Sent Events for chat streaming',
    description: 'Stream chat events using Server-Sent Events (SSE). Authentication via `?token=` query parameter.',
    operationId: 'chatStreamEvents',
    parameters: [
      {
        name: 'runId',
        in: 'path',
        required: true,
        description: 'Chat run ID',
        schema: { type: 'string' },
      },
      {
        name: 'token',
        in: 'query',
        required: true,
        description: 'Authentication token',
        schema: { type: 'string' },
      },
    ],
    responses: {
      '200': {
        description: 'SSE stream established',
        content: {
          'text/event-stream': {
            schema: {
              type: 'object',
              properties: {
                event: { type: 'string', enum: ['run.created', 'run.queued', 'run.started', 'run.streaming', 'run.completed', 'run.failed'] },
                data: { type: 'object' },
              },
            },
          },
        },
      },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '404': { description: 'Run not found' },
    },
  },
}

// Add Terminal tag
if (!openapi.tags.find(t => t.name === 'Terminal')) {
  openapi.tags.push({ name: 'Terminal', description: 'WebSocket terminal access' })
}

// Run scanner
console.log('Scanning routes...')
openapi.paths = scanRoutes()

// Collect all tags
const tagSet = new Set()
Object.values(openapi.paths).forEach(pathItem => {
  Object.values(pathItem).forEach(operation => {
    operation.tags?.forEach(tag => tagSet.add(tag))
  })
})

openapi.tags = Array.from(tagSet).map(tag => {
  const tagInfo = Object.values(tagMappings).find(t => t.name === tag)
  return {
    name: tag,
    description: tagInfo?.description || '',
  }
})

// Sort paths
const sortedPaths = {}
Object.keys(openapi.paths).sort().forEach(key => {
  sortedPaths[key] = openapi.paths[key]
})
openapi.paths = sortedPaths

// Add special endpoints after sorting
// Add non-streaming Chat Run HTTP wrapper endpoint
openapi.paths['/api/chat-run/runs'] = {
  post: {
    tags: ['Chat Run'],
    summary: 'Run chat and wait for completion',
    description: 'Starts a Hermes Studio chat run through the chat-run transport and waits for a terminal result. Use this from HTTP/MCP callers that cannot consume Socket.IO streams.',
    operationId: 'runChatOnce',
    security: [{ BearerAuth: [] }],
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['input'],
            properties: {
              input: {
                oneOf: [
                  { type: 'string' },
                  {
                    type: 'array',
                    items: {
                      type: 'object',
                      additionalProperties: true,
                    },
                  },
                ],
                description: 'User message text or content blocks.',
              },
              session_id: {
                type: 'string',
                description: 'Optional session id. Required for CLI/coding-agent style runs and recommended for all chat runs.',
              },
              profile: {
                type: 'string',
                description: 'Hermes Studio profile name. Defaults to the authenticated request profile or default.',
              },
              provider: {
                type: 'string',
                description: 'Model provider key to use for this run, for example openai, anthropic, deepseek, or a configured custom provider key.',
              },
              model: {
                type: 'string',
                description: 'Model id to use for this run, for example gpt-5.1 or deepseek-v4-pro.',
              },
              model_groups: {
                type: 'array',
                description: 'Optional provider/model fallback groups.',
                items: {
                  type: 'object',
                  required: ['provider', 'models'],
                  properties: {
                    provider: { type: 'string' },
                    models: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
              source: {
                type: 'string',
                enum: ['api_server', 'cli', 'coding_agent', 'global_agent'],
                description: 'Run backend source. Use cli for Hermes bridge runs, coding_agent for Claude Code/Codex, api_server for direct API-server runs, or global_agent for global-agent sessions.',
              },
              session_source: {
                type: 'string',
                enum: ['global_agent'],
                description: 'Marks a coding-agent or bridge session as launched from the global agent.',
              },
              instructions: {
                type: 'string',
                description: 'Optional extra run instructions appended after the system prompt.',
              },
              workspace: {
                type: 'string',
                nullable: true,
                description: 'Optional current working directory for the run.',
              },
              reasoning_effort: {
                type: 'string',
                description: 'Optional per-run reasoning effort override.',
              },
              coding_agent_id: {
                type: 'string',
                enum: ['claude-code', 'codex'],
                description: 'Coding agent id when source is coding_agent.',
              },
              agent_id: {
                type: 'string',
                enum: ['claude-code', 'codex'],
                description: 'Alias for coding_agent_id.',
              },
              mode: {
                type: 'string',
                enum: ['scoped', 'global'],
                description: 'Coding-agent launch mode.',
              },
              baseUrl: {
                type: 'string',
                description: 'Optional provider base URL for coding-agent runs.',
              },
              apiKey: {
                type: 'string',
                description: 'Optional provider API key for coding-agent runs.',
              },
              apiMode: {
                type: 'string',
                enum: ['chat_completions', 'codex_responses', 'anthropic_messages'],
                description: 'Optional provider wire API mode for coding-agent runs.',
              },
              timeout_ms: {
                type: 'integer',
                minimum: 1,
                maximum: 1800000,
                default: 300000,
                description: 'Maximum time to wait for run.completed or run.failed.',
              },
              include_events: {
                type: 'boolean',
                default: false,
                description: 'Include recorded run events in the HTTP response.',
              },
            },
            additionalProperties: true,
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Run completed',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                ok: { type: 'boolean', example: true },
                status: { type: 'string', example: 'completed' },
                session_id: { type: 'string' },
                run_id: { type: 'string' },
                output: { type: 'string' },
                reasoning: { type: 'string' },
                events: { type: 'array', items: { type: 'object', additionalProperties: true } },
              },
            },
          },
        },
      },
      '400': { $ref: '#/components/responses/BadRequest' },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '409': { description: 'Run requires approval or clarification' },
      '500': { description: 'Run failed' },
      '504': { description: 'Run timed out' },
    },
  },
}

// Add proxy endpoints that forward to upstream Hermes API
openapi.paths['/api/hermes/{*any}'] = {
  'get': {
    tags: ['Proxy'],
    summary: 'Proxy to upstream Hermes API',
    description: 'Forwards unmatched /api/hermes/* requests to upstream Hermes gateway. Supports all upstream endpoints.',
    operationId: 'proxyHermes',
    responses: {
      '200': { description: 'Proxied response from upstream' },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '502': { description: 'Proxy failure' },
    },
  },
  'post': {
    tags: ['Proxy'],
    summary: 'Proxy to upstream Hermes API',
    description: 'Forwards unmatched /api/hermes/* requests to upstream Hermes gateway. Supports all upstream endpoints.',
    operationId: 'proxyHermesPost',
    responses: {
      '200': { description: 'Proxied response from upstream' },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '502': { description: 'Proxy failure' },
    },
  },
  'put': {
    tags: ['Proxy'],
    summary: 'Proxy to upstream Hermes API',
    description: 'Forwards unmatched /api/hermes/* requests to upstream Hermes gateway. Supports all upstream endpoints.',
    operationId: 'proxyHermesPut',
    responses: {
      '200': { description: 'Proxied response from upstream' },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '502': { description: 'Proxy failure' },
    },
  },
  'delete': {
    tags: ['Proxy'],
    summary: 'Proxy to upstream Hermes API',
    description: 'Forwards unmatched /api/hermes/* requests to upstream Hermes gateway. Supports all upstream endpoints.',
    operationId: 'proxyHermesDelete',
    responses: {
      '200': { description: 'Proxied response from upstream' },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '502': { description: 'Proxy failure' },
    },
  },
}

// Add WebSocket terminal endpoint
openapi.paths['/api/hermes/terminal'] = {
  'get': {
    tags: ['Terminal'],
    summary: 'WebSocket terminal connection',
    description: 'Establish a WebSocket connection for interactive terminal access. Uses the `ws` or `wss` protocol with `?token=` for authentication.',
    operationId: 'terminalWebSocket',
    responses: {
      '101': { description: 'Switching Protocols - WebSocket connection established' },
      '401': { $ref: '#/components/responses/Unauthorized' },
    },
  },
}

// Add Chat streaming endpoint
openapi.paths['/api/hermes/v1/runs/{runId}/events'] = {
  'get': {
    tags: ['Chat'],
    summary: 'Server-Sent Events for chat streaming',
    description: 'Stream chat events using Server-Sent Events (SSE). Authentication via `?token=` query parameter.',
    operationId: 'chatStreamEvents',
    parameters: [
      {
        name: 'runId',
        in: 'path',
        required: true,
        description: 'Chat run ID',
        schema: { type: 'string' },
      },
      {
        name: 'token',
        in: 'query',
        required: true,
        description: 'Authentication token',
        schema: { type: 'string' },
      },
    ],
    responses: {
      '200': {
        description: 'SSE stream established',
        content: {
          'text/event-stream': {
            schema: {
              type: 'object',
              properties: {
                event: { type: 'string', enum: ['run.created', 'run.queued', 'run.started', 'run.streaming', 'run.completed', 'run.failed'] },
                data: { type: 'object' },
              },
            },
          },
        },
      },
      '401': { $ref: '#/components/responses/Unauthorized' },
      '404': { description: 'Run not found' },
    },
  },
}

// Add Proxy and Terminal tags
if (!openapi.tags.find(t => t.name === 'Proxy')) {
  openapi.tags.push({ name: 'Proxy', description: 'Gateway proxy to upstream Hermes API' })
}
if (!openapi.tags.find(t => t.name === 'Terminal')) {
  openapi.tags.push({ name: 'Terminal', description: 'WebSocket terminal access' })
}

// Write output
const outputPath = join(rootDir, 'docs/openapi.json')
writeFileSync(outputPath, JSON.stringify(openapi, null, 2))

console.log(`✓ Generated OpenAPI spec: ${outputPath}`)
console.log(`  ${Object.keys(openapi.paths).length} endpoints`)
console.log(`  ${openapi.tags.length} tags`)
