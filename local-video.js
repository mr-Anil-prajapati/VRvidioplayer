/**
 * local-video.js — Universal Local .XYZ Video Player Integration
 *
 * Provides permission and access to local .xyz video files and folders EVERYWHERE:
 * 1. Electron Desktop App: via native file/folder dialogs and local-video:// streaming
 * 2. Modern Web Browsers (Chrome / Edge / Opera): via File System Access API (showOpenFilePicker & showDirectoryPicker)
 * 3. All other Web Browsers: via HTML5 File and Folder (webkitdirectory) picker fallbacks
 *
 * Keeps existing web player 100% intact without disturbing any existing features.
 */

(function () {
  'use strict';

  // ══════════════════════════════════════════════════
  //  STATE
  // ══════════════════════════════════════════════════
  let xyzFiles = [];
  let xyzFilteredFiles = [];
  let currentXyzIndex = -1;
  let currentXyzFile = null;
  let currentFolderPath = '';
  let browserDirHandle = null;
  let timeUpdateThrottle = 0;

  // Supported video extensions in local picker
  const supportedExtensions = ['xyz', 'mp4', 'mov', 'webm', 'ogg', 'm4v', 'mkv', 'avi'];

  // ══════════════════════════════════════════════════
  //  HELPERS
  // ══════════════════════════════════════════════════
  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  function formatTime(seconds) {
    if (!seconds || isNaN(seconds) || seconds < 0) return '00:00';
    const s = Math.floor(seconds);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    if (hrs > 0) {
      return (
        String(hrs).padStart(2, '0') +
        ':' +
        String(mins).padStart(2, '0') +
        ':' +
        String(secs).padStart(2, '0')
      );
    }
    return String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
  }

  function formatDate(ms) {
    if (!ms) return 'Unknown';
    try {
      const d = new Date(ms);
      return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return 'Unknown';
    }
  }

  async function detectBrowserVideoMime(file) {
    if (!file) return 'video/mp4';
    try {
      // Read first 16 bytes for magic byte format detection
      const slice = file.slice(0, 16);
      const buffer = await slice.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      // MP4 / MOV / M4V (ftyp at offset 4)
      const ascii = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
      if (ascii === 'ftyp') return 'video/mp4';

      // WebM / MKV (EBML: 0x1A 0x45 0xDF 0xA3)
      if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'video/webm';

      // RIFF AVI
      const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
      if (riff === 'RIFF') return 'video/x-msvideo';

      // OGG (OggS)
      if (riff === 'OggS') return 'video/ogg';

      return 'video/mp4'; // Safe default for browser video element
    } catch (e) {
      return 'video/mp4';
    }
  }

  function getSavedPosKey(filePath) {
    return 'xyz_pos_' + encodeURIComponent(filePath);
  }

  function getSavedPosition(filePath) {
    try {
      const val = localStorage.getItem(getSavedPosKey(filePath));
      if (!val) return null;
      const data = JSON.parse(val);
      if (data && typeof data.time === 'number') return data;
      return null;
    } catch (e) {
      return null;
    }
  }

  function savePosition(filePath, time, duration) {
    if (!filePath || isNaN(time) || time < 3) return;
    try {
      localStorage.setItem(
        getSavedPosKey(filePath),
        JSON.stringify({ time: time, duration: duration || 0, date: Date.now() })
      );
    } catch (e) {}
  }

  function clearPosition(filePath) {
    if (!filePath) return;
    try {
      localStorage.removeItem(getSavedPosKey(filePath));
    } catch (e) {}
  }

  // ══════════════════════════════════════════════════
  //  MODAL DIALOGS
  // ══════════════════════════════════════════════════
  function showResumeDialog(fileName, savedSec, onResume, onStartOver) {
    const existing = document.getElementById('xyzResumeModal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'xyz-resume-dialog';
    overlay.id = 'xyzResumeModal';

    overlay.innerHTML = `
      <div class="xyz-resume-content">
        <div class="xyz-resume-title">Resume Playback?</div>
        <div class="xyz-resume-file">${escapeHtml(fileName)}</div>
        <div class="xyz-resume-pos">Last position: ${formatTime(savedSec)}</div>
        <div class="xyz-resume-actions">
          <button class="xyz-btn xyz-btn-primary" id="xyzResumeConfirmBtn">▶ Resume</button>
          <button class="xyz-btn xyz-btn-secondary" id="xyzResumeStartOverBtn">⟲ Start Over</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('xyzResumeConfirmBtn').addEventListener('click', function () {
      overlay.remove();
      onResume();
    });

    document.getElementById('xyzResumeStartOverBtn').addEventListener('click', function () {
      overlay.remove();
      onStartOver();
    });
  }

  function showErrorDialog(message) {
    const existing = document.getElementById('xyzErrorModal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'xyz-error-dialog';
    overlay.id = 'xyzErrorModal';

    overlay.innerHTML = `
      <div class="xyz-error-content">
        <div class="xyz-error-icon">⚠️</div>
        <div class="xyz-error-msg">${escapeHtml(message)}</div>
        <div class="xyz-resume-actions">
          <button class="xyz-btn xyz-btn-secondary" id="xyzErrorOkBtn">OK</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    document.getElementById('xyzErrorOkBtn').addEventListener('click', function () {
      overlay.remove();
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ══════════════════════════════════════════════════
  //  UI INJECTION & INITIALIZATION
  // ══════════════════════════════════════════════════
  function initXyzUI() {
    // 1. Add XYZ Tab in sidebar
    const tabsContainer = document.querySelector('.sidebar-tabs');
    if (tabsContainer && !document.getElementById('tabXyz')) {
      const tabXyz = document.createElement('button');
      tabXyz.className = 'sidebar-tab';
      tabXyz.id = 'tabXyz';
      tabXyz.innerHTML = '💾 XYZ Videos';
      tabXyz.addEventListener('click', function () {
        switchTab('xyz');
      });
      tabsContainer.appendChild(tabXyz);
    }

    // 2. Add "Load Local Video" in top controls bar
    const controlsBar = document.querySelector('.controls-bar');
    const folderPickerBtn = document.getElementById('loadBtn');
    if (controlsBar && !document.getElementById('loadXyzTopBtn')) {
      const topBtn = document.createElement('button');
      topBtn.className = 'ctrl-btn';
      topBtn.id = 'loadXyzTopBtn';
      topBtn.style.background = '#7c3aed';
      topBtn.style.marginLeft = '2px';
      topBtn.title = 'Load a local .xyz video file';
      topBtn.innerHTML = '📂 Load XYZ';
      topBtn.addEventListener('click', handlePickSingleFile);

      if (folderPickerBtn && folderPickerBtn.nextSibling) {
        controlsBar.insertBefore(topBtn, folderPickerBtn.nextSibling);
      } else if (controlsBar) {
        controlsBar.appendChild(topBtn);
      }
    }

    // 3. Add hidden browser fallback inputs for universal browser permission
    if (!document.getElementById('xyzBrowserFileInput')) {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.id = 'xyzBrowserFileInput';
      fileInput.accept = '.xyz,video/*,.mov,.mp4,.webm,.ogg,.m4v,.mkv';
      fileInput.style.display = 'none';
      document.body.appendChild(fileInput);
    }

    if (!document.getElementById('xyzBrowserFolderInput')) {
      const folderInput = document.createElement('input');
      folderInput.type = 'file';
      folderInput.id = 'xyzBrowserFolderInput';
      folderInput.setAttribute('webkitdirectory', '');
      folderInput.setAttribute('directory', '');
      folderInput.setAttribute('multiple', '');
      folderInput.accept = '.xyz,video/*,.mov,.mp4,.webm,.ogg,.m4v,.mkv';
      folderInput.style.display = 'none';
      document.body.appendChild(folderInput);
    }

    // 4. Add XYZ Panel inside .sidebar
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && !document.getElementById('xyzPanel')) {
      const panel = document.createElement('div');
      panel.id = 'xyzPanel';
      panel.style.display = 'none';
      panel.style.flexDirection = 'column';
      panel.style.flex = '1';
      panel.style.overflow = 'hidden';

      panel.innerHTML = `
        <div class="xyz-toolbar">
          <button class="xyz-btn xyz-btn-primary" id="xyzPickFileBtn">📂 Load Local Video</button>
          <button class="xyz-btn xyz-btn-secondary" id="xyzPickFolderBtn">📁 Select Video Folder</button>
        </div>

        <div class="xyz-folder-bar" id="xyzFolderBar" style="display:none;">
          <span class="xyz-folder-path" id="xyzFolderPath" title=""></span>
          <button class="xyz-btn-sm" id="xyzRescanBtn" title="Rescan folder">🔄</button>
        </div>

        <div class="xyz-nav" id="xyzNavBar" style="display:none;">
          <button class="xyz-nav-btn" id="xyzPrevBtn" title="Previous video">⏮</button>
          <span class="xyz-now-playing" id="xyzNowPlaying">No video playing</span>
          <button class="xyz-nav-btn" id="xyzNextBtn" title="Next video">⏭</button>
        </div>

        <input type="text" id="xyzSearch" class="search-bar" placeholder="🔍 Search .xyz videos..." style="display:none;">

        <div class="xyz-sort-bar" id="xyzSortBar" style="display:none;">
          <label>Sort:</label>
          <select id="xyzSortSelect">
            <option value="name-asc">Name (A-Z)</option>
            <option value="name-desc">Name (Z-A)</option>
            <option value="date-desc">Date (Newest)</option>
            <option value="date-asc">Date (Oldest)</option>
            <option value="size-desc">Size (Largest)</option>
            <option value="size-asc">Size (Smallest)</option>
          </select>
          <span class="xyz-count" id="xyzCount">0 videos</span>
        </div>

        <div class="xyz-playlist" id="xyzPlaylist">
          <div class="xyz-empty-state" id="xyzEmptyState">
            <div class="xyz-empty-icon">📁</div>
            <div class="xyz-empty-title">No Local XYZ Videos</div>
            <div class="xyz-empty-desc">Click "Load Local Video" to open a .xyz file, or "Select Video Folder" to scan a folder.</div>
          </div>
        </div>

        <div class="xyz-unavailable" id="xyzUnavailable" style="display:none;">
          <div class="xyz-unavailable-icon">⚠️</div>
          <div class="xyz-unavailable-title">Video folder unavailable.</div>
          <div class="xyz-unavailable-desc">Please reconnect the storage device or select a new folder.</div>
          <div class="xyz-unavailable-actions">
            <button class="xyz-btn xyz-btn-primary" id="xyzRetryFolderBtn">🔄 Retry</button>
            <button class="xyz-btn xyz-btn-secondary" id="xyzChangeFolderBtn">📁 Select New Folder</button>
          </div>
        </div>

        <div class="xyz-metadata" id="xyzMetadata" style="display:none;">
          <div class="xyz-meta-title">Video Metadata</div>
          <div class="xyz-meta-grid" id="xyzMetaGrid"></div>
        </div>
      `;

      sidebar.appendChild(panel);
    }

    // 5. Enhance global switchTab to include 'xyz'
    const origSwitchTab = window.switchTab;
    window.switchTab = function (tab) {
      const localPanel = document.getElementById('localPanel');
      const serverPanel = document.getElementById('serverPanel');
      const xyzPanel = document.getElementById('xyzPanel');
      const tabLocal = document.getElementById('tabLocal');
      const tabServer = document.getElementById('tabServer');
      const tabXyz = document.getElementById('tabXyz');

      if (tab === 'xyz') {
        if (localPanel) localPanel.style.display = 'none';
        if (serverPanel) serverPanel.classList.remove('visible');
        if (xyzPanel) xyzPanel.style.display = 'flex';
        if (tabLocal) tabLocal.classList.remove('active');
        if (tabServer) tabServer.classList.remove('active');
        if (tabXyz) tabXyz.classList.add('active');
      } else {
        if (xyzPanel) xyzPanel.style.display = 'none';
        if (tabXyz) tabXyz.classList.remove('active');
        if (typeof origSwitchTab === 'function') {
          origSwitchTab(tab);
        }
      }
    };

    // 6. Attach event listeners
    const pickFileBtn = document.getElementById('xyzPickFileBtn');
    if (pickFileBtn) pickFileBtn.addEventListener('click', handlePickSingleFile);

    const pickFolderBtn = document.getElementById('xyzPickFolderBtn');
    if (pickFolderBtn) pickFolderBtn.addEventListener('click', handlePickFolder);

    const rescanBtn = document.getElementById('xyzRescanBtn');
    if (rescanBtn) rescanBtn.addEventListener('click', handleRescan);

    const prevBtn = document.getElementById('xyzPrevBtn');
    if (prevBtn) prevBtn.addEventListener('click', handlePrevXyz);

    const nextBtn = document.getElementById('xyzNextBtn');
    if (nextBtn) nextBtn.addEventListener('click', handleNextXyz);

    const searchInput = document.getElementById('xyzSearch');
    if (searchInput) searchInput.addEventListener('input', handleSearch);

    const sortSelect = document.getElementById('xyzSortSelect');
    if (sortSelect) sortSelect.addEventListener('change', handleSort);

    const retryBtn = document.getElementById('xyzRetryFolderBtn');
    if (retryBtn) retryBtn.addEventListener('click', handleRescan);

    const changeFolderBtn = document.getElementById('xyzChangeFolderBtn');
    if (changeFolderBtn) changeFolderBtn.addEventListener('click', handlePickFolder);

    // 7. Connect to existing player hooks
    setupPlayerHooks();

    // 8. Auto-load previously saved folder
    autoLoadSavedFolder();
  }

  // ══════════════════════════════════════════════════
  //  UNIVERSAL FILE & FOLDER PICKERS (Works Everywhere)
  // ══════════════════════════════════════════════════
  async function handlePickSingleFile() {
    // 1. Electron Desktop Environment
    if (window.localVideoAPI) {
      try {
        const fileInfo = await window.localVideoAPI.pickXyzFile();
        if (!fileInfo) return; // User canceled
        addAndPlayFile(fileInfo);
      } catch (err) {
        console.error('Error picking local video file:', err);
        showErrorDialog('Failed to open video file: ' + err.message);
      }
      return;
    }

    // 2. Modern Web Browser: File System Access API
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [
            {
              description: 'XYZ & Video Files',
              accept: {
                'video/*': ['.xyz', '.mp4', '.mov', '.webm', '.ogg', '.m4v', '.mkv', '.avi'],
              },
            },
          ],
          multiple: false,
        });
        if (!handle) return;
        const file = await handle.getFile();
        const mime = await detectBrowserVideoMime(file);
        const fileInfo = {
          name: file.name,
          path: file.name,
          size: file.size,
          lastModified: file.lastModified,
          mime: mime,
          fileObj: file,
          url: URL.createObjectURL(file),
        };
        addAndPlayFile(fileInfo);
        return;
      } catch (err) {
        if (err.name === 'AbortError') return; // User canceled
        console.warn('showOpenFilePicker fallback to file input:', err);
      }
    }

    // 3. Universal Web Browser Fallback: HTML5 file input
    const fileInput = document.getElementById('xyzBrowserFileInput');
    if (fileInput) {
      fileInput.value = '';
      fileInput.onchange = async function (e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const mime = await detectBrowserVideoMime(file);
        const fileInfo = {
          name: file.name,
          path: file.name,
          size: file.size,
          lastModified: file.lastModified,
          mime: mime,
          fileObj: file,
          url: URL.createObjectURL(file),
        };
        addAndPlayFile(fileInfo);
      };
      fileInput.click();
    }
  }

  function addAndPlayFile(fileInfo) {
    const existingIdx = xyzFiles.findIndex(f => f.path === fileInfo.path || f.name === fileInfo.name);
    if (existingIdx >= 0) {
      xyzFiles[existingIdx] = fileInfo;
      currentXyzIndex = existingIdx;
    } else {
      xyzFiles.unshift(fileInfo);
      currentXyzIndex = 0;
    }

    const navBar = document.getElementById('xyzNavBar');
    const searchEl = document.getElementById('xyzSearch');
    const sortBar = document.getElementById('xyzSortBar');
    const playlistEl = document.getElementById('xyzPlaylist');
    const unavailableEl = document.getElementById('xyzUnavailable');

    if (unavailableEl) unavailableEl.style.display = 'none';
    if (navBar) navBar.style.display = 'flex';
    if (searchEl) searchEl.style.display = 'block';
    if (sortBar) sortBar.style.display = 'flex';
    if (playlistEl) playlistEl.style.display = 'block';

    applyFilterAndSort();
    renderPlaylist();
    switchTab('xyz');
    playXyzFile(fileInfo);
  }

  async function handlePickFolder() {
    // 1. Electron Desktop Environment
    if (window.localVideoAPI) {
      try {
        const folderPath = await window.localVideoAPI.pickXyzFolder();
        if (!folderPath) return; // User canceled

        currentFolderPath = folderPath;
        localStorage.setItem('xyz_saved_folder', folderPath);
        switchTab('xyz');
        await scanAndDisplayFolder(folderPath);
      } catch (err) {
        console.error('Error picking folder:', err);
        showErrorDialog('Failed to select folder: ' + err.message);
      }
      return;
    }

    // 2. Modern Web Browser: Directory Picker API
    if (window.showDirectoryPicker) {
      try {
        const dirHandle = await window.showDirectoryPicker({ mode: 'read' });
        if (!dirHandle) return;
        browserDirHandle = dirHandle;
        currentFolderPath = dirHandle.name;
        localStorage.setItem('xyz_saved_folder', dirHandle.name);
        switchTab('xyz');
        await scanBrowserDirHandle(dirHandle);
        return;
      } catch (err) {
        if (err.name === 'AbortError') return; // User canceled
        console.warn('showDirectoryPicker fallback to input:', err);
      }
    }

    // 3. Universal Web Browser Fallback: HTML5 webkitdirectory
    const folderInput = document.getElementById('xyzBrowserFolderInput');
    if (folderInput) {
      folderInput.value = '';
      folderInput.onchange = async function (e) {
        const rawFiles = Array.from(e.target.files || []);
        if (!rawFiles.length) return;

        const filtered = rawFiles.filter(f => {
          const name = f.name.toLowerCase();
          return supportedExtensions.some(ext => name.endsWith('.' + ext)) || f.type.startsWith('video/');
        });

        const folderName = rawFiles[0].webkitRelativePath
          ? rawFiles[0].webkitRelativePath.split('/')[0]
          : 'Selected Folder';

        currentFolderPath = folderName;
        localStorage.setItem('xyz_saved_folder', folderName);
        switchTab('xyz');

        const newFiles = [];
        for (const f of filtered) {
          const mime = await detectBrowserVideoMime(f);
          newFiles.push({
            name: f.name,
            path: f.webkitRelativePath || f.name,
            size: f.size,
            lastModified: f.lastModified,
            mime: mime,
            fileObj: f,
            url: URL.createObjectURL(f),
          });
        }

        xyzFiles = newFiles;
        displayScannedFiles(folderName);
      };
      folderInput.click();
    }
  }

  async function scanBrowserDirHandle(dirHandle) {
    try {
      const found = [];
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
          const name = entry.name.toLowerCase();
          const isSupported = supportedExtensions.some(ext => name.endsWith('.' + ext));
          if (isSupported) {
            try {
              const file = await entry.getFile();
              const mime = await detectBrowserVideoMime(file);
              found.push({
                name: file.name,
                path: dirHandle.name + '/' + file.name,
                size: file.size,
                lastModified: file.lastModified,
                mime: mime,
                fileObj: file,
                url: URL.createObjectURL(file),
              });
            } catch (e) {}
          }
        }
      }

      xyzFiles = found;
      displayScannedFiles(dirHandle.name);
    } catch (err) {
      console.error('Error scanning browser directory handle:', err);
      showErrorDialog('Failed to read folder contents: ' + err.message);
    }
  }

  function displayScannedFiles(folderDisplayName) {
    const unavailableEl = document.getElementById('xyzUnavailable');
    const folderBar = document.getElementById('xyzFolderBar');
    const folderPathEl = document.getElementById('xyzFolderPath');
    const navBar = document.getElementById('xyzNavBar');
    const searchEl = document.getElementById('xyzSearch');
    const sortBar = document.getElementById('xyzSortBar');
    const playlistEl = document.getElementById('xyzPlaylist');

    if (unavailableEl) unavailableEl.style.display = 'none';
    if (folderBar) folderBar.style.display = 'flex';
    if (folderPathEl) {
      folderPathEl.textContent = folderDisplayName;
      folderPathEl.title = folderDisplayName;
    }

    if (xyzFiles.length > 0) {
      if (searchEl) searchEl.style.display = 'block';
      if (sortBar) sortBar.style.display = 'flex';
      if (navBar) navBar.style.display = 'flex';
      if (playlistEl) playlistEl.style.display = 'block';
    } else {
      if (searchEl) searchEl.style.display = 'none';
      if (sortBar) sortBar.style.display = 'none';
      if (navBar) navBar.style.display = 'none';
      if (playlistEl) playlistEl.style.display = 'block';
    }

    applyFilterAndSort();
    renderPlaylist();
  }

  async function handleRescan() {
    if (window.localVideoAPI && currentFolderPath) {
      await scanAndDisplayFolder(currentFolderPath);
      return;
    }

    if (browserDirHandle) {
      await scanBrowserDirHandle(browserDirHandle);
      return;
    }

    if (currentFolderPath) {
      handlePickFolder();
    }
  }

  async function autoLoadSavedFolder() {
    try {
      const savedFolder = localStorage.getItem('xyz_saved_folder');
      if (savedFolder && window.localVideoAPI) {
        currentFolderPath = savedFolder;
        await scanAndDisplayFolder(savedFolder);
      }
    } catch (e) {
      console.warn('Could not auto-load saved folder:', e);
    }
  }

  async function scanAndDisplayFolder(folderPath) {
    if (!window.localVideoAPI) return;

    const unavailableEl = document.getElementById('xyzUnavailable');
    const folderBar = document.getElementById('xyzFolderBar');
    const folderPathEl = document.getElementById('xyzFolderPath');
    const navBar = document.getElementById('xyzNavBar');
    const searchEl = document.getElementById('xyzSearch');
    const sortBar = document.getElementById('xyzSortBar');
    const playlistEl = document.getElementById('xyzPlaylist');

    try {
      const exists = await window.localVideoAPI.checkFolderExists(folderPath);
      if (!exists) {
        if (unavailableEl) unavailableEl.style.display = 'block';
        if (folderBar) folderBar.style.display = 'none';
        if (navBar) navBar.style.display = 'none';
        if (searchEl) searchEl.style.display = 'none';
        if (sortBar) sortBar.style.display = 'none';
        if (playlistEl) playlistEl.style.display = 'none';
        return;
      }

      if (unavailableEl) unavailableEl.style.display = 'none';
      if (folderBar) folderBar.style.display = 'flex';
      if (folderPathEl) {
        folderPathEl.textContent = folderPath;
        folderPathEl.title = folderPath;
      }

      const res = await window.localVideoAPI.scanXyzFolder(folderPath);
      if (res.error) {
        if (unavailableEl) unavailableEl.style.display = 'block';
        if (playlistEl) playlistEl.style.display = 'none';
        return;
      }

      xyzFiles = res.files || [];
      displayScannedFiles(folderPath);
    } catch (err) {
      console.error('Error scanning folder:', err);
      if (unavailableEl) unavailableEl.style.display = 'block';
    }
  }

  function applyFilterAndSort() {
    const searchInput = document.getElementById('xyzSearch');
    const term = searchInput ? searchInput.value.trim().toLowerCase() : '';
    const sortSelect = document.getElementById('xyzSortSelect');
    const sortVal = sortSelect ? sortSelect.value : 'name-asc';

    // 1. Filter
    if (term) {
      xyzFilteredFiles = xyzFiles.filter(f => f.name.toLowerCase().includes(term));
    } else {
      xyzFilteredFiles = [...xyzFiles];
    }

    // 2. Sort
    xyzFilteredFiles.sort((a, b) => {
      switch (sortVal) {
        case 'name-asc':
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
        case 'name-desc':
          return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' });
        case 'date-desc':
          return (b.lastModified || 0) - (a.lastModified || 0);
        case 'date-asc':
          return (a.lastModified || 0) - (b.lastModified || 0);
        case 'size-desc':
          return (b.size || 0) - (a.size || 0);
        case 'size-asc':
          return (a.size || 0) - (b.size || 0);
        default:
          return 0;
      }
    });

    const countEl = document.getElementById('xyzCount');
    if (countEl) {
      countEl.textContent = `${xyzFilteredFiles.length} video${xyzFilteredFiles.length === 1 ? '' : 's'}`;
    }
  }

  function renderPlaylist() {
    const playlistEl = document.getElementById('xyzPlaylist');
    if (!playlistEl) return;

    playlistEl.innerHTML = '';

    if (!xyzFilteredFiles.length) {
      const empty = document.createElement('div');
      empty.className = 'xyz-empty-state';
      empty.innerHTML = `
        <div class="xyz-empty-icon">📂</div>
        <div class="xyz-empty-title">No Videos Found</div>
        <div class="xyz-empty-desc">${
          xyzFiles.length ? 'No matches for search query.' : 'This folder does not contain any matching video files.'
        }</div>
      `;
      playlistEl.appendChild(empty);
      return;
    }

    xyzFilteredFiles.forEach((file, index) => {
      const item = document.createElement('div');
      item.className = 'xyz-item';
      if (currentXyzFile && (currentXyzFile.path === file.path || currentXyzFile.name === file.name)) {
        item.classList.add('active');
      }

      const savedPos = getSavedPosition(file.path || file.name);
      const resumeBadgeHtml =
        savedPos && savedPos.time > 5
          ? `<span class="xyz-resume-badge" title="Saved position">⏱ ${formatTime(savedPos.time)}</span>`
          : '';

      item.innerHTML = `
        <div class="xyz-item-row">
          <div class="xyz-item-num">${index + 1}</div>
          <div class="xyz-item-info">
            <div class="xyz-item-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</div>
            <div class="xyz-item-meta">${formatBytes(file.size)} • ${formatDate(file.lastModified)}</div>
          </div>
          ${resumeBadgeHtml}
        </div>
      `;

      item.addEventListener('click', function () {
        currentXyzIndex = index;
        checkAndPlayXyzFile(file);
      });

      playlistEl.appendChild(item);
    });
  }

  function handleSearch() {
    applyFilterAndSort();
    renderPlaylist();
  }

  function handleSort() {
    applyFilterAndSort();
    renderPlaylist();
  }

  function handlePrevXyz() {
    if (!xyzFilteredFiles.length) return;
    if (currentXyzIndex <= 0) {
      currentXyzIndex = xyzFilteredFiles.length - 1;
    } else {
      currentXyzIndex--;
    }
    checkAndPlayXyzFile(xyzFilteredFiles[currentXyzIndex]);
  }

  function handleNextXyz() {
    if (!xyzFilteredFiles.length) return;
    if (currentXyzIndex >= xyzFilteredFiles.length - 1) {
      currentXyzIndex = 0;
    } else {
      currentXyzIndex++;
    }
    checkAndPlayXyzFile(xyzFilteredFiles[currentXyzIndex]);
  }

  // ══════════════════════════════════════════════════
  //  PLAYBACK & RESUME
  // ══════════════════════════════════════════════════
  function checkAndPlayXyzFile(file) {
    if (!file) return;

    const fileKey = file.path || file.name;
    const savedPos = getSavedPosition(fileKey);

    // Offer resume if saved position > 5 seconds and not finished (< duration - 10s or duration unknown)
    if (savedPos && savedPos.time > 5) {
      if (!savedPos.duration || savedPos.time < savedPos.duration - 10) {
        showResumeDialog(
          file.name,
          savedPos.time,
          function () {
            // Resume
            playXyzFile(file, savedPos.time);
          },
          function () {
            // Start over
            clearPosition(fileKey);
            playXyzFile(file, 0);
          }
        );
        return;
      }
    }

    playXyzFile(file, 0);
  }

  async function playXyzFile(file, startTime = 0) {
    if (!file) return;

    currentXyzFile = file;

    // Update active highlight in playlist
    document.querySelectorAll('.xyz-item').forEach(el => el.classList.remove('active'));
    const items = document.querySelectorAll('.xyz-item');
    if (items[currentXyzIndex]) {
      items[currentXyzIndex].classList.add('active');
      items[currentXyzIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    // Update now-playing indicator
    const nowPlayingEl = document.getElementById('xyzNowPlaying');
    if (nowPlayingEl) {
      nowPlayingEl.textContent = '▶ ' + file.name;
      nowPlayingEl.title = file.path || file.name;
    }

    // Display initial metadata
    updateMetadataDisplay(file, null);

    // In Electron, fetch deep metadata via FFprobe if available
    if (window.localVideoAPI && window.localVideoAPI.getVideoMetadata) {
      window.localVideoAPI
        .getVideoMetadata(file.path)
        .then(function (fullMeta) {
          if (fullMeta && currentXyzFile && currentXyzFile.path === file.path) {
            Object.assign(currentXyzFile, fullMeta);
            updateMetadataDisplay(currentXyzFile, fullMeta.duration);
          }
        })
        .catch(function () {});
    }

    try {
      // Clear previous error dialog
      const prevErr = document.getElementById('xyzErrorModal');
      if (prevErr) prevErr.remove();

      let streamUrl;
      const mime = file.mime || 'video/mp4';

      if (window.localVideoAPI) {
        streamUrl = await window.localVideoAPI.getLocalVideoUrl(file.path);
      } else if (file.fileObj) {
        // Ensure browser Blob URL has explicit video/mp4 MIME type (zero copy slice)
        try {
          const typedBlob = file.fileObj.slice(0, file.fileObj.size, mime);
          streamUrl = URL.createObjectURL(typedBlob);
        } catch (e) {
          streamUrl = URL.createObjectURL(file.fileObj);
        }
        file.url = streamUrl;
      } else if (file.url) {
        streamUrl = file.url;
      } else {
        streamUrl = file.path;
      }

      // Set global player URL (compatible with existing player architecture)
      if (typeof window.currentUrl !== 'undefined') {
        window.currentUrl = streamUrl;
      }

      const p = window.player;
      if (p) {
        // Clear previous error state on player instance
        if (typeof p.error === 'function') {
          p.error(null);
        }

        // Remove crossorigin for local blob/streaming video to prevent CORS rejections
        const vid = document.querySelector('#video-container video');
        if (vid && vid.hasAttribute('crossorigin')) {
          vid.removeAttribute('crossorigin');
        }

        p.src({ src: streamUrl, type: mime });
        p.ready(function () {
          if (startTime > 0) {
            p.currentTime(startTime);
          }
          const speedSelect = document.getElementById('speedSelect');
          const speed = speedSelect ? parseFloat(speedSelect.value) || 1 : 1;
          p.playbackRate(speed);
          p.play().catch(function (e) {
            console.warn('Playback play() was prevented (e.g. autoplay policy):', e);
          });
          if (typeof window.autoDetectAndResize === 'function') {
            setTimeout(window.autoDetectAndResize, 400);
          }
        });
      } else if (typeof window.initPlayer === 'function') {
        window.initPlayer(streamUrl, startTime);
      }
    } catch (err) {
      console.error('Error starting video playback:', err);
      showErrorDialog(
        'Unable to play this local video.\nThe file may contain an unsupported codec/container or may be corrupted.'
      );
    }
  }

  function updateMetadataDisplay(file, durationSec) {
    const metaPanel = document.getElementById('xyzMetadata');
    const grid = document.getElementById('xyzMetaGrid');
    if (!metaPanel || !grid || !file) return;

    metaPanel.style.display = 'block';

    const p = window.player;
    let resStr = file.width && file.height ? `${file.width} × ${file.height}` : 'Detecting...';
    if (p && resStr === 'Detecting...') {
      const vid = document.querySelector('#video-container video');
      if (vid && vid.videoWidth && vid.videoHeight) {
        resStr = `${vid.videoWidth} × ${vid.videoHeight}`;
      }
    }

    let durVal = durationSec || file.duration;
    let durStr = durVal ? formatTime(durVal) : 'Detecting...';

    let extraRows = '';
    if (file.fps) {
      extraRows += `
        <div class="xyz-meta-row">
          <span class="xyz-meta-label">FPS:</span>
          <span class="xyz-meta-value">${file.fps} fps</span>
        </div>`;
    }
    if (file.videoCodec) {
      extraRows += `
        <div class="xyz-meta-row">
          <span class="xyz-meta-label">Codec:</span>
          <span class="xyz-meta-value">${escapeHtml(file.videoCodec)}${file.audioCodec ? ' / ' + escapeHtml(file.audioCodec) : ''}</span>
        </div>`;
    }
    if (file.container) {
      extraRows += `
        <div class="xyz-meta-row">
          <span class="xyz-meta-label">Container:</span>
          <span class="xyz-meta-value">${escapeHtml(file.container)}</span>
        </div>`;
    }

    grid.innerHTML = `
      <div class="xyz-meta-row">
        <span class="xyz-meta-label">File:</span>
        <span class="xyz-meta-value" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
      </div>
      <div class="xyz-meta-row">
        <span class="xyz-meta-label">Size:</span>
        <span class="xyz-meta-value">${formatBytes(file.size)}</span>
      </div>
      <div class="xyz-meta-row">
        <span class="xyz-meta-label">Duration:</span>
        <span class="xyz-meta-value" id="xyzMetaDuration">${durStr}</span>
      </div>
      <div class="xyz-meta-row">
        <span class="xyz-meta-label">Resolution:</span>
        <span class="xyz-meta-value" id="xyzMetaResolution">${resStr}</span>
      </div>
      ${extraRows}
      <div class="xyz-meta-row">
        <span class="xyz-meta-label">Format:</span>
        <span class="xyz-meta-value">${file.mime || 'video/mp4'} (.xyz)</span>
      </div>
      <div class="xyz-meta-row">
        <span class="xyz-meta-label">Location:</span>
        <span class="xyz-meta-value xyz-meta-path" title="${escapeHtml(file.path || file.name)}">${escapeHtml(file.path || file.name)}</span>
      </div>
    `;
  }

  // ══════════════════════════════════════════════════
  //  CONNECT WITH PLAYER EVENTS
  // ══════════════════════════════════════════════════
  function setupPlayerHooks() {
    const interval = setInterval(function () {
      const p = window.player;
      if (!p) return;
      clearInterval(interval);

      // 1. Timeupdate — throttle saving position
      p.on('timeupdate', function () {
        if (!currentXyzFile) return;
        const now = Date.now();
        if (now - timeUpdateThrottle > 3000) {
          timeUpdateThrottle = now;
          const ct = p.currentTime();
          const dur = p.duration();
          if (ct > 3) {
            savePosition(currentXyzFile.path || currentXyzFile.name, ct, dur);
          }
        }
      });

      // 2. Pause — save position
      p.on('pause', function () {
        if (!currentXyzFile) return;
        const ct = p.currentTime();
        const dur = p.duration();
        if (ct > 3) {
          savePosition(currentXyzFile.path || currentXyzFile.name, ct, dur);
        }
      });

      // 3. Loadedmetadata — update duration & resolution
      p.on('loadedmetadata', function () {
        if (!currentXyzFile) return;
        const dur = p.duration();
        const durEl = document.getElementById('xyzMetaDuration');
        if (durEl && dur) durEl.textContent = formatTime(dur);

        const vid = document.querySelector('#video-container video');
        const resEl = document.getElementById('xyzMetaResolution');
        if (resEl && vid && vid.videoWidth) {
          resEl.textContent = `${vid.videoWidth} × ${vid.videoHeight}`;
        }
      });

      // 4. Ended — advance or clear position
      p.on('ended', function () {
        if (!currentXyzFile) return;
        clearPosition(currentXyzFile.path || currentXyzFile.name);

        const loop1Only = typeof window.loop1Only !== 'undefined' ? window.loop1Only : true;
        if (loop1Only) {
          playXyzFile(currentXyzFile, 0);
        } else {
          handleNextXyz();
        }
      });

      // 5. Error handling with smart fallbacks
      p.on('error', function () {
        if (!currentXyzFile) return;
        const err = p.error();
        console.warn('Video.js player error event:', err);

        // Ignore MEDIA_ERR_ABORTED (code 1) — happens during source changes/seeking
        if (err && err.code === 1) return;

        // Fallback 1: Try plain src (without explicit type) to let native browser demuxer handle it
        if (currentXyzFile && !currentXyzFile._triedPlainSrc) {
          currentXyzFile._triedPlainSrc = true;
          console.log('Retrying with direct src (allowing browser native demuxer)...');
          const sUrl = currentXyzFile.url || currentXyzFile.path;
          if (typeof p.error === 'function') p.error(null);
          p.src({ src: sUrl });
          p.play().catch(function () {});
          return;
        }

        // Fallback 2: If VR mode was active and caused issue, fallback to Normal 2D Mode
        if (window.isVR && currentXyzFile && !currentXyzFile._triedNormalMode) {
          currentXyzFile._triedNormalMode = true;
          console.log('Retrying in Normal 2D mode...');
          window.isVR = false;
          if (window.modeBtn) window.modeBtn.textContent = '🔄 VR 360° Mode';
          const sUrl = currentXyzFile.url || currentXyzFile.path;
          if (typeof window.initPlayer === 'function') {
            window.initPlayer(sUrl, p.currentTime() || 0);
            return;
          }
        }

        showErrorDialog(
          'Unable to play this local video.\n\nThe file may contain an unsupported codec/container or may be corrupted.'
        );
      });
    }, 300);

    // Save position before window unloads
    window.addEventListener('beforeunload', function () {
      if (currentXyzFile && window.player) {
        try {
          const ct = window.player.currentTime();
          const dur = window.player.duration();
          if (ct > 3) savePosition(currentXyzFile.path || currentXyzFile.name, ct, dur);
        } catch (e) {}
      }
    });

    // Hook into topbar Next/Prev buttons when XYZ video is active
    const topPrev = document.getElementById('prevBtn');
    const topNext = document.getElementById('nextBtn');
    if (topPrev) {
      topPrev.addEventListener(
        'click',
        function (e) {
          if (currentXyzFile && xyzFilteredFiles.length > 0) {
            e.stopImmediatePropagation();
            handlePrevXyz();
          }
        },
        true
      );
    }
    if (topNext) {
      topNext.addEventListener(
        'click',
        function (e) {
          if (currentXyzFile && xyzFilteredFiles.length > 0) {
            e.stopImmediatePropagation();
            handleNextXyz();
          }
        },
        true
      );
    }
  }

  // ══════════════════════════════════════════════════
  //  BOOTSTRAP
  // ══════════════════════════════════════════════════
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initXyzUI);
  } else {
    initXyzUI();
  }
})();
