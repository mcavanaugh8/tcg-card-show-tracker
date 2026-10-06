import { createServer } from 'node:http'
import { readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { backup as backupSqlite, DatabaseSync } from 'node:sqlite'

const root = fileURLToPath(new URL('.', import.meta.url))
const dataDirectory = process.env.TABLETOP_DATA_DIR ? resolve(process.env.TABLETOP_DATA_DIR) : join(root, 'data')
const backupDirectory = process.env.TABLETOP_BACKUP_DIR ? resolve(process.env.TABLETOP_BACKUP_DIR) : join(homedir(), 'Documents', 'Tabletop Ledger Backups')
const snapshotDirectory = join(backupDirectory, 'snapshots')
const showBackupDirectory = join(backupDirectory, 'shows')
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
let lastBackup = { ok: false, path: backupDirectory, updatedAt: null, error: 'No backup has been written yet.' }

async function atomicWrite(path, contents) {
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, contents, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
}

async function trimFileSnapshots(limit = 100) {
  const files = (await readdir(snapshotDirectory)).filter((name) => name.endsWith('.json')).sort().reverse()
  await Promise.all(files.slice(limit).map((name) => unlink(join(snapshotDirectory, name))))
}

async function writeRedundantBackups(payload, timestamp, label = 'autosave') {
  try {
    mkdirSync(snapshotDirectory, { recursive: true })
    mkdirSync(showBackupDirectory, { recursive: true })
    const safeTimestamp = timestamp.replaceAll(':', '-').replaceAll('.', '-')
    await atomicWrite(join(backupDirectory, 'tabletop-ledger-latest.json'), payload)
    await atomicWrite(join(snapshotDirectory, `${safeTimestamp}-${label}.json`), payload)
    const workspace = JSON.parse(payload)
    await Promise.all(workspace.shows.map((show) => {
      const safeName = String(show.showName || 'show').replaceAll(/[^a-zA-Z0-9_-]+/g, '-').replaceAll(/^-|-$/g, '').slice(0, 60) || 'show'
      return atomicWrite(join(showBackupDirectory, `${safeName}-${show.id}.json`), JSON.stringify(show))
    }))

    const temporaryDatabase = join(backupDirectory, `tabletop-ledger-latest.${process.pid}.tmp.sqlite`)
    await unlink(temporaryDatabase).catch(() => undefined)
    await backupSqlite(database, temporaryDatabase)
    await rename(temporaryDatabase, join(backupDirectory, 'tabletop-ledger-latest.sqlite'))
    await trimFileSnapshots()
    lastBackup = { ok: true, path: backupDirectory, updatedAt: timestamp, error: null }
  } catch (error) {
    lastBackup = { ok: false, path: backupDirectory, updatedAt: timestamp, error: error instanceof Error ? error.message : 'Unable to write redundant backups' }
  }
  return lastBackup
}

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
    sendJson(response, 200, row ? { state: JSON.parse(row.payload), updatedAt: row.updated_at, backup: lastBackup } : { state: null, backup: lastBackup })
    return true
  }
  if (request.method === 'PUT') {
    void readBody(request).then(async (body) => {
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
      const backup = await writeRedundantBackups(payload, timestamp)
      sendJson(response, 200, { ok: true, updatedAt: timestamp, backup })
    }).catch((error) => sendJson(response, 400, { error: error instanceof Error ? error.message : 'Unable to save state' }))
    return true
  }
  if (request.method === 'DELETE') {
    void (async () => {
      const current = selectState.get()
      const timestamp = new Date().toISOString()
      if (current?.payload) await writeRedundantBackups(current.payload, timestamp, 'pre-reset')
      database.exec('BEGIN IMMEDIATE')
      try {
        if (current?.payload) saveSnapshot.run(current.payload, timestamp)
        database.exec('DELETE FROM workspace_state WHERE id = 1')
        trimSnapshots.run()
        database.exec('COMMIT')
        sendJson(response, 200, { ok: true, backup: lastBackup })
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    })().catch((error) => sendJson(response, 500, { error: error instanceof Error ? error.message : 'Unable to clear state' }))
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

const existingState = selectState.get()
if (existingState?.payload) void writeRedundantBackups(existingState.payload, new Date().toISOString(), 'startup')

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { database.close(); server.close(() => process.exit(0)) })
