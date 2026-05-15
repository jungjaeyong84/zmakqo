"use strict";

const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const { app, BrowserWindow, Menu, shell, globalShortcut } = require("electron");

const IS_PACKAGED = app.isPackaged;
const ROOT_DIR = IS_PACKAGED ? path.join(process.resourcesPath, "app.asar") : path.resolve(__dirname, "..");
const SERVER_CWD = IS_PACKAGED ? process.resourcesPath : ROOT_DIR;
const SERVER_ENTRY = path.join(ROOT_DIR, "server.js");
const SERVER_PORT = Number(process.env.DESKTOP_PORT || process.env.PORT || 3150);
const START_PATH = process.env.DESKTOP_START_PATH || "/dashboard/home";
const START_URL = `http://127.0.0.1:${SERVER_PORT}${START_PATH}`;
const BOOT_TIMEOUT_MS = Number(process.env.DESKTOP_BOOT_TIMEOUT_MS || 60000);

let mainWindow = null;
let serverProcess = null;
let embeddedServerLoaded = false;
let isQuitting = false;

function pingServer(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.setTimeout(1800, () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

async function waitForServer(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await pingServer(url);
    if (ok) return true;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 320));
  }
  return false;
}

function startServerProcess() {
  const env = {
    ...process.env,
    PORT: String(SERVER_PORT),
    HOST: "127.0.0.1",
    PUBLIC_UI_NO_AUTH: process.env.PUBLIC_UI_NO_AUTH || "1",
    DESKTOP_MODE: "1",
  };
  process.env.PORT = env.PORT;
  process.env.HOST = env.HOST;
  process.env.PUBLIC_UI_NO_AUTH = env.PUBLIC_UI_NO_AUTH;
  process.env.DESKTOP_MODE = "1";

  if (IS_PACKAGED) {
    if (embeddedServerLoaded) return;
    // In packaged mode, run the Express server in-process because cwd points to app.asar.
    // Spawning a child with cwd=app.asar fails with ENOTDIR on macOS app bundles.
    require(SERVER_ENTRY);
    embeddedServerLoaded = true;
    return;
  }

  if (serverProcess) return;
  serverProcess = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: SERVER_CWD,
    env,
    stdio: "inherit",
  });
  serverProcess.on("exit", (code, signal) => {
    if (isQuitting) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(
        `document.body.innerHTML = '<pre style="padding:16px;font-family:monospace;">Server stopped (code=${code}, signal=${signal})</pre>';`
      ).catch(() => {});
    }
  });
}

function stopServerProcess() {
  if (IS_PACKAGED) return;
  if (!serverProcess) return;
  try {
    serverProcess.kill("SIGTERM");
  } catch (_) {
    // no-op
  }
  serverProcess = null;
}

function createMenu() {
  const template = [
    {
      label: "DONBEOLJA Local Dashboard",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { role: "front" },
      ],
    },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: "DONBEOLJA Local Dashboard",
    show: false,
    backgroundColor: "#f7f2ea",
    width: 1600,
    height: 980,
    minWidth: 1180,
    minHeight: 760,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    if (String(process.env.DESKTOP_START_MAXIMIZED || "1") !== "0") {
      mainWindow.maximize();
    }
    if (String(process.env.DESKTOP_START_FULLSCREEN || "0") === "1") {
      mainWindow.setFullScreen(true);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function safeLoadURL(url) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    await mainWindow.loadURL(url);
  } catch (error) {
    const message = String(error && error.message ? error.message : error || "");
    if (message.includes("ERR_ABORTED")) return;
    throw error;
  }
}

async function boot() {
  createMenu();
  createWindow();
  startServerProcess();

  const isReady = await waitForServer(START_URL, BOOT_TIMEOUT_MS);
  if (!isReady) {
    await safeLoadURL("data:text/plain,Server%20boot%20timeout");
    return;
  }
  await safeLoadURL(START_URL);
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  stopServerProcess();
});

app.whenReady().then(async () => {
  globalShortcut.register("CommandOrControl+Shift+F", () => {
    if (!mainWindow) return;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });
  await boot();
  app.on("activate", () => {
    if (!BrowserWindow.getAllWindows().length) {
      boot().catch(() => {});
    }
  });
}).catch((error) => {
  console.error("[DESKTOP_BOOT_ERROR]", error);
});
