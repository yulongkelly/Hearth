/**
 * Build script: compiles Next.js then copies static assets into the
 * standalone output so electron-builder can package everything together.
 */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')

console.log('Building Next.js...')
execSync('npx next build', { stdio: 'inherit', cwd: root })

// Next.js standalone output needs static files copied in alongside it.
const staticSrc = path.join(root, '.next', 'static')
const staticDst = path.join(root, '.next', 'standalone', '.next', 'static')
const publicSrc = path.join(root, 'public')
const publicDst = path.join(root, '.next', 'standalone', 'public')

console.log('Copying static assets...')
fs.cpSync(staticSrc, staticDst, { recursive: true })
fs.cpSync(publicSrc, publicDst, { recursive: true })

console.log('Done. Run electron-builder to create the installer.')
