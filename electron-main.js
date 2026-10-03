/**
 * Electron Main Process
 * Wraps the existing web player in Electron to enable local .xyz file access.
 * The existing index.html is loaded as-is — no modifications to the web player logic.
 */

const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const { execFile } = require('child_process');

// ══════════════════════════════════════════════════
//  REGISTER CUSTOM PROTOCOL (must be before app.ready)
// ══════════════════════════════════════════════════
protocol.registerSchemesAsPrivileged([{
  scheme: 'local-video',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    stream: true,
    bypassCSP: true,
    corsEnabled: true,
  }
}]);


// ══════════════════════════════════════════════════
//  DETECT VIDEO FORMAT FROM FILE MAGIC BYTES
// ══════════════════════════════════════════════════
function detectVideoMime(filePath) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);

    // MP4 / M4V / MOV — ftyp box at offset 4
    if (buf.toString('ascii', 4, 8) === 'ftyp') return 'video/mp4';
    // WebM / MKV — EBML header
    if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return 'video/webm';
    // AVI — RIFF....AVI
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 11) === 'AVI') return 'video/x-msvideo';
    // OGG
    if (buf.toString('ascii', 0, 4) === 'OggS') return 'video/ogg';
    // FLV
    if (buf.toString('ascii', 0, 3) === 'FLV') return 'video/x-flv';
    // MPEG-TS (sync byte)
    if (buf[0] === 0x47) return 'video/mp2t';
    // MPEG-PS / MPEG
    if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] >= 0xB0) return 'video/mpeg';

    return 'video/mp4'; // safe default
  } catch (e) {
    return 'video/mp4';
  }
}


// ══════════════════════════════════════════════════
//  CREATE WINDOW
// ══════════════════════════════════════════════════
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'VR / Normal Video Player',
    backgroundColor: '#090b10',
    icon: undefined,
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  mainWindow.loadFile('index.html');
  mainWindow.setMenuBarVisibility(false);
}


// ══════════════════════════════════════════════════
//  APP LIFECYCLE
// ══════════════════════════════════════════════════
app.whenReady().then(() => {

  // ── Register local-video:// protocol for streaming files ──
  protocol.handle('local-video', (request) => {
    try {
      let urlPath = decodeURIComponent(new URL(request.url).pathname);
      // Windows: remove leading /  ( /D:/path → D:/path )
      if (process.platform === 'win32' && urlPath.startsWith('/')) {
        urlPath = urlPath.substring(1);
      }
      const filePath = path.normalize(urlPath);

      const stat = fs.statSync(filePath);
      const mime = detectVideoMime(filePath);
      const fileSize = stat.size;
      const rangeHeader = request.headers.get('range');

      if (rangeHeader) {
        // ── Range request (seeking / partial content) ──
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        const nodeStream = fs.createReadStream(filePath, { start, end });

        return new Response(Readable.toWeb(nodeStream), {
          status: 206,
          headers: {
            'Content-Type': mime,
            'Content-Range': 'bytes ' + start + '-' + end + '/' + fileSize,
            'Content-Length': String(chunkSize),
            'Accept-Ranges': 'bytes',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      // ── Full file ──
      const nodeStream = fs.createReadStream(filePath);

      return new Response(Readable.toWeb(nodeStream), {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(fileSize),
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (err) {
      return new Response('File not found: ' + err.message, {
        status: 404,
        headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' },
      });
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});


// ══════════════════════════════════════════════════
//  IPC HANDLERS (secure file-system bridge)
// ══════════════════════════════════════════════════

// Pick a single .xyz file via native dialog
ipcMain.handle('pick-xyz-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Load Local XYZ Video',
    filters: [
      { name: 'XYZ Video Files', extensions: ['xyz'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;

  const filePath = result.filePaths[0];
  try {
    const stat = fs.statSync(filePath);
    const mime = detectVideoMime(filePath);
    return {
      path: filePath,
      name: path.basename(filePath),
      size: stat.size,
      lastModified: stat.mtimeMs,
      mime: mime,
    };
  } catch (e) {
    return null;
  }
});

// Pick a folder via native dialog
ipcMain.handle('pick-xyz-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Video Folder',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// Scan a folder for .xyz files
ipcMain.handle('scan-xyz-folder', async (event, folderPath) => {
  try {
    if (!fs.existsSync(folderPath)) {
      return { error: 'folder_unavailable', files: [] };
    }

    const entries = fs.readdirSync(folderPath);
    const xyzFiles = [];

    for (const entry of entries) {
      if (entry.toLowerCase().endsWith('.xyz')) {
        const fullPath = path.join(folderPath, entry);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isFile()) {
            xyzFiles.push({
              path: fullPath,
              name: entry,
              size: stat.size,
              lastModified: stat.mtimeMs,
              mime: detectVideoMime(fullPath),
            });
          }
        } catch (e) { /* skip unreadable files */ }
      }
    }

    return { error: null, files: xyzFiles };
  } catch (e) {
    return { error: 'folder_unavailable', files: [] };
  }
});

// Get metadata for a single file (with optional ffprobe inspection)
ipcMain.handle('get-video-metadata', async (event, filePath) => {
  try {
    const stat = fs.statSync(filePath);
    const meta = {
      path: filePath,
      name: path.basename(filePath),
      size: stat.size,
      lastModified: stat.mtimeMs,
      mime: detectVideoMime(filePath),
      duration: null,
      width: null,
      height: null,
      fps: null,
      videoCodec: null,
      audioCodec: null,
      container: null,
    };

    // Try FFprobe if available
    try {
      const probeData = await new Promise((resolve) => {
        execFile(
          'ffprobe',
          [
            '-v', 'quiet',
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            filePath,
          ],
          { timeout: 3000 },
          (err, stdout) => {
            if (err || !stdout) return resolve(null);
            try {
              resolve(JSON.parse(stdout));
            } catch (e) {
              resolve(null);
            }
          }
        );
      });

      if (probeData) {
        if (probeData.format) {
          meta.duration = parseFloat(probeData.format.duration) || null;
          meta.container = probeData.format.format_long_name || probeData.format.format_name;
        }
        if (Array.isArray(probeData.streams)) {
          const vStream = probeData.streams.find(s => s.codec_type === 'video');
          if (vStream) {
            meta.videoCodec = vStream.codec_name;
            meta.width = vStream.width;
            meta.height = vStream.height;
            if (vStream.r_frame_rate) {
              const parts = vStream.r_frame_rate.split('/');
              if (parts.length === 2 && parseInt(parts[1], 10) > 0) {
                meta.fps = Math.round(parseInt(parts[0], 10) / parseInt(parts[1], 10));
              }
            }
          }
          const aStream = probeData.streams.find(s => s.codec_type === 'audio');
          if (aStream) {
            meta.audioCodec = aStream.codec_name;
          }
        }
      }
    } catch (probeErr) {
      // FFprobe not available or failed; fallback to basic metadata
    }

    return meta;
  } catch (e) {
    return null;
  }
});

// Build a streamable local-video:// URL for a file path
ipcMain.handle('get-local-video-url', async (event, filePath) => {
  // Encode each path segment to handle special chars (#, ?, etc.)
  const urlPath = filePath.replace(/\\/g, '/');
  const segments = urlPath.split('/');
  const encoded = segments.map(function (seg, i) {
    if (i === 0 && /^[A-Za-z]:$/.test(seg)) return seg;
    return encodeURIComponent(seg);
  }).join('/');
  return 'local-video:///' + encoded;
});

// Check if a folder exists and is accessible
ipcMain.handle('check-folder-exists', async (event, folderPath) => {
  try {
    return fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory();
  } catch (e) {
    return false;
  }
});
