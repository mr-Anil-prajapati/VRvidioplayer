/**
 * Electron Preload Script — Secure API Bridge
 *
 * Exposes a controlled `localVideoAPI` object to the renderer
 * without granting unrestricted filesystem access.
 *
 * Security:
 *   contextIsolation: true
 *   nodeIntegration:  false
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('localVideoAPI', {
  /** Open native file picker for a single .xyz file */
  pickXyzFile: function () {
    return ipcRenderer.invoke('pick-xyz-file');
  },

  /** Open native folder picker */
  pickXyzFolder: function () {
    return ipcRenderer.invoke('pick-xyz-folder');
  },

  /** Scan a folder path for .xyz files */
  scanXyzFolder: function (folderPath) {
    return ipcRenderer.invoke('scan-xyz-folder', folderPath);
  },

  /** Get metadata for a single video file */
  getVideoMetadata: function (filePath) {
    return ipcRenderer.invoke('get-video-metadata', filePath);
  },

  /** Get a streamable local-video:// URL for a file path */
  getLocalVideoUrl: function (filePath) {
    return ipcRenderer.invoke('get-local-video-url', filePath);
  },

  /** Check if a folder exists and is accessible */
  checkFolderExists: function (folderPath) {
    return ipcRenderer.invoke('check-folder-exists', folderPath);
  },
});
