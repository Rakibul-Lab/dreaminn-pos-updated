const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const standalone = path.join(root, '.next', 'standalone')
const output = path.join(root, 'cpanel-deploy')
const zipPath = path.join(root, 'cpanel-deploy.zip')

function run(cmd) {
  execSync(cmd, { cwd: root, stdio: 'inherit', shell: true })
}

function removeEnvFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      removeEnvFiles(full)
    } else if (entry.name === '.env' || entry.name.startsWith('.env.')) {
      fs.rmSync(full)
    }
  }
}

function createZip() {
  if (!fs.existsSync(output)) return
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath)

  if (process.platform === 'win32') {
    run(
      `powershell -NoProfile -Command "Compress-Archive -Path '${path.join(output, '*')}' -DestinationPath '${zipPath}' -Force"`
    )
  } else if (fs.existsSync('/usr/bin/zip')) {
    run(`cd "${output}" && zip -rq "${zipPath}" .`)
  }
}

function stripTestUploads(dir) {
  const uploads = path.join(dir, 'public', 'uploads', 'id-docs')
  if (!fs.existsSync(uploads)) {
    fs.mkdirSync(uploads, { recursive: true })
    return
  }
  for (const entry of fs.readdirSync(uploads, { withFileTypes: true })) {
    if (entry.isFile() && entry.name !== '.gitkeep') {
      fs.rmSync(path.join(uploads, entry.name))
    }
  }
}

function fixRequiredServerFiles(dir) {
  const file = path.join(dir, '.next', 'required-server-files.json')
  if (!fs.existsSync(file)) return

  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  data.appDir = '.'
  data.relativeAppDir = ''
  if (Array.isArray(data.files)) {
    data.files = data.files.map((f) => f.replace(/\\/g, '/'))
  }
  if (data.config?.turbopack?.root) {
    delete data.config.turbopack.root
  }
  fs.writeFileSync(file, JSON.stringify(data))
}

function packageDeploy() {
  const required = [
    'server.js',
    'package.json',
    path.join('.next', 'required-server-files.json'),
    path.join('.next', 'static'),
    'public',
    'node_modules',
  ]

  for (const rel of required) {
    if (!fs.existsSync(path.join(standalone, rel))) {
      console.error(`Missing .next/standalone/${rel} — run build first`)
      process.exit(1)
    }
  }

  fs.rmSync(output, { recursive: true, force: true })
  fs.cpSync(standalone, output, { recursive: true })
  removeEnvFiles(output)
  stripTestUploads(output)
  fixRequiredServerFiles(output)

  const schemaSrc = path.join(root, 'prisma', 'schema.prisma')
  const schemaDest = path.join(output, 'prisma', 'schema.prisma')
  if (fs.existsSync(schemaSrc)) {
    fs.mkdirSync(path.dirname(schemaDest), { recursive: true })
    fs.copyFileSync(schemaSrc, schemaDest)
  }

  fs.mkdirSync(path.join(output, 'tmp'), { recursive: true })
  fs.writeFileSync(path.join(output, 'tmp', 'restart.txt'), new Date().toISOString())

  createZip()

  console.log('')
  console.log('Upload to cPanel → /home/rrpdream/dreaminn/')
  console.log(`  Folder: ${output}`)
  if (fs.existsSync(zipPath)) console.log(`  Zip:    ${zipPath}`)
  console.log('')
  console.log('Startup file: server.js')
  console.log('Set NODE_ENV, DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL in cPanel')
  console.log('Then Restart the Node.js app.')
}

if (process.platform === 'win32' && process.env.BUILD_CPANEL_LOCAL !== '1') {
  console.error('')
  console.error('This PC is Windows. A ready-made cPanel package must be built on Linux')
  console.error('(Prisma/native modules), so plain `npm run build:cpanel` is blocked here.')
  console.error('')
  console.error('Options without GitHub Actions:')
  console.error('  1) Same ready zip as Actions (recommended):')
  console.error('       Install Docker Desktop → start it → npm run build:cpanel:docker')
  console.error('     Then upload cpanel-deploy.zip and only Restart the app.')
  console.error('')
  console.error('  2) Source upload + build on cPanel:')
  console.error('       npm run pack:upload')
  console.error('     Then on server: npm install && npx prisma generate && npm run build')
  console.error('')
  console.error('  3) Free GitHub Actions storage (delete old artifacts), then run')
  console.error('     Actions → Build cPanel package.')
  console.error('')
  process.exit(1)
}

run('npx next build --webpack && node scripts/copy-standalone-assets.js')
packageDeploy()
