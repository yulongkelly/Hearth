// Copy this file to config.js and fill in your values before deploying.
//   cp website/config.example.js website/config.js

const HEARTH_CONFIG = {
  github: {
    owner: 'your-github-username',
    repo:  'hearth',
  },
  app: {
    version:     'v0.1.0',
    name:        'Hearth',
    description: 'Your private AI assistant — powered by your home',
    year:        '2026',
  },
  files: {
    windows: 'Hearth-Setup.exe',
    mac:     'Hearth.dmg',
    linux:   'Hearth-linux.AppImage',
  },
}

// Derived values — do not edit
HEARTH_CONFIG.repoUrl      = `https://github.com/${HEARTH_CONFIG.github.owner}/${HEARTH_CONFIG.github.repo}`
HEARTH_CONFIG.releasesUrl  = `${HEARTH_CONFIG.repoUrl}/releases`
HEARTH_CONFIG.downloadBase = `${HEARTH_CONFIG.releasesUrl}/latest/download`
