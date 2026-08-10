/**
 * Build the same Linux cpanel-deploy.zip as GitHub Actions, using Docker on Windows/macOS.
 * Requires Docker Desktop running.
 */
const { execSync, spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const zipPath = path.join(root, 'cpanel-deploy.zip')
const outDir = path.join(root, 'cpanel-deploy')
const image = 'node:20.19.0-bookworm'

function hasDocker() {
  const result = spawnSync('docker', ['version'], {
    encoding: 'utf8',
    shell: true,
  })
  return result.status === 0
}

if (!hasDocker()) {
  console.error('')
  console.error('Docker is not available.')
  console.error('Install Docker Desktop, start it, then run:')
  console.error('  npm run build:cpanel:docker')
  console.error('')
  console.error('Or free GitHub Actions artifacts and use:')
  console.error('  Actions → Build cPanel package')
  console.error('')
  process.exit(1)
}

console.log('Building Linux cPanel package with Docker (same as GitHub Actions)...')
console.log(`Image: ${image}`)
console.log('')

const dockerCmd = [
  'docker run --rm',
  `-v "${root}:/app"`,
  '-w /app',
  `-e DATABASE_URL=mysql://build:build@localhost:3306/build`,
  `-e BUILD_CPANEL_LOCAL=1`,
  image,
  'bash -lc "npm install --no-audit --no-fund && node scripts/build-cpanel.js"',
].join(' ')

try {
  execSync(dockerCmd, { cwd: root, stdio: 'inherit', shell: true })
} catch {
  console.error('')
  console.error('Docker build failed. Make sure Docker Desktop is running, then retry.')
  process.exit(1)
}

console.log('')
if (fs.existsSync(zipPath)) {
  console.log(`Ready (same style as GitHub Actions): ${zipPath}`)
} else if (fs.existsSync(outDir)) {
  console.log(`Ready folder: ${outDir}`)
  console.log('Zip it if needed, then upload to cPanel and restart the app.')
} else {
  console.error('Build finished but cpanel-deploy.zip was not found.')
  process.exit(1)
}
console.log('')
console.log('cPanel: upload zip → extract into app folder (keep .env) → Restart Node.js app')
console.log('No npm install / npm run build needed on the server.')
console.log('')
