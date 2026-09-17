/**
 * cPanel startup file — upload the full cpanel-deploy/ folder.
 */
const fs = require('fs')
const path = require('path')

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key) {
      process.env[key] = value
    }
  }
}

const appDir = __dirname
// Anchor the whole app to the hotel's timezone so check-in/out times and the
// auto next-day bill grace are computed in local hotel time, not the (UTC) host.
process.env.TZ = process.env.TZ || 'Asia/Dhaka'
loadEnvFile(path.join(appDir, '.env'))
loadEnvFile(path.join(appDir, '.env.production'))
// .env may override the timezone; make sure Node actually adopts it.
if (!process.env.TZ) process.env.TZ = 'Asia/Dhaka'
const requiredFiles = path.join(appDir, '.next', 'required-server-files.json')

if (!fs.existsSync(requiredFiles)) {
  console.error('Build missing. Use GitHub Actions → Build cPanel package, then upload cpanel-deploy/')
  process.exit(1)
}

process.env.NODE_ENV = 'production'
process.chdir(appDir)

const { config } = require(requiredFiles)
process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(config)
require('next')

const { startServer } = require('next/dist/server/lib/start-server')

startServer({
  dir: appDir,
  isDev: false,
  config,
  hostname: process.env.HOSTNAME || '0.0.0.0',
  port: parseInt(process.env.PORT, 10) || 3000,
  allowRetry: false,
}).catch((err) => {
  console.error(err)
  process.exit(1)
})
