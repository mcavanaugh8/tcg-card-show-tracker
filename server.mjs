import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'

const root = fileURLToPath(new URL('.', import.meta.url))
const dataDirectory = process.env.TABLETOP_DATA_DIR ? resolve(process.env.TABLETOP_DATA_DIR) : join(root, 'data')
mkdirSync(dataDirectory, { recursive: true })

const database = new DatabaseSync(join(dataDirectory, 'tabletop-ledger.sqlite'))
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = FULL;
  CREATE TABLE IF NOT EXISTS workspace_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workspace_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
`)

const selectState = database.prepare('SELECT payload, updated_at FROM workspace_state WHERE id = 1')
const saveState = database.prepare(`
  INSERT INTO workspace_state (id, payload, updated_at) VALUES (1, ?, ?)
  ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
`)
const saveSnapshot = database.prepare('INSERT INTO workspace_snapshots (payload, created_at) VALUES (?, ?)')
const trimSnapshots = database.prepare('DELETE FROM workspace_snapshots WHERE id NOT IN (SELECT id FROM workspace_snapshots ORDER BY id DESC LIMIT 100)')

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(value))
}

async function readBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 25 * 1024 * 1024) throw new Error('Request is too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function handleApi(request, response) {
  if (request.url !== '/api/state') return false
  if (request.method === 'GET') {
    const row = selectState.get()
    sendJson(response, 200, row ? { state: JSON.parse(row.payload), updatedAt: row.updated_at } : { state: null })
    return true
  }
  if (request.method === 'PUT') {
    void readBody(request).then((body) => {
      const parsed = JSON.parse(body)
      if (!parsed || !Array.isArray(parsed.shows) || typeof parsed.activeShowId !== 'string') throw new Error('Invalid workspace state')
      const payload = JSON.stringify(parsed)
      const current = selectState.get()
      const timestamp = new Date().toISOString()
      database.exec('BEGIN IMMEDIATE')
      try {
        if (current?.payload && current.payload !== payload) saveSnapshot.run(current.payload, timestamp)
        saveState.run(payload, timestamp)
        trimSnapshots.run()
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
      sendJson(response, 200, { ok: true, updatedAt: timestamp })
    }).catch((error) => sendJson(response, 400, { error: error instanceof Error ? error.message : 'Unable to save state' }))
    return true
  }
  if (request.method === 'DELETE') {
    database.exec('BEGIN IMMEDIATE')
    try {
      const current = selectState.get()
      if (current?.payload) saveSnapshot.run(current.payload, new Date().toISOString())
      database.exec('DELETE FROM workspace_state WHERE id = 1')
      trimSnapshots.run()
      database.exec('COMMIT')
      sendJson(response, 200, { ok: true })
    } catch (error) {
      database.exec('ROLLBACK')
      sendJson(response, 500, { error: error instanceof Error ? error.message : 'Unable to clear state' })
    }
    return true
  }
  sendJson(response, 405, { error: 'Method not allowed' })
  return true
}

const mimeTypes = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }
const production = process.env.NODE_ENV === 'production'
const vite = production ? null : await import('vite').then(({ createServer }) => createServer({ server: { middlewareMode: true }, appType: 'spa' }))

const server = createServer(async (request, response) => {
  if (handleApi(request, response)) return
  if (vite) {
    vite.middlewares(request, response, () => { response.statusCode = 404; response.end('Not found') })
    return
  }
  const requested = decodeURIComponent((request.url ?? '/').split('?')[0])
  const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '')
  let file = resolve(root, 'dist', relative)
  if (!file.startsWith(resolve(root, 'dist'))) { response.statusCode = 403; response.end('Forbidden'); return }
  try {
    if (!(await stat(file)).isFile()) throw new Error('Not a file')
  } catch {
    file = join(root, 'dist', 'index.html')
  }
  try {
    const contents = await readFile(file)
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(file)] ?? 'application/octet-stream' })
    response.end(contents)
  } catch {
    response.statusCode = 404
    response.end('Build not found. Run npm run build first.')
  }
})

const port = Number(process.env.PORT ?? 5173)
server.listen(port, '0.0.0.0', () => console.log(`Tabletop Ledger running at http://localhost:${port}`))

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { database.close(); server.close(() => process.exit(0)) })
