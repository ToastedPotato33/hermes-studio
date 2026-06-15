#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_PORT = process.env.HERMES_WEB_UI_PORT || process.env.PORT || '8648'
const DEFAULT_BASE_URL = `http://127.0.0.1:${DEFAULT_PORT}`
const SERVER_NAME = process.env.HERMES_MCP_SERVER_NAME || 'hermes-web-ui-mcp'
const ALLOWED_PUBLIC_REQUEST_HEADERS = new Set([
  'accept',
  'accept-language',
  'content-type',
  'x-request-id',
])

const __dirname = dirname(fileURLToPath(import.meta.url))

function readPackageVersion() {
  const candidates = [
    resolve(__dirname, '../package.json'),
    resolve(__dirname, '../../package.json'),
    resolve(process.cwd(), 'package.json'),
  ]
  for (const packagePath of candidates) {
    try {
      const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
      if (typeof pkg.version === 'string' && pkg.version.trim()) return pkg.version.trim()
    } catch {
      // Try the next candidate path.
    }
  }
  return '0.0.0'
}

const VERSION = readPackageVersion()

function printHelp() {
  process.stdout.write(`hermes-web-ui-mcp v${VERSION}

Hermes Web UI MCP stdio server.

Usage:
  hermes-web-ui-mcp
  hermes-web-ui-mcp --help
  hermes-web-ui-mcp --version

Environment:
  HERMES_WEB_UI_URL       Web UI base URL. Default: ${DEFAULT_BASE_URL}
  HERMES_WEB_UI_HOME      Web UI state directory. Default: ~/.hermes-web-ui
  HERMES_WEBUI_STATE_DIR  Fallback Web UI state directory.
  HERMES_WEB_UI_PROFILE   Default Hermes profile when a tool call omits profile.
  HERMES_WEB_UI_TOKEN     Optional explicit API token.
  AUTH_TOKEN              Optional explicit API token fallback.

When run without options, this process waits for MCP JSON-RPC messages on stdin.
`)
}

if (process.argv.includes('-h') || process.argv.includes('--help')) {
  printHelp()
  process.exit(0)
}

if (process.argv.includes('-v') || process.argv.includes('--version')) {
  process.stdout.write(`${SERVER_NAME} v${VERSION}\n`)
  process.exit(0)
}

function appHome() {
  return process.env.HERMES_WEB_UI_HOME ||
    process.env.HERMES_WEBUI_STATE_DIR ||
    join(homedir(), '.hermes-web-ui')
}

function normalizeProfileSegment(profile) {
  const raw = String(profile || '').trim()
  if (!raw) return ''
  const sanitized = raw.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
  if (sanitized === '.' || sanitized === '..' || sanitized.length > 128) return ''
  return sanitized
}

function readProfileToken(profile) {
  const segment = normalizeProfileSegment(profile)
  if (!segment) return ''
  try {
    return readFileSync(join(appHome(), 'profiles', segment, '.model-run-token'), 'utf8').trim()
  } catch {
    return ''
  }
}

function readToken(tokenOverride, allowTokenFile = true, profile = '') {
  const explicit = tokenOverride || process.env.HERMES_WEB_UI_TOKEN || process.env.AUTH_TOKEN
  if (explicit) return explicit.trim()
  if (!allowTokenFile) return ''
  const profileToken = readProfileToken(profile)
  if (profileToken) return profileToken
  try {
    return readFileSync(join(appHome(), '.token'), 'utf8').trim()
  } catch {
    return ''
  }
}

function defaultProfile() {
  return String(
    process.env.HERMES_WEB_UI_PROFILE ||
    process.env.HERMES_PROFILE ||
    process.env.PROFILE ||
    '',
  ).trim()
}

function authHint() {
  return `Web UI token was not accepted. Pass the current Hermes profile argument so this MCP server can read its temporary token, pass an explicit token argument, or set HERMES_WEB_UI_TOKEN.`
}

function baseUrl() {
  return (process.env.HERMES_WEB_UI_URL || DEFAULT_BASE_URL).replace(/\/$/, '')
}

function jsonText(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  }
}

function resourceText(uri, data) {
  return {
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(data, null, 2),
    }],
  }
}

function errorText(message) {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  }
}

async function request(path, options = {}) {
  const envelope = await requestEnvelope(path, options)
  if (envelope.status < 200 || envelope.status >= 300) {
    if (envelope.status === 401) {
      throw new Error(`${envelope.body?.error || 'Unauthorized'}. ${authHint()}`)
    }
    throw new Error(envelope.body?.error || envelope.bodyText || `HTTP ${envelope.status}`)
  }
  return envelope.body
}

function appendQuery(path, query) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) return path
  const parsed = new URL(path, 'http://hermes-web-ui.local')
  for (const [key, value] of Object.entries(query)) {
    if (value == null) continue
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item != null) parsed.searchParams.append(key, String(item))
      }
      continue
    }
    parsed.searchParams.set(key, String(value))
  }
  return `${parsed.pathname}${parsed.search}`
}

function normalizePublicHeaders(headers) {
  const normalized = {}
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return normalized
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase()
    if (!ALLOWED_PUBLIC_REQUEST_HEADERS.has(lower) || value == null) continue
    normalized[lower] = Array.isArray(value) ? String(value.find(Boolean) || '') : String(value)
  }
  return normalized
}

async function requestEnvelope(path, options = {}) {
  const profile = typeof options.profile === 'string' && options.profile.trim()
    ? options.profile.trim()
    : defaultProfile()
  const token = readToken(options.token, options.allowTokenFile !== false, profile)
  const method = options.method || 'GET'
  const body = method === 'GET' || method === 'HEAD' ? undefined : options.body
  const headers = {
    ...normalizePublicHeaders(options.headers),
    ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(profile ? { 'X-Hermes-Profile': profile } : {}),
  }
  const response = await fetch(`${baseUrl()}${appendQuery(path, options.query)}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const responseHeaders = {}
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value
  })
  if (method === 'HEAD' || response.status === 204) {
    return { status: response.status, headers: responseHeaders, body: null }
  }
  const contentType = response.headers.get('content-type') || ''
  const bodyText = await response.text()
  let parsedBody = bodyText
  if (contentType.toLowerCase().includes('application/json')) {
    try {
      parsedBody = bodyText ? JSON.parse(bodyText) : null
    } catch {
      parsedBody = bodyText
    }
  }
  return { status: response.status, headers: responseHeaders, body: parsedBody, bodyText }
}

function normalizeApiMethod(method) {
  const value = String(method || 'GET').trim().toUpperCase()
  return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(value) ? value : null
}

function normalizeApiPath(path) {
  const raw = String(path || '').trim()
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null
  if (raw === '/v1' || raw.startsWith('/v1/')) return null
  const parsed = new URL(raw, 'http://hermes-web-ui.local')
  const normalized = `${parsed.pathname}${parsed.search}`
  if (parsed.pathname === '/api/openapi.json') return normalized
  if (parsed.pathname === '/health') return normalized
  if (parsed.pathname.startsWith('/api/')) return normalized
  return null
}

let cachedOpenApiDocument = null

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

async function openApiDocument(options = {}) {
  if (cachedOpenApiDocument) return cachedOpenApiDocument
  cachedOpenApiDocument = await request('/api/openapi.json', options)
  return cachedOpenApiDocument
}

function pathWithoutQuery(path) {
  return new URL(path, 'http://hermes-web-ui.local').pathname
}

function pathTemplateRegex(template) {
  const escaped = String(template).split('/').map(part => {
    if (/^\{[^/{}]+\}$/.test(part)) return '[^/]+'
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }).join('/')
  return new RegExp(`^${escaped}$`)
}

function findOpenApiOperation(openapi, method, path) {
  const paths = isRecord(openapi?.paths) ? openapi.paths : {}
  const pathname = pathWithoutQuery(path)
  const exact = paths[pathname]?.[method.toLowerCase()]
  if (exact) return { operation: exact, pathTemplate: pathname }
  for (const [template, methods] of Object.entries(paths)) {
    if (!pathTemplateRegex(template).test(pathname)) continue
    const operation = isRecord(methods) ? methods[method.toLowerCase()] : null
    if (operation) return { operation, pathTemplate: template }
  }
  return null
}

function queryObjectFromPath(path, query) {
  const parsed = new URL(path, 'http://hermes-web-ui.local')
  const values = {}
  for (const [key, value] of parsed.searchParams.entries()) {
    if (values[key] === undefined) values[key] = value
    else if (Array.isArray(values[key])) values[key].push(value)
    else values[key] = [values[key], value]
  }
  if (isRecord(query)) {
    for (const [key, value] of Object.entries(query)) {
      if (value != null) values[key] = value
    }
  }
  return values
}

function missingValue(value) {
  return value === undefined || value === null || value === ''
}

function validateRequiredObjectFields(schema, value, location) {
  if (!schema || !Array.isArray(schema.required) || schema.required.length === 0) return null
  if (!isRecord(value)) return `${location} must be an object with required fields: ${schema.required.join(', ')}`
  for (const field of schema.required) {
    if (missingValue(value[field])) return `missing required field ${location}.${field}`
  }
  return null
}

async function validateApiRequest(method, path, args) {
  if (pathWithoutQuery(path) === '/api/openapi.json' || pathWithoutQuery(path) === '/api/hermes/openapi.json') return null
  const openapi = await openApiDocument(withAuthArgs(args))
  const match = findOpenApiOperation(openapi, method, path)
  if (!match) return `Unknown endpoint in OpenAPI document: ${method} ${pathWithoutQuery(path)}`
  const { operation } = match
  const queryValues = queryObjectFromPath(path, args.query)
  for (const parameter of Array.isArray(operation.parameters) ? operation.parameters : []) {
    if (!parameter?.required) continue
    if (parameter.in === 'query' && missingValue(queryValues[parameter.name])) {
      return `missing required query parameter ${parameter.name}`
    }
    if (parameter.in === 'path') {
      // Path templates are already matched by the request path; no separate path arg exists.
      continue
    }
  }
  const requestBody = operation.requestBody
  if (!requestBody) return null
  const body = args.body
  if (requestBody.required && body === undefined) return `missing required request body for ${method} ${pathWithoutQuery(path)}`
  if (body === undefined) return null
  const schema = requestBody.content?.['application/json']?.schema
  return validateRequiredObjectFields(schema, body, 'body')
}

function schemaType(schema) {
  if (!isRecord(schema)) return undefined
  if (typeof schema.type === 'string') return schema.type
  if (Array.isArray(schema.oneOf)) return `oneOf(${schema.oneOf.map(schemaType).filter(Boolean).join('|')})`
  if (Array.isArray(schema.anyOf)) return `anyOf(${schema.anyOf.map(schemaType).filter(Boolean).join('|')})`
  if (schema.$ref) return String(schema.$ref).split('/').pop()
  return undefined
}

function compactSchemaProperties(schema) {
  if (!isRecord(schema?.properties)) return undefined
  const result = {}
  for (const [name, property] of Object.entries(schema.properties)) {
    result[name] = {
      type: schemaType(property) || 'unknown',
      ...(property?.description ? { description: String(property.description) } : {}),
      ...(property?.enum ? { enum: property.enum } : {}),
    }
  }
  return result
}

function compactOperation(path, method, operation) {
  const parameters = Array.isArray(operation.parameters) ? operation.parameters : []
  const requestBody = operation.requestBody
  const bodySchema = requestBody?.content?.['application/json']?.schema
  const required = {
    path: parameters.filter(p => p?.in === 'path' && p.required).map(p => p.name),
    query: parameters.filter(p => p?.in === 'query' && p.required).map(p => p.name),
    body: Array.isArray(bodySchema?.required) ? bodySchema.required : [],
  }
  const hasRequired = required.path.length || required.query.length || required.body.length
  const properties = compactSchemaProperties(bodySchema)
  return {
    method: method.toUpperCase(),
    path,
    ...(operation.operationId ? { operationId: operation.operationId } : {}),
    ...(Array.isArray(operation.tags) && operation.tags.length ? { tags: operation.tags } : {}),
    ...(operation.summary ? { summary: operation.summary } : {}),
    ...(operation.description ? { description: operation.description } : {}),
    ...(hasRequired ? { required } : {}),
    ...(requestBody ? {
      requestBody: {
        required: requestBody.required === true,
        type: schemaType(bodySchema) || 'object',
        ...(properties ? { properties } : {}),
      },
    } : {}),
  }
}

function compactOpenApiDocument(openapi, args = {}) {
  if (args.full === true) return openapi
  const filterPath = typeof args.path === 'string' && args.path.trim() ? pathWithoutQuery(args.path.trim()) : ''
  const filterMethod = normalizeApiMethod(args.method)
  const filterTag = typeof args.tag === 'string' && args.tag.trim() ? args.tag.trim() : ''
  const operations = []
  const paths = isRecord(openapi?.paths) ? openapi.paths : {}
  for (const [path, methods] of Object.entries(paths)) {
    if (filterPath && path !== filterPath) continue
    if (!isRecord(methods)) continue
    for (const [method, operation] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'patch', 'delete', 'head'].includes(method)) continue
      if (filterMethod && method !== filterMethod.toLowerCase()) continue
      if (filterTag && !(Array.isArray(operation?.tags) && operation.tags.includes(filterTag))) continue
      operations.push(compactOperation(path, method, operation))
    }
  }
  return {
    title: openapi?.info?.title || 'Hermes Studio API',
    version: openapi?.info?.version || '',
    usage: 'Call hermes_api_request with method, path, and JSON body/query matching the selected operation. Auth and profile are handled by the MCP server.',
    filters: {
      ...(filterPath ? { path: filterPath } : {}),
      ...(filterMethod ? { method: filterMethod } : {}),
      ...(filterTag ? { tag: filterTag } : {}),
    },
    operationCount: operations.length,
    operations,
  }
}

const authArgumentProperties = {
  token: {
    type: 'string',
    description: 'Optional Hermes Web UI bearer token. Usually omit this and pass profile so the MCP server can read the temporary profile token.',
  },
  profile: {
    type: 'string',
    description: 'Hermes profile name for profile-scoped Web UI requests and temporary profile token lookup.',
  },
}

function inputSchema(properties = {}, required = []) {
  return {
    type: 'object',
    properties: { ...authArgumentProperties, ...properties },
    ...(required.length ? { required } : {}),
    additionalProperties: false,
  }
}

function withAuthArgs(args, options = {}) {
  return {
    ...options,
    token: args.token,
    profile: args.profile,
  }
}

const tools = [
  {
    name: 'hermes_api_openapi_get',
    description: 'Return a compact Hermes Studio operation manual generated from OpenAPI. Use optional path/method/tag filters for focused endpoint details before calling hermes_api_request.',
    inputSchema: inputSchema({
        path: {
          type: 'string',
          description: 'Optional endpoint path filter, for example /api/chat-run/runs.',
        },
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'],
          description: 'Optional HTTP method filter.',
        },
        tag: {
          type: 'string',
          description: 'Optional OpenAPI tag filter.',
        },
        full: {
          type: 'boolean',
          description: 'Return the raw full OpenAPI JSON. Defaults to false; prefer compact output for agent use.',
        },
      }),
  },
  {
    name: 'hermes_api_request',
    description: 'Execute a Hermes Studio operation by calling an endpoint path. Use hermes_api_openapi_get first as the operation manual to inspect method, parameters, requestBody, and responses.',
    inputSchema: inputSchema({
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'],
          description: 'HTTP method. Defaults to GET.',
        },
        path: {
          type: 'string',
          description: 'Relative Hermes Studio endpoint path from the operation manual, for example /api/hermes/sessions?limit=20. Full URLs and // paths are rejected.',
        },
        body: {
          type: ['object', 'array', 'string', 'number', 'boolean', 'null'],
          description: 'Optional JSON request body for POST/PUT/PATCH/DELETE. GET and HEAD ignore body.',
        },
        query: {
          type: 'object',
          description: 'Optional query parameters merged into path. Values are serialized as strings; arrays append repeated parameters.',
          additionalProperties: true,
        },
        headers: {
          type: 'object',
          description: 'Optional request headers. Allowed names: accept, accept-language, content-type, x-request-id. Authorization and X-Hermes-Profile are filled from token/profile.',
          additionalProperties: {
            type: ['string', 'number', 'boolean', 'array'],
          },
        },
      }, ['path']),
  },
  {
    name: 'hermes_lan_devices_list',
    description: 'List known LAN and remote devices from Hermes Web UI, including pairing and online status.',
    inputSchema: inputSchema(),
  },
  {
    name: 'hermes_lan_devices_scan',
    description: 'Refresh LAN device discovery cache and return known devices with pairing and online status.',
    inputSchema: inputSchema(),
  },
  {
    name: 'hermes_lan_peer_connect',
    description: 'Connect to a paired LAN device by device id.',
    inputSchema: inputSchema({ device_id: { type: 'string' } }, ['device_id']),
  },
  {
    name: 'hermes_lan_peer_connections',
    description: 'List active LAN peer socket connections.',
    inputSchema: inputSchema(),
  },
  {
    name: 'hermes_lan_peer_disconnect',
    description: 'Disconnect an active LAN peer socket connection.',
    inputSchema: inputSchema({ connection_id: { type: 'string' } }, ['connection_id']),
  },
  {
    name: 'hermes_lan_terminal_create',
    description: 'Create an interactive terminal on a connected LAN peer.',
    inputSchema: inputSchema({
        connection_id: { type: 'string' },
        shell: { type: 'string' },
        cols: { type: 'number' },
        rows: { type: 'number' },
      }, ['connection_id']),
  },
  {
    name: 'hermes_lan_terminal_list',
    description: 'List interactive terminals tracked for a connected LAN peer, including IDs that can be read or closed.',
    inputSchema: inputSchema({
        connection_id: { type: 'string' },
      }, ['connection_id']),
  },
  {
    name: 'hermes_lan_terminal_input',
    description: 'Write input to an interactive terminal on a connected LAN peer.',
    inputSchema: inputSchema({
        connection_id: { type: 'string' },
        terminal_id: { type: 'string' },
        data: { type: 'string' },
      }, ['connection_id', 'terminal_id', 'data']),
  },
  {
    name: 'hermes_lan_terminal_read',
    description: 'Read buffered terminal output from an interactive terminal.',
    inputSchema: inputSchema({
        connection_id: { type: 'string' },
        terminal_id: { type: 'string' },
      }, ['connection_id', 'terminal_id']),
  },
  {
    name: 'hermes_lan_terminal_resize',
    description: 'Resize an interactive terminal on a connected LAN peer.',
    inputSchema: inputSchema({
        connection_id: { type: 'string' },
        terminal_id: { type: 'string' },
        cols: { type: 'number' },
        rows: { type: 'number' },
      }, ['connection_id', 'terminal_id', 'cols', 'rows']),
  },
  {
    name: 'hermes_lan_terminal_close',
    description: 'Close an interactive terminal on a connected LAN peer.',
    inputSchema: inputSchema({
        connection_id: { type: 'string' },
        terminal_id: { type: 'string' },
      }, ['connection_id', 'terminal_id']),
  },
  {
    name: 'hermes_lan_command_exec',
    description: 'Run a command on a connected LAN peer using command plus args, without shell string execution.',
    inputSchema: inputSchema({
        connection_id: { type: 'string' },
        command: { type: 'string' },
        args: { type: 'array', items: { type: 'string' } },
        cwd: { type: 'string' },
        timeout_ms: { type: 'number' },
      }, ['connection_id', 'command']),
  },
  {
    name: 'hermes_lan_file_download',
    description: 'Download a file from a connected LAN peer remote path to a local path on this machine.',
    inputSchema: inputSchema({
        connection_id: { type: 'string' },
        remote_path: { type: 'string' },
        local_path: { type: 'string' },
        timeout_ms: { type: 'number' },
      }, ['connection_id', 'remote_path', 'local_path']),
  },
  {
    name: 'hermes_lan_file_upload',
    description: 'Upload a local file path from this machine to a connected LAN peer remote path.',
    inputSchema: inputSchema({
        connection_id: { type: 'string' },
        local_path: { type: 'string' },
        remote_path: { type: 'string' },
        timeout_ms: { type: 'number' },
      }, ['connection_id', 'local_path', 'remote_path']),
  },
]

async function callTool(name, args = {}) {
  switch (name) {
    case 'hermes_api_openapi_get':
      return jsonText(compactOpenApiDocument(await openApiDocument(withAuthArgs(args)), args))
    case 'hermes_api_request': {
      const method = normalizeApiMethod(args.method)
      const path = normalizeApiPath(args.path)
      if (!method) return errorText('Invalid method. Allowed: GET, POST, PUT, PATCH, DELETE, HEAD.')
      if (!path) return errorText('Invalid path. Use a relative /api/... or /health path from hermes_api_openapi_get; full URLs are not allowed.')
      const validationError = await validateApiRequest(method, path, args)
      if (validationError) return errorText(`Invalid API request for ${method} ${pathWithoutQuery(path)}: ${validationError}. Use hermes_api_openapi_get to inspect required parameters and requestBody.`)
      const options = withAuthArgs(args, {
        method,
        query: args.query,
        headers: args.headers,
        ...(method === 'GET' || method === 'HEAD' ? {} : { body: args.body }),
      })
      return jsonText(await requestEnvelope(path, options))
    }
    case 'hermes_lan_devices_list':
      return jsonText(await request('/api/devices', withAuthArgs(args)))
    case 'hermes_lan_devices_scan':
      return jsonText(await request('/api/devices/scan', withAuthArgs(args, { method: 'POST' })))
    case 'hermes_lan_peer_connect':
      return jsonText(await request(`/api/devices/${encodeURIComponent(args.device_id)}/connect`, withAuthArgs(args, { method: 'POST' })))
    case 'hermes_lan_peer_connections':
      return jsonText(await request('/api/devices/peer-connections', withAuthArgs(args)))
    case 'hermes_lan_peer_disconnect':
      return jsonText(await request(`/api/devices/peer-connections/${encodeURIComponent(args.connection_id)}/disconnect`, withAuthArgs(args, { method: 'POST' })))
    case 'hermes_lan_terminal_create':
      return jsonText(await request(`/api/devices/peer-connections/${encodeURIComponent(args.connection_id)}/terminal`, withAuthArgs(args, {
        method: 'POST',
        body: { shell: args.shell, cols: args.cols, rows: args.rows },
      })))
    case 'hermes_lan_terminal_list':
      return jsonText(await request(`/api/devices/peer-connections/${encodeURIComponent(args.connection_id)}/terminals`, withAuthArgs(args)))
    case 'hermes_lan_terminal_input':
      return jsonText(await request(`/api/devices/peer-connections/${encodeURIComponent(args.connection_id)}/terminal/${encodeURIComponent(args.terminal_id)}/input`, withAuthArgs(args, {
        method: 'POST',
        body: { data: args.data },
      })))
    case 'hermes_lan_terminal_read':
      return jsonText(await request(`/api/devices/peer-connections/${encodeURIComponent(args.connection_id)}/terminal/${encodeURIComponent(args.terminal_id)}/read`, withAuthArgs(args)))
    case 'hermes_lan_terminal_resize':
      return jsonText(await request(`/api/devices/peer-connections/${encodeURIComponent(args.connection_id)}/terminal/${encodeURIComponent(args.terminal_id)}/resize`, withAuthArgs(args, {
        method: 'POST',
        body: { cols: args.cols, rows: args.rows },
      })))
    case 'hermes_lan_terminal_close':
      return jsonText(await request(`/api/devices/peer-connections/${encodeURIComponent(args.connection_id)}/terminal/${encodeURIComponent(args.terminal_id)}/close`, withAuthArgs(args, { method: 'POST' })))
    case 'hermes_lan_command_exec':
      return jsonText(await request(`/api/devices/peer-connections/${encodeURIComponent(args.connection_id)}/exec`, withAuthArgs(args, {
        method: 'POST',
        body: { command: args.command, args: args.args || [], cwd: args.cwd, timeout_ms: args.timeout_ms },
      })))
    case 'hermes_lan_file_download':
      return jsonText(await request(`/api/devices/peer-connections/${encodeURIComponent(args.connection_id)}/download`, withAuthArgs(args, {
        method: 'POST',
        body: { remote_path: args.remote_path, local_path: args.local_path, timeout_ms: args.timeout_ms },
      })))
    case 'hermes_lan_file_upload':
      return jsonText(await request(`/api/devices/peer-connections/${encodeURIComponent(args.connection_id)}/upload`, withAuthArgs(args, {
        method: 'POST',
        body: { local_path: args.local_path, remote_path: args.remote_path, timeout_ms: args.timeout_ms },
      })))
    default:
      return errorText(`Unknown tool: ${name}`)
  }
}

const resources = [
  {
    uri: 'hermes://openapi.json',
    name: 'Hermes Studio Operation Manual',
    description: 'Hermes Studio operation manual encoded as OpenAPI 3.0 JSON, covering endpoints, parameters, request bodies, and responses.',
    mimeType: 'application/json',
  },
]

async function readResource(uri) {
  switch (uri) {
    case 'hermes://openapi.json':
      return resourceText(uri, await request('/api/openapi.json'))
    default:
      return null
  }
}

async function handle(message) {
  if (!message || message.id === undefined) return null

  try {
    switch (message.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: {
            protocolVersion: message.params?.protocolVersion || '2024-11-05',
            capabilities: { tools: {}, resources: {} },
            serverInfo: { name: SERVER_NAME, version: VERSION },
          },
        }
      case 'tools/list':
        return { jsonrpc: '2.0', id: message.id, result: { tools } }
      case 'tools/call':
        return {
          jsonrpc: '2.0',
          id: message.id,
          result: await callTool(message.params?.name, message.params?.arguments || {}),
        }
      case 'resources/list':
        return { jsonrpc: '2.0', id: message.id, result: { resources } }
      case 'resources/read': {
        const result = await readResource(message.params?.uri)
        if (!result) {
          return {
            jsonrpc: '2.0',
            id: message.id,
            error: { code: -32602, message: `Unknown resource: ${message.params?.uri || ''}` },
          }
        }
        return { jsonrpc: '2.0', id: message.id, result }
      }
      default:
        return {
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32601, message: `Method not found: ${message.method}` },
        }
    }
  } catch (err) {
    if (message.method === 'resources/read') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32000, message: err?.message || String(err) },
      }
    }
    return { jsonrpc: '2.0', id: message.id, result: errorText(err?.message || String(err)) }
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', async line => {
  const text = line.trim()
  if (!text) return
  let message
  try {
    message = JSON.parse(text)
  } catch {
    return
  }
  const response = await handle(message)
  if (response) process.stdout.write(`${JSON.stringify(response)}\n`)
})
