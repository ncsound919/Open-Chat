import { app, BrowserWindow, session } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startA2AServer, DEFAULT_A2A_PORT } from './a2aServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mirrors the CSP injected into production index.html (see vite.config.js).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' ws://127.0.0.1:* http://127.0.0.1:* ws://localhost:* http://localhost:* ws://* wss://* https://*",
  "img-src 'self' data: https: http://127.0.0.1:* http://localhost:*",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

let mainWindow;
let a2aServer;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Open Chat',
    icon: path.join(__dirname, '../public/favicon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Enforce a strict CSP for every response the app loads.
  // This covers file:// loads where response headers are not otherwise set.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP],
        'X-Content-Type-Options': ['nosniff'],
        'X-Frame-Options': ['DENY'],
        'Referrer-Policy': ['strict-origin-when-cross-origin'],
      },
    });
  });

  // Production: load the built files.
  mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));

  mainWindow.on('closed', () => { mainWindow = null; });
}

async function startA2AHub() {
  const port = Number(process.env.OPENCHAT_A2A_PORT) || DEFAULT_A2A_PORT;
  try {
    a2aServer = await startA2AServer({
      name: 'Open Chat Hub',
      description:
        'Open-Chat local agent hub — discoverable over the A2A (Agent2Agent) protocol.',
      baseUrl: `http://127.0.0.1:${port}`,
      port,
      skills: [
        {
          id: 'chat',
          name: 'Chat',
          description: 'Send a message to the local Open-Chat agent hub.',
          inputModes: ['text/plain'],
          outputModes: ['text/plain'],
        },
      ],
      executor: async ({ text }) =>
        `Open-Chat Hub received your message (${text.length} chars).`,
    });
    console.log(`[OpenChat] A2A hub listening on http://127.0.0.1:${port}`);
    console.log(
      `[OpenChat] Agent Card: http://127.0.0.1:${port}/.well-known/agent-card.json`
    );
  } catch (err) {
    console.error('[OpenChat] Failed to start A2A hub:', err?.message || err);
  }
}

app.whenReady().then(() => {
  createWindow();
  startA2AHub();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

app.on('will-quit', () => {
  if (a2aServer) {
    a2aServer.close();
    a2aServer = null;
  }
});
