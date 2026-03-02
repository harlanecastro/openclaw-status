const { app, Tray, Menu, BrowserWindow, Notification, nativeImage, shell, ipcMain } = require('electron');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const os = require('os');
const http = require('http');

// ─── Prevent multiple instances ─────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

// ─── Paths ──────────────────────────────────────────────────────────────────
const isDev = !app.isPackaged;
const assetsPath = path.join(__dirname, 'assets');
const localesPath = path.join(__dirname, 'locales');
const contributorsPath = path.join(__dirname, 'contributors.json');
const settingsPath = path.join(app.getPath('userData'), 'settings.json');

// ─── Settings ───────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  pollInterval: 10,
  language: 'en'
};

function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsPath, 'utf8')) };
    }
  } catch (_) { /* ignore */ }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch (_) { /* ignore */ }
}

let settings = loadSettings();

// ─── i18n ───────────────────────────────────────────────────────────────────
function getAvailableLocales() {
  try {
    return fs.readdirSync(localesPath)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  } catch (_) { return ['en']; }
}

function loadLocale(lang) {
  try {
    const filePath = path.join(localesPath, `${lang}.json`);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (_) { /* ignore */ }
  // Fallback to English
  try {
    return JSON.parse(fs.readFileSync(path.join(localesPath, 'en.json'), 'utf8'));
  } catch (_) {
    return {};
  }
}

let strings = loadLocale(settings.language);

function t(key, replacements) {
  let str = strings[key] || key;
  if (replacements) {
    for (const [k, v] of Object.entries(replacements)) {
      str = str.replace(`{${k}}`, v);
    }
  }
  return str;
}

const LOCALE_DISPLAY_NAMES = {
  en: 'English',
  pt: 'Português',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  ja: '日本語',
  zh: '中文',
  ko: '한국어',
  ru: 'Русский'
};

function localeDisplayName(code) {
  return LOCALE_DISPLAY_NAMES[code] || code.toUpperCase();
}

// ─── State ──────────────────────────────────────────────────────────────────
let tray = null;
let isOnline = false;
let isProcessing = false;
let processingAction = '';
let abortStartAttempt = false;
let pollTimer = null;
let blinkTimer = null;
let blinkOn = false;
let logsWindow = null;
let aboutWindow = null;

// ─── Icons ──────────────────────────────────────────────────────────────────
function getTrayIcon(variant) {
  // variant: 'online', 'offline', or 'processing'
  const prefixMap = { online: 'tray-red', offline: 'tray-gray', processing: 'tray-orange' };
  const prefix = prefixMap[variant] || 'tray-gray';
  // Try multiple sizes, prefer 16px for tray
  for (const size of [16, 24, 32]) {
    const iconPath = path.join(assetsPath, `${prefix}-${size}.png`);
    if (fs.existsSync(iconPath)) {
      return nativeImage.createFromPath(iconPath);
    }
  }
  // Fallback to large icon
  const fallbackMap = { online: 'icon-red.png', offline: 'icon-gray.png', processing: 'icon-orange.png' };
  return nativeImage.createFromPath(path.join(assetsPath, fallbackMap[variant] || 'icon-gray.png'));
}

function currentVariant() {
  return isOnline ? 'online' : 'offline';
}

// ─── Processing Animation ───────────────────────────────────────────────────
function startBlinking() {
  if (blinkTimer) return;
  blinkOn = false;
  blinkTimer = setInterval(() => {
    if (!tray) return;
    blinkOn = !blinkOn;
    tray.setImage(blinkOn ? getTrayIcon('processing') : getTrayIcon(currentVariant()));
  }, 500);
  // Set orange immediately
  if (tray) tray.setImage(getTrayIcon('processing'));
}

function stopBlinking() {
  if (blinkTimer) {
    clearInterval(blinkTimer);
    blinkTimer = null;
    blinkOn = false;
  }
}

// ─── OpenClaw CLI ───────────────────────────────────────────────────────────
function runCommand(cmd, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stdout, stderr });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

async function checkGatewayStatus() {
  return new Promise((resolve) => {
    // Attempt HTTP check first. We don't care about the body, just that it responds without a socket error.
    const req = http.get('http://127.0.0.1:18789/', { timeout: 1000 }, (res) => {
      // If we got any HTTP response, the server is up
      resolve(true);
      res.resume(); // consume response data to free up memory
    });

    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', (err) => { 
      // If we get an error, it's likely ECONOMNREFUSED, so it's not ready
      resolve(false); 
    });
  });
}

function stopGatewayAction() {
  abortStartAttempt = true;
  isProcessing = false;
  processingAction = '';
  stopBlinking();
  updateTray();
}

async function gatewayAction(action) {
  if (isProcessing) return; // Prevent concurrent actions

  const actionKey = action; // start, stop, restart
  const notifTitle = t(`gateway_${actionKey}ing`) || `Gateway ${actionKey}...`;

  // Enter processing state
  isProcessing = true;
  processingAction = notifTitle;
  if (action === 'start') {
    abortStartAttempt = false;
  }
  startBlinking();
  updateTray();

  try {
    showNotification(t('app_name'), notifTitle);

    // Always stop before starting to clear any stuck state
    if (action === 'start' || action === 'stop' || action === 'restart') {
      try {
        if (process.platform === 'win32') {
          await runCommand('taskkill /F /IM openclaw.exe /T', 10000);
          await runCommand('taskkill /F /IM node.exe /FI "WINDOWTITLE eq openclaw*" /T', 10000);
        } else {
          await runCommand('killall openclaw', 10000);
        }
      } catch (err) {
        // Ignorar erros caso não haja processo para matar
      }
    }

    if (action === 'start' || action === 'restart') {
      try {
        await runCommand(`openclaw gateway start`, 15000);
      } catch (cmdErr) {
        fs.appendFileSync(path.join(app.getPath('userData'), 'debug.log'), `CLI start command warning (ignoring if service responds): ${cmdErr.message || cmdErr.error}\n`);
      }

      // Infinite check loop for slow machines
      let isUp = false;
      while (!abortStartAttempt && !isUp) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        isUp = await checkGatewayStatus();
      }
      
      if (abortStartAttempt) {
        throw new Error("Start attempt aborted by user");
      }
    }

    showNotification(t('app_name'), t(`gateway_${actionKey}_ok`));
  } catch (err) {
    if (!abortStartAttempt) {
      fs.appendFileSync(path.join(app.getPath('userData'), 'debug.log'), `Action ${action} Error: ${err.message || err.error}\nstderr: ${err.stderr || 'No stderr'}\n`);
      showNotification(t('app_name'), t(`gateway_${actionKey}_fail`));
    }
  }

  // Only run standard cleanup if we were not aborted (since abort cleans its own state up)
  if (!abortStartAttempt || action !== 'start') {
    isProcessing = false;
    processingAction = '';
    stopBlinking();
  }

  // Refresh status after action immediately
  await pollStatus();
  updateTray();
}

async function openDashboard() {
  shell.openExternal('http://127.0.0.1:18789/overview');
}

async function runHealthCheck() {
  try {
    const isHealthy = await checkGatewayStatus();
    if (isHealthy) {
      showNotification(t('health_title'), t('health_ok'));
    } else {
      showNotification(t('health_title'), t('health_fail'));
    }
  } catch (_) {
    showNotification(t('health_title'), t('health_fail'));
  }
}

// ─── Notifications ──────────────────────────────────────────────────────────
function showNotification(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body, icon: path.join(assetsPath, 'icon-red.png') }).show();
  }
}

// ─── Logs Window ────────────────────────────────────────────────────────────
function openLogsWindow() {
  if (logsWindow) {
    logsWindow.focus();
    return;
  }

  logsWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: t('logs_title'),
    icon: path.join(assetsPath, 'icon-red.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#0d1117',
    autoHideMenuBar: true
  });

  const logsHtmlPath = path.join(__dirname, 'logs.html');

  logsWindow.loadFile(logsHtmlPath);

  logsWindow.webContents.on('did-finish-load', async () => {
    try {
      const { stdout } = await runCommand('openclaw logs --limit 100 --no-color');
      logsWindow.webContents.send('logs-data', { logs: stdout, lang: strings });
    } catch (err) {
      logsWindow.webContents.send('logs-data', { logs: null, error: true, lang: strings });
    }
  });

  logsWindow.on('closed', () => { logsWindow = null; });
}

// ─── About Window ───────────────────────────────────────────────────────────
function openAboutWindow() {
  if (aboutWindow) {
    aboutWindow.focus();
    return;
  }

  aboutWindow = new BrowserWindow({
    width: 480,
    height: 520,
    title: t('about_title'),
    icon: path.join(assetsPath, 'icon-red.png'),
    resizable: false,
    maximizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#0d1117',
    autoHideMenuBar: true
  });

  const aboutHtmlPath = path.join(__dirname, 'about.html');

  aboutWindow.loadFile(aboutHtmlPath);

  aboutWindow.webContents.on('did-finish-load', () => {
    let contributors = [];
    try {
      contributors = JSON.parse(fs.readFileSync(contributorsPath, 'utf8'));
    } catch (_) { /* ignore */ }

    aboutWindow.webContents.send('about-data', {
      version: app.getVersion(),
      contributors,
      lang: strings
    });
  });

  aboutWindow.on('closed', () => { aboutWindow = null; });
}

// ─── Tray Menu ──────────────────────────────────────────────────────────────
function buildContextMenu() {
  const availableLocales = getAvailableLocales();

  const pollIntervalSubmenu = [5, 10, 30].map(n => ({
    label: t('seconds', { n }),
    type: 'radio',
    checked: settings.pollInterval === n,
    click: () => {
      settings.pollInterval = n;
      saveSettings(settings);
      startPolling();
    }
  }));

  const languageSubmenu = availableLocales.map(code => ({
    label: localeDisplayName(code),
    type: 'radio',
    checked: settings.language === code,
    click: () => {
      settings.language = code;
      saveSettings(settings);
      strings = loadLocale(code);
      updateTray();
    }
  }));

  const statusLabel = isProcessing
    ? `⏳ ${processingAction}`
    : (isOnline ? t('status_online') : t('status_offline'));

  const statusIcon = isProcessing
    ? getTrayIcon('processing').resize({ width: 16, height: 16 })
    : getTrayIcon(currentVariant()).resize({ width: 16, height: 16 });

  const menuTemplate = [
    { label: statusLabel, enabled: false, icon: statusIcon },
    { type: 'separator' },
    { label: `▶ ${t('start_gateway')}`, click: () => gatewayAction('start'), visible: !isOnline && !isProcessing },
    { label: `🛑 ${t('stop_start_attempt')}`, click: stopGatewayAction, visible: isProcessing && !abortStartAttempt && processingAction === (t('gateway_starting') || 'Gateway start...') },
    { label: `⏹ ${t('stop_gateway')}`, click: () => gatewayAction('stop'), visible: isOnline && !isProcessing },
    { label: `🔄 ${t('restart_gateway')}`, click: () => gatewayAction('restart'), visible: isOnline && !isProcessing },
    { type: 'separator' },
    { label: `📊 ${t('open_dashboard')}`, click: openDashboard, visible: isOnline && !isProcessing },
    { label: `📋 ${t('view_logs')}`, click: openLogsWindow },
    { label: `🔍 ${t('health_check')}`, click: runHealthCheck, visible: isOnline && !isProcessing },
    { type: 'separator' },
    {
      label: `⚙️ ${t('settings')}`,
      submenu: [
        { label: t('poll_interval'), submenu: pollIntervalSubmenu },
        { label: t('language'), submenu: languageSubmenu }
      ]
    },
    { label: `ℹ️ ${t('about')}`, click: openAboutWindow },
    { type: 'separator' },
    { label: `❌ ${t('quit')}`, click: () => { app.isQuitting = true; app.quit(); } }
  ];

  return Menu.buildFromTemplate(menuTemplate);
}

// ─── Tray ───────────────────────────────────────────────────────────────────
function updateTray() {
  if (!tray) return;
  if (!isProcessing) {
    tray.setImage(getTrayIcon(currentVariant()));
  }
  tray.setToolTip(
    isProcessing ? processingAction : (isOnline ? t('tooltip_online') : t('tooltip_offline'))
  );
  tray.setContextMenu(buildContextMenu());
}

async function pollStatus() {
  const wasOnline = isOnline;
  isOnline = await checkGatewayStatus();
  if (isOnline !== wasOnline) {
    updateTray();
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollStatus, settings.pollInterval * 1000);
  pollStatus(); // immediate check
}

// ─── Autostart ──────────────────────────────────────────────────────────────
function ensureAutostart() {
  app.setLoginItemSettings({
    openAtLogin: true,
    path: app.getPath('exe'),
    args: []
  });
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────
app.on('ready', () => {
  // Register IPC handlers
  ipcMain.handle('open-external', (_event, url) => {
    shell.openExternal(url);
  });

  ipcMain.handle('clear-logs', async () => {
    try {
      const logsDir = path.join(os.tmpdir(), 'openclaw');
      if (fs.existsSync(logsDir)) {
        const files = fs.readdirSync(logsDir);
        for (const file of files) {
          if (file.endsWith('.log')) {
            try {
              fs.unlinkSync(path.join(logsDir, file));
            } catch (e) {
              console.error('Failed to delete log file:', file, e);
            }
          }
        }
      }
      return true;
    } catch (e) {
      console.error('Failed to clear logs:', e);
      return false;
    }
  });

  ipcMain.handle('get-lang', () => strings);

  ipcMain.handle('refresh-logs', async () => {
    try {
      const { stdout } = await runCommand('openclaw logs --limit 100 --no-color');
      return { logs: stdout, lang: strings };
    } catch (err) {
      return { logs: null, error: true, lang: strings };
    }
  });

  // Register autostart
  ensureAutostart();

  // Create tray
  tray = new Tray(getTrayIcon('offline'));
  tray.setToolTip(t('tooltip_offline'));
  tray.setContextMenu(buildContextMenu());

  // Double-click on tray opens dashboard
  tray.on('double-click', openDashboard);

  // Start polling
  startPolling();
});

// Prevent app from closing when all windows are closed (keep tray alive)
app.on('window-all-closed', (e) => {
  if (!app.isQuitting) {
    // Do nothing — keep tray alive
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

// Handle second instance — focus existing tray
app.on('second-instance', () => {
  if (tray) {
    showNotification(t('app_name'), 'OpenClaw Status is already running.');
  }
});
