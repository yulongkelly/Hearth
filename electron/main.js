const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const net = require('net')

const isDev = process.env.NODE_ENV === 'development'
const PORT = 3000

let mainWindow = null
let tray = null
let nextProcess = null

function waitForPort(port, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    function attempt() {
      const socket = net.createConnection({ port, host: '127.0.0.1' })
      socket.once('connect', () => { socket.destroy(); resolve() })
      socket.once('error', () => {
        socket.destroy()
        if (Date.now() - start > timeout) {
          reject(new Error(`Timed out waiting for port ${port}`))
        } else {
          setTimeout(attempt, 500)
        }
      })
    }
    attempt()
  })
}

async function startNextServer() {
  if (isDev) return // dev server started separately via `npm run dev:web`

  // In production, Next.js standalone is in resources/app/
  const serverJs = path.join(process.resourcesPath, 'app', 'server.js')

  // Use Electron's own Node.js runtime to run the server
  nextProcess = spawn(process.execPath, [serverJs], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOSTNAME: '127.0.0.1',
      NODE_ENV: 'production',
    },
    stdio: 'pipe',
  })

  nextProcess.stdout.on('data', d => console.log('[server]', d.toString().trim()))
  nextProcess.stderr.on('data', d => console.error('[server]', d.toString().trim()))
  nextProcess.on('exit', code => {
    console.log('[server] exited with code', code)
    // If the server dies unexpectedly, quit the whole app
    if (mainWindow) app.quit()
  })

  await waitForPort(PORT)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  })

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`)

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' })
  })

  mainWindow.on('closed', () => { mainWindow = null })

  // Open external links in the system browser, not inside the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })
}

function createTray() {
  // Use an empty image; replace with real icon path once you have one
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)
  tray.setToolTip('Hearth')
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Open Hearth',
      click: () => mainWindow ? mainWindow.focus() : createWindow(),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]))
  tray.on('click', () => mainWindow ? mainWindow.focus() : createWindow())
}

app.whenReady().then(async () => {
  // Single instance lock — second launch focuses existing window
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  try {
    await startNextServer()
    createWindow()
    createTray()
  } catch (err) {
    console.error('Startup failed:', err)
    app.quit()
  }
})

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  }
})

app.on('window-all-closed', () => {
  // On macOS, keep the process alive until Cmd+Q (standard behavior)
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', () => {
  if (nextProcess) {
    nextProcess.kill()
    nextProcess = null
  }
})
