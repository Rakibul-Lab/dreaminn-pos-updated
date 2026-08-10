/**
 * Creates server-upload/ with only the files needed on cPanel + Passenger.
 * Zip that folder and upload to your server, then run npm install, prisma db push, npm run build.
 */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const output = path.join(root, 'server-upload')

const ROOT_FILES = [
  'server.js',
  'package.json',
  'package-lock.json',
  'next.config.ts',
  'tsconfig.json',
  'tailwind.config.ts',
  'postcss.config.mjs',
  'components.json',
]

const ROOT_DIRS = ['src', 'scripts', 'prisma']

const PUBLIC_FILES = [
  'logo.svg',
  'robots.txt',
  'registration-form-a4.css',
  'reservation-a4.css',
  'reservation-pdf-capture.css',
]

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
}

function prepare() {
  rmDir(output)

  for (const file of ROOT_FILES) {
    const src = path.join(root, file)
    if (!fs.existsSync(src)) {
      console.error(`Missing required file: ${file}`)
      process.exit(1)
    }
    copyFile(src, path.join(output, file))
  }

  for (const dir of ROOT_DIRS) {
    const src = path.join(root, dir)
    if (!fs.existsSync(src)) {
      console.error(`Missing required folder: ${dir}/`)
      process.exit(1)
    }
    fs.cpSync(src, path.join(output, dir), { recursive: true })
  }

  // Prisma: schema only (no local sqlite)
  const prismaDb = path.join(output, 'prisma', 'db')
  if (fs.existsSync(prismaDb)) {
    fs.rmSync(prismaDb, { recursive: true, force: true })
  }

  const publicOut = path.join(output, 'public')
  fs.mkdirSync(publicOut, { recursive: true })

  for (const file of PUBLIC_FILES) {
    const src = path.join(root, 'public', file)
    if (fs.existsSync(src)) {
      copyFile(src, path.join(publicOut, file))
    }
  }

  const uploadsDir = path.join(publicOut, 'uploads', 'id-docs')
  fs.mkdirSync(uploadsDir, { recursive: true })
  fs.writeFileSync(path.join(uploadsDir, '.gitkeep'), '')

  fs.writeFileSync(
    path.join(output, 'UPLOAD-README.txt'),
    [
      'DreamInn — server upload package',
      '================================',
      '',
      '1. Upload and extract everything into your app folder (e.g. ~/dreaminn/)',
      '2. In cPanel → Setup Node.js App:',
      '   - Startup file: server.js',
      '   - Set DATABASE_URL and NODE_ENV=production',
      '3. In Terminal:',
      '   cd ~/dreaminn',
      '   npm install',
      '   npx prisma db push',
      '   npm run build',
      '4. Restart the Node.js app in cPanel',
      '5. Seed once: curl -X POST https://yourdomain.com/api/auth/seed',
      '',
      'Default login: admin@erp.com / admin123',
      '',
    ].join('\n')
  )

  console.log('')
  console.log('Ready: server-upload/')
  console.log('Zip this folder and upload to your server.')
  console.log('')

  const zipPath = path.join(root, 'server-upload.zip')
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath)
  try {
    if (process.platform === 'win32') {
      execSync(
        `powershell -NoProfile -Command "Compress-Archive -Path '${path.join(output, '*')}' -DestinationPath '${zipPath}' -Force"`,
        { cwd: root, stdio: 'inherit', shell: true }
      )
    } else if (fs.existsSync('/usr/bin/zip')) {
      execSync(`cd "${output}" && zip -rq "${zipPath}" .`, {
        cwd: root,
        stdio: 'inherit',
        shell: true,
      })
    }
    if (fs.existsSync(zipPath)) {
      console.log(`Zip ready: ${zipPath}`)
      console.log('Upload that zip to cPanel, extract into your app folder, then build on the server.')
      console.log('')
    }
  } catch (err) {
    console.warn('Could not create zip automatically — zip the server-upload/ folder yourself.')
  }
}

prepare()
