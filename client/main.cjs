const { app, BrowserWindow } = require('electron');
const path = require('path');

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    title: "TriggerStudio Controller",
    backgroundColor: '#0c0f17',
    show: false,
    // Add custom framing if wanted, standard frame is fine for reliability, but styled dark
  });

  // Remove default menu bar
  mainWindow.setMenuBarVisibility(false);

  if (isDev) {
    // Wait slightly to ensure dev server is up if launched concurrently
    setTimeout(() => {
      mainWindow.loadURL('http://localhost:5173').catch(() => {
        // Fallback retry
        mainWindow.loadURL('http://localhost:5173');
      });
    }, 500);
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

app.on('ready', createWindow);

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
  if (mainWindow === null) createWindow();
});
