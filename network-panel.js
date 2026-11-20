/**
 * network-panel.js
 * Connects the existing VR Video Player UI to the Python backend.
 * Adds a "Network" tab to the sidebar for:
 *   - Server status + IP display
 *   - D:\ quick scan button
 *   - Folder browser + add-to-scan
 *   - Scan all / scan status
 *   - Network library (paginated, searchable)
 *   - Optional file upload
 * All existing Local/Server tabs and player functionality are untouched.
 */

(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────
  const API       = '';  // same origin – Flask serves everything
  const PAGE_SIZE = 40;

  // ── State ────────────────────────────────────────────────────────────────
  let netVideos    = [];
  let netPage      = 1;
  let netTotal     = 0;
  let netQuery     = '';
  let netSort      = 'name';
  let netOrder     = 'asc';
  let scanPollTimer = null;
  let browserPath  = '';
  let uploadDirs   = [];

  // ── Inject Network Tab into Sidebar ─────────────────────────────────────
  function injectTab() {
    const tabBar = document.querySelector('.sidebar-tabs');
    if (!tabBar || document.getElementById('tabNetwork')) return;

    const tabBtn = document.createElement('button');
    tabBtn.className = 'sidebar-tab';
    tabBtn.id        = 'tabNetwork';
    tabBtn.textContent = '🌐 Network';
    tabBtn.onclick = () => switchTab('network');
    tabBar.appendChild(tabBtn);

    // Register with existing switchTab override
    const origSwitch = window.switchTab;
    window.switchTab = function (tab) {
      const netPanel = document.getElementById('networkPanel');
      if (tab === 'network') {
        document.getElementById('localPanel').style.display  = 'none';
        document.getElementById('serverPanel').classList.remove('visible');
        if (netPanel) netPanel.style.display = 'flex';
        tabBtn.classList.add('active');
        document.getElementById('tabLocal')?.classList.remove('active');
        document.getElementById('tabServer')?.classList.remove('active');
        loadServerInfo();
        loadNetLibrary();
      } else {
        if (netPanel) netPanel.style.display = 'none';
        tabBtn.classList.remove('active');
        origSwitch(tab);
      }
    };
  }

  // ── Inject Network Panel HTML ────────────────────────────────────────────
  function injectPanel() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar || document.getElementById('networkPanel')) return;

    const panel = document.createElement('div');
    panel.id = 'networkPanel';
    panel.style.cssText = 'display:none;flex-direction:column;flex:1;overflow:hidden;';
    panel.innerHTML = `
      <!-- Server Info Bar -->
      <div id="netInfoBar" style="background:#0a1628;padding:10px 12px;border-bottom:1px solid #1e3a5f;flex-shrink:0;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
          <span id="netStatusDot" style="width:10px;height:10px;border-radius:50%;background:#ef4444;display:inline-block;flex-shrink:0;"></span>
          <span id="netStatusTxt" style="font-size:12px;color:#94a3b8;">Checking server...</span>
        </div>
        <div id="netUrlBox" style="font-size:11px;color:#38bdf8;background:#0f1f3a;border:1px solid #1e4a7a;border-radius:6px;padding:5px 8px;word-break:break-all;display:none;">
          📡 <span id="netUrl"></span>
        </div>
      </div>

      <!-- Quick Actions -->
      <div style="padding:10px 12px;background:#080e1c;border-bottom:1px solid #1a2a40;flex-shrink:0;">
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
          <button id="netAddDBtn"   class="net-btn net-btn-primary">💾 Scan D:\\ Drive</button>
          <button id="netScanBtn"   class="net-btn net-btn-secondary">🔄 Scan All</button>
          <button id="netBrowseBtn" class="net-btn net-btn-secondary">📂 Add Folder</button>
          <button id="netUploadBtn" class="net-btn net-btn-secondary">⬆️ Upload</button>
        </div>
        <div id="netScanStatus" style="font-size:11px;color:#64748b;min-height:16px;"></div>
      </div>

      <!-- Search & Sort -->
      <div style="padding:8px 10px;background:#080e1c;border-bottom:1px solid #1a2a40;flex-shrink:0;display:flex;gap:6px;align-items:center;">
        <input id="netSearch" type="text" placeholder="🔍 Search library..." style="flex:1;padding:7px 10px;background:#0f1f3a;border:1px solid #1e3a5f;border-radius:8px;color:#e2e8f0;font-size:12px;outline:none;">
        <select id="netSortSel" style="background:#0f1f3a;color:#e2e8f0;border:1px solid #1e3a5f;border-radius:8px;padding:6px 8px;font-size:11px;">
          <option value="name">A-Z</option>
          <option value="name|desc">Z-A</option>
          <option value="size_bytes|desc">Largest</option>
          <option value="size_bytes">Smallest</option>
          <option value="modified_at|desc">Newest</option>
          <option value="modified_at">Oldest</option>
        </select>
      </div>

      <!-- Library Count -->
      <div id="netLibCount" style="font-size:11px;color:#475569;padding:5px 12px;flex-shrink:0;background:#080e1c;border-bottom:1px solid #111827;"></div>

      <!-- Video List -->
      <div id="netPlaylist" style="flex:1;overflow-y:auto;padding:8px;"></div>

      <!-- Pagination -->
      <div id="netPager" style="display:flex;justify-content:center;gap:8px;padding:8px;background:#080e1c;border-top:1px solid #1a2a40;flex-shrink:0;"></div>

      <!-- Folder Browser Modal -->
      <div id="netBrowserModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;align-items:center;justify-content:center;">
        <div style="background:#0d1828;border:1px solid #1e3a5f;border-radius:14px;width:480px;max-width:96vw;max-height:80vh;display:flex;flex-direction:column;padding:20px;gap:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <h3 style="color:#e2e8f0;font-size:14px;margin:0;">📂 Select Folder to Scan</h3>
            <button id="netBrowserClose" style="background:none;border:none;color:#94a3b8;font-size:18px;cursor:pointer;">✕</button>
          </div>
          <div id="netBrowserPath" style="font-size:11px;color:#64748b;word-break:break-all;"></div>
          <div id="netBrowserList" style="flex:1;overflow-y:auto;max-height:320px;display:flex;flex-direction:column;gap:4px;"></div>
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button id="netBrowserUp"  class="net-btn net-btn-secondary">⬆ Up</button>
            <button id="netBrowserAdd" class="net-btn net-btn-primary">✅ Add This Folder</button>
          </div>
        </div>
      </div>

      <!-- Upload Modal -->
      <div id="netUploadModal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;align-items:center;justify-content:center;">
        <div style="background:#0d1828;border:1px solid #1e3a5f;border-radius:14px;width:440px;max-width:96vw;padding:20px;display:flex;flex-direction:column;gap:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <h3 style="color:#e2e8f0;font-size:14px;margin:0;">⬆️ Upload Video</h3>
            <button id="netUploadClose" style="background:none;border:none;color:#94a3b8;font-size:18px;cursor:pointer;">✕</button>
          </div>
          <div>
            <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px;">Destination folder:</label>
            <select id="netUploadDest" style="width:100%;background:#0f1f3a;color:#e2e8f0;border:1px solid #1e3a5f;border-radius:8px;padding:8px;font-size:12px;"></select>
          </div>
          <div>
            <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px;">Choose video file:</label>
            <input type="file" id="netUploadFile" accept="video/*,.mkv,.avi,.mov,.wmv,.ts,.m4v,.flv,.xyz" style="color:#e2e8f0;font-size:12px;width:100%;">
          </div>
          <div id="netUploadProgress" style="display:none;">
            <div style="background:#1e3a5f;border-radius:99px;height:6px;overflow:hidden;">
              <div id="netUploadBar" style="height:100%;background:linear-gradient(90deg,#2563eb,#7c3aed);width:0%;transition:width 0.3s;"></div>
            </div>
            <div id="netUploadMsg" style="font-size:11px;color:#94a3b8;margin-top:4px;"></div>
          </div>
          <button id="netUploadSubmit" class="net-btn net-btn-primary" style="align-self:flex-end;">⬆️ Upload Now</button>
        </div>
      </div>
    `;
    sidebar.appendChild(panel);
  }

  // ── CSS ──────────────────────────────────────────────────────────────────
  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .net-btn {
        padding: 7px 12px; border: none; border-radius: 999px;
        color: #fff; cursor: pointer; font-size: 12px; font-weight: 700;
        transition: filter 0.2s, transform 0.15s;
      }
      .net-btn:hover { filter: brightness(1.3); transform: translateY(-1px); }
      .net-btn-primary  { background: linear-gradient(135deg,#2563eb,#7c3aed); }
      .net-btn-secondary { background: #1e3a5f; }

      .net-item {
        display: flex; flex-direction: column; padding: 10px 12px;
        border-radius: 12px; margin-bottom: 8px;
        background: rgba(15,30,60,0.7); border: 1px solid rgba(30,74,122,0.4);
        cursor: pointer; transition: background 0.2s, border-color 0.2s, transform 0.2s;
      }
      .net-item:hover { background: rgba(30,58,138,0.5); border-color: #2563eb; transform: translateY(-1px); }
      .net-item.active { border-color: #60a5fa; box-shadow: 0 0 0 2px rgba(96,165,250,0.2); }
      .net-item-name { font-size: 12px; color: #e2e8f0; word-break: break-word; line-height: 1.4; }
      .net-item-meta { font-size: 10px; color: #475569; margin-top: 4px; }

      .net-browser-item {
        display: flex; align-items: center; gap: 8px; padding: 8px 10px;
        border-radius: 8px; cursor: pointer; font-size: 12px; color: #cbd5e1;
        transition: background 0.15s;
      }
      .net-browser-item:hover { background: rgba(37,99,235,0.2); }

      #netPlaylist::-webkit-scrollbar { width: 4px; }
      #netPlaylist::-webkit-scrollbar-track { background: transparent; }
      #netPlaylist::-webkit-scrollbar-thumb { background: #1e3a5f; border-radius: 4px; }
      #netBrowserList::-webkit-scrollbar { width: 4px; }
      #netBrowserList::-webkit-scrollbar-track { background: transparent; }
      #netBrowserList::-webkit-scrollbar-thumb { background: #1e3a5f; border-radius: 4px; }
    `;
    document.head.appendChild(style);
  }

  // ── Format helpers ───────────────────────────────────────────────────────
  function fmtBytes(b) {
    if (!b) return '';
    if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b/1048576).toFixed(1) + ' MB';
    return (b/1073741824).toFixed(2) + ' GB';
  }

  // ── Server info ──────────────────────────────────────────────────────────
  async function loadServerInfo() {
    const dot = document.getElementById('netStatusDot');
    const txt = document.getElementById('netStatusTxt');
    const box = document.getElementById('netUrlBox');
    const url = document.getElementById('netUrl');
    try {
      const res  = await fetch('/api/info');
      const data = await res.json();
      dot.style.background = '#22c55e';
      txt.textContent      = 'Server online • ' + data.hostname;
      url.textContent      = data.url;
      box.style.display    = 'block';
    } catch (e) {
      dot.style.background = '#ef4444';
      txt.textContent      = 'Server offline or not connected via network';
      box.style.display    = 'none';
    }
  }

  // ── Network Library ──────────────────────────────────────────────────────
  async function loadNetLibrary(resetPage) {
    if (resetPage) netPage = 1;
    const list  = document.getElementById('netPlaylist');
    const count = document.getElementById('netLibCount');
    if (!list) return;

    list.innerHTML = '<div style="text-align:center;padding:20px;color:#475569;font-size:12px;">Loading...</div>';

    const [sort, order] = netSort.includes('|') ? netSort.split('|') : [netSort, netOrder];
    const params = new URLSearchParams({
      page: netPage, limit: PAGE_SIZE, sort, order,
    });
    if (netQuery) params.append('q', netQuery);

    try {
      const res  = await fetch('/api/videos?' + params);
      const data = await res.json();
      netVideos = data.videos || [];
      netTotal  = data.total  || 0;

      count.textContent = netTotal + ' video' + (netTotal !== 1 ? 's' : '') + ' in library';

      if (!netVideos.length) {
        list.innerHTML = '<div style="text-align:center;padding:30px;color:#475569;font-size:12px;">No videos found.<br>Click "Scan D:\\ Drive" or "Scan All" to index your videos.</div>';
        renderPager(data.pages || 1);
        return;
      }

      list.innerHTML = '';
      netVideos.forEach((v, idx) => {
        const item = document.createElement('div');
        item.className = 'net-item';
        item.dataset.id = v.id;

        const ext  = (v.extension || '').replace('.','').toUpperCase();
        const size = fmtBytes(v.size_bytes);
        const name = v.name || 'Unknown';

        item.innerHTML =
          '<div class="net-item-name">' + escHtml(name) + '</div>' +
          '<div class="net-item-meta">' + ext + (size ? ' &bull; ' + size : '') + '</div>';

        item.addEventListener('click', () => playNetVideo(v, item));
        list.appendChild(item);
      });

      renderPager(data.pages || 1);
    } catch (e) {
      list.innerHTML = '<div style="text-align:center;padding:30px;color:#ef4444;font-size:12px;">Could not load library. Is the server running?</div>';
    }
  }

  function playNetVideo(v, el) {
    // Highlight active
    document.querySelectorAll('.net-item').forEach(i => i.classList.remove('active'));
    if (el) el.classList.add('active');

    const streamUrl = '/api/stream/' + v.id;

    // Use the existing player from the main page
    if (typeof player !== 'undefined' && player) {
      const mime = getMimeForExt(v.extension || '.mp4');
      player.src({ src: streamUrl, type: mime });
      player.play().catch(() => {});
      if (typeof autoDetectAndResize === 'function') {
        setTimeout(autoDetectAndResize, 400);
      }
    } else if (typeof initPlayer === 'function') {
      initPlayer(streamUrl);
    } else {
      // Fallback — direct src
      const vid = document.querySelector('#video-container video');
      if (vid) vid.src = streamUrl;
    }
  }

  function getMimeForExt(ext) {
    const map = {
      '.mp4':'video/mp4','.mkv':'video/x-matroska','.webm':'video/webm',
      '.avi':'video/x-msvideo','.mov':'video/mp4','.m4v':'video/mp4',
      '.mpg':'video/mpeg','.mpeg':'video/mpeg','.wmv':'video/x-ms-wmv',
      '.flv':'video/x-flv','.ts':'video/mp2t','.3gp':'video/3gpp',
      '.xyz':'video/mp4',
    };
    return map[ext.toLowerCase()] || 'video/mp4';
  }

  function renderPager(pages) {
    const pager = document.getElementById('netPager');
    if (!pager) return;
    pager.innerHTML = '';
    if (pages <= 1) return;

    const btn = (txt, page, disabled) => {
      const b = document.createElement('button');
      b.textContent = txt;
      b.disabled    = disabled;
      b.className   = 'net-btn net-btn-secondary';
      b.style.cssText = 'padding:5px 10px;font-size:11px;' + (disabled ? 'opacity:0.4;cursor:default;' : '');
      b.onclick = () => { netPage = page; loadNetLibrary(); };
      return b;
    };

    pager.appendChild(btn('«', 1, netPage === 1));
    pager.appendChild(btn('‹', netPage - 1, netPage === 1));

    const label = document.createElement('span');
    label.textContent = netPage + ' / ' + pages;
    label.style.cssText = 'font-size:11px;color:#94a3b8;align-self:center;';
    pager.appendChild(label);

    pager.appendChild(btn('›', netPage + 1, netPage === pages));
    pager.appendChild(btn('»', pages, netPage === pages));
  }

  // ── Scan ─────────────────────────────────────────────────────────────────
  async function startScan(dirs) {
    const statusEl = document.getElementById('netScanStatus');
    try {
      const body = dirs ? { dirs } : {};
      const res  = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) { statusEl.textContent = '⚠️ ' + data.error; return; }
      statusEl.textContent = '⏳ Scan started...';
      pollScanStatus();
    } catch (e) {
      statusEl.textContent = '❌ Server not reachable';
    }
  }

  function pollScanStatus() {
    if (scanPollTimer) clearInterval(scanPollTimer);
    scanPollTimer = setInterval(async () => {
      try {
        const res  = await fetch('/api/scan/status');
        const data = await res.json();
        const statusEl = document.getElementById('netScanStatus');
        if (statusEl) statusEl.textContent = (data.running ? '⏳ ' : '✅ ') + data.message;
        if (!data.running) {
          clearInterval(scanPollTimer);
          scanPollTimer = null;
          loadNetLibrary(true);
        }
      } catch (e) {
        clearInterval(scanPollTimer);
        scanPollTimer = null;
      }
    }, 1500);
  }

  // ── Folder Browser ───────────────────────────────────────────────────────
  async function openBrowser(path) {
    const modal = document.getElementById('netBrowserModal');
    modal.style.display = 'flex';
    await browseTo(path || '');
  }

  async function browseTo(path) {
    browserPath = path;
    const pathEl = document.getElementById('netBrowserPath');
    const list   = document.getElementById('netBrowserList');
    if (!pathEl || !list) return;

    pathEl.textContent = path || 'Drives';
    list.innerHTML = '<div style="padding:10px;color:#64748b;font-size:12px;">Loading...</div>';

    try {
      const url = '/api/browse' + (path ? '?path=' + encodeURIComponent(path) : '');
      const res  = await fetch(url);
      const data = await res.json();
      list.innerHTML = '';
      (data.items || []).forEach(item => {
        if (item.type === 'file') return; // only show dirs & drives
        const el = document.createElement('div');
        el.className = 'net-browser-item';
        el.innerHTML = (item.type === 'drive' ? '💽' : '📁') + ' ' + escHtml(item.name);
        el.onclick = () => browseTo(item.path);
        list.appendChild(el);
      });
      if (!list.children.length) {
        list.innerHTML = '<div style="padding:10px;color:#64748b;font-size:12px;">(empty)</div>';
      }
    } catch (e) {
      list.innerHTML = '<div style="padding:10px;color:#ef4444;font-size:12px;">Error loading path</div>';
    }
  }

  async function addBrowserPath() {
    if (!browserPath) return;
    try {
      const res  = await fetch('/api/scan-dirs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: browserPath }),
      });
      const data = await res.json();
      if (data.ok) {
        document.getElementById('netBrowserModal').style.display = 'none';
        const statusEl = document.getElementById('netScanStatus');
        statusEl.textContent = '✅ Added: ' + browserPath + ' — starting scan...';
        await startScan([browserPath]);
      } else {
        alert('Could not add folder: ' + (data.error || 'Unknown error'));
      }
    } catch (e) {
      alert('Server not reachable');
    }
  }

  // ── Upload ───────────────────────────────────────────────────────────────
  async function openUpload() {
    const modal = document.getElementById('netUploadModal');
    modal.style.display = 'flex';
    const destSel = document.getElementById('netUploadDest');
    destSel.innerHTML = '';
    try {
      const res  = await fetch('/api/upload-dirs');
      const data = await res.json();
      uploadDirs = data.dirs || [];
      uploadDirs.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d; opt.textContent = d;
        destSel.appendChild(opt);
      });
    } catch (e) {
      destSel.innerHTML = '<option>Could not load destinations</option>';
    }
  }

  async function submitUpload() {
    const file    = document.getElementById('netUploadFile').files[0];
    const dest    = document.getElementById('netUploadDest').value;
    const prog    = document.getElementById('netUploadProgress');
    const bar     = document.getElementById('netUploadBar');
    const msg     = document.getElementById('netUploadMsg');

    if (!file) { alert('Please select a file first.'); return; }
    if (!dest) { alert('Please select a destination folder.'); return; }

    const form = new FormData();
    form.append('file', file);
    form.append('dest', dest);

    prog.style.display = 'block';
    msg.textContent    = 'Uploading...';
    bar.style.width    = '0%';

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        bar.style.width = pct + '%';
        msg.textContent = 'Uploading... ' + pct + '%';
      }
    };

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (data.ok) {
          msg.textContent    = '✅ Uploaded: ' + data.name;
          bar.style.width    = '100%';
          bar.style.background = '#22c55e';
          setTimeout(() => {
            document.getElementById('netUploadModal').style.display = 'none';
            bar.style.background = 'linear-gradient(90deg,#2563eb,#7c3aed)';
            bar.style.width = '0%';
            prog.style.display = 'none';
            loadNetLibrary(true);
          }, 1500);
        } else {
          msg.textContent = '❌ Error: ' + (data.error || 'Upload failed');
        }
      } catch (e) {
        msg.textContent = '❌ Upload failed';
      }
    };

    xhr.onerror = () => { msg.textContent = '❌ Network error'; };
    xhr.send(form);
  }

  // ── Utilities ────────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Event Binding ────────────────────────────────────────────────────────
  function bindEvents() {
    document.getElementById('netAddDBtn')?.addEventListener('click', () => {
      fetch('/api/add-d-drive', { method: 'POST' })
        .then(r => r.json())
        .then(d => {
          const s = document.getElementById('netScanStatus');
          if (s) s.textContent = '⏳ ' + (d.message || 'Scan started');
          pollScanStatus();
        })
        .catch(() => {
          const s = document.getElementById('netScanStatus');
          if (s) s.textContent = '❌ Server not reachable';
        });
    });

    document.getElementById('netScanBtn')?.addEventListener('click', () => startScan(null));
    document.getElementById('netBrowseBtn')?.addEventListener('click', () => openBrowser(''));
    document.getElementById('netUploadBtn')?.addEventListener('click', openUpload);

    document.getElementById('netBrowserClose')?.addEventListener('click', () => {
      document.getElementById('netBrowserModal').style.display = 'none';
    });
    document.getElementById('netBrowserUp')?.addEventListener('click', async () => {
      if (!browserPath) return;
      const res  = await fetch('/api/browse?path=' + encodeURIComponent(browserPath));
      const data = await res.json();
      if (data.parent && data.parent !== browserPath) {
        browseTo(data.parent);
      } else {
        browseTo('');
      }
    });
    document.getElementById('netBrowserAdd')?.addEventListener('click', addBrowserPath);

    document.getElementById('netUploadClose')?.addEventListener('click', () => {
      document.getElementById('netUploadModal').style.display = 'none';
    });
    document.getElementById('netUploadSubmit')?.addEventListener('click', submitUpload);

    let searchTimer;
    document.getElementById('netSearch')?.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        netQuery = e.target.value.trim();
        loadNetLibrary(true);
      }, 350);
    });

    document.getElementById('netSortSel')?.addEventListener('change', (e) => {
      netSort  = e.target.value;
      netOrder = 'asc';
      loadNetLibrary(true);
    });
  }

  // ── Init ─────────────────────────────────────────────────────────────────
  function init() {
    injectStyles();
    injectTab();
    injectPanel();
    bindEvents();
    // Poll server status every 10 s quietly
    setInterval(loadServerInfo, 10000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
