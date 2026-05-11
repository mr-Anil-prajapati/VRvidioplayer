let player = null;
let isVR = true;
let files = [];
let currentIndex = 0;
let currentUrl = null;
let currentObjectUrl = null;
let autoMode = true;
let zoomLevel = 1.0;
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.3;
const ZOOM_MAX = 3.0;
let rotationDeg = 0;

const videoContainer = document.getElementById('video-container');
const playlistEl = document.getElementById('playlist');
const folderPicker = document.getElementById('folderPicker');
const modeBtn = document.getElementById('modeBtn');
const zoomLabelEl = document.getElementById('zoomLabel');
const resBadge = document.getElementById('resBadge');
const inputW = document.getElementById('inputW');
const inputH = document.getElementById('inputH');

const videoExtensions = ['mp4', 'mov', 'webm', 'ogg', 'm4v', 'mkv', 'avi', 'flv', 'wmv', 'ts', '3gp'];

function revokeCurrentObjectUrl() {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
}

function getVideoMime(url, file) {
  if (file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.mov')) return 'video/mp4';
    if (name.endsWith('.mp4')) return 'video/mp4';
    if (name.endsWith('.webm')) return 'video/webm';
    if (name.endsWith('.ogg')) return 'video/ogg';
    if (name.endsWith('.m4v')) return 'video/mp4';
    if (file.type && file.type !== 'video/quicktime') return file.type;
    if (file.type === 'video/quicktime') return 'video/mp4';
  }

  try {
    const ext = (new URL(url, window.location.href).pathname.split('.').pop() || '').toLowerCase();
    switch (ext) {
      case 'mp4': return 'video/mp4';
      case 'webm': return 'video/webm';
      case 'ogg': return 'video/ogg';
      case 'mov': return 'video/mp4';
      case 'm4v': return 'video/mp4';
      default: return 'video/mp4';
    }
  } catch (e) {
    return 'video/mp4';
  }
}

function autoDetectAndResize() {
  if (!autoMode) return;
  const vid = videoContainer.querySelector('video');
  if (!vid) return;

  const checkRes = () => {
    const vw = vid.videoWidth;
    const vh = vid.videoHeight;
    if (!vw || !vh) return;

    resBadge.textContent = `📐 ${vw} × ${vh}`;
    inputW.value = vw;
    inputH.value = vh;

    const section = document.querySelector('.player-section');
    const maxW = section.clientWidth - 20;
    const maxH = section.clientHeight - 20;
    const ratio = vw / vh;

    let fitW = maxW;
    let fitH = fitW / ratio;

    if (fitH > maxH) {
      fitH = maxH;
      fitW = fitH * ratio;
    }

    videoContainer.style.width = Math.floor(fitW) + 'px';
    videoContainer.style.height = Math.floor(fitH) + 'px';
    videoContainer.style.maxWidth = '100%';
    videoContainer.style.maxHeight = '100%';
  };

  if (vid.readyState >= 1) {
    checkRes();
  }
  vid.addEventListener('loadedmetadata', checkRes, { once: true });
}

function initPlayer(url, time = 0) {
  if (player) {
    player.dispose();
    player = null;
  }

  revokeCurrentObjectUrl();
  videoContainer.innerHTML = `
    <video id="player" class="video-js vjs-default-skin vjs-big-play-centered" controls crossorigin="anonymous" playsinline></video>`;

  player = videojs('player', {
    playbackRates: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]
  });

  player.on('ratechange', () => {
    const rate = player.playbackRate();
    const select = document.getElementById('speedSelect');
    if (select && rate) {
      if (![...select.options].some(opt => opt.value == rate)) {
        select.add(new Option(rate + 'x', rate));
      }
      select.value = rate;
    }
  });

  if (isVR) {
    try {
      player.vr({ projection: '360', motionControls: true });
    } catch (error) {
      console.warn('VR plugin not available:', error);
    }
    modeBtn.textContent = '🔄 Normal Mode';
  } else {
    modeBtn.textContent = '🔄 VR 360° Mode';
  }

  if (url) {
    const type = getVideoMime(url);
    player.src(type ? { src: url, type } : { src: url });
    player.ready(() => {
      player.currentTime(time);
      const speed = parseFloat(document.getElementById('speedSelect').value) || 1;
      player.playbackRate(speed);
      player.play().catch(() => {});
      setTimeout(autoDetectAndResize, 400);
    });
  } else {
    player.ready(() => {
      const speed = parseFloat(document.getElementById('speedSelect').value) || 1;
      player.playbackRate(speed);
    });
  }

  player.on('ended', () => {
    currentIndex = (currentIndex + 1) % files.length;
    playVideo(currentIndex);
  });

  player.on('error', () => {
    console.warn('Player error:', player.error());
  });
}

function applyRotation() {
  const vid = videoContainer.querySelector('video');
  const canvas = videoContainer.querySelector('canvas');
  const target = canvas || vid;
  if (!target) return;

  target.style.transition = 'transform 0.3s ease';
  target.style.transform = `scale(${zoomLevel}) rotate(${rotationDeg}deg)`;
  document.getElementById('rotateBtn').textContent = `🔃 Rotate ${rotationDeg}°`;
}

function applyZoom() {
  if (isVR && player && typeof player.vr === 'function') {
    try {
      player.vr().camera.fov = 75 / zoomLevel;
      player.vr().camera.updateProjectionMatrix();
    } catch (e) {
      const c = videoContainer.querySelector('canvas');
      if (c) c.style.transform = `scale(${zoomLevel}) rotate(${rotationDeg}deg)`;
    }
  } else {
    const v = videoContainer.querySelector('video');
    if (v) v.style.transform = `scale(${zoomLevel}) rotate(${rotationDeg}deg)`;
  }
  zoomLabelEl.textContent = `🔍 ${Math.round(zoomLevel * 100)}%`;
}

function applyCustomSize() {
  const w = parseInt(inputW.value, 10);
  const h = parseInt(inputH.value, 10);
  if (!w || !h || w < 200 || h < 100) {
    alert('Sahi size daalo! Min: 200×100');
    return;
  }
  autoMode = false;
  resBadge.textContent = `📐 ${w} × ${h} (manual)`;
  videoContainer.style.width = w + 'px';
  videoContainer.style.height = h + 'px';
  videoContainer.style.maxWidth = '100%';
  videoContainer.style.maxHeight = '100%';
}

function resetToAuto() {
  autoMode = true;
  inputW.value = '';
  inputH.value = '';
  autoDetectAndResize();
}

function togglePlayPause() {
  if (!player) return;
  if (player.paused()) {
    player.play().catch(() => {});
  } else {
    player.pause();
  }
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function sortFiles(arr) {
  const mode = document.getElementById('sortSelect').value;
  return [...arr].sort((a, b) => {
    if (mode === 'name') return a.name.localeCompare(b.name);
    if (mode === 'name-desc') return b.name.localeCompare(a.name);
    if (mode === 'size') return a.size - b.size;
    if (mode === 'size-desc') return b.size - a.size;
    if (mode === 'ext') {
      const ea = a.name.split('.').pop().toLowerCase();
      const eb = b.name.split('.').pop().toLowerCase();
      return ea.localeCompare(eb);
    }
    return 0;
  });
}

function isVideoFile(file) {
  if (file.type.startsWith('video/')) return true;
  const ext = file.name.split('.').pop().toLowerCase();
  return videoExtensions.includes(ext);
}

function buildPlaylist() {
  playlistEl.innerHTML = '';
  files = sortFiles(files);
  files.forEach((file, i) => {
    const item = document.createElement('div');
    item.className = 'video-item';

    const prev = document.createElement('video');
    prev.muted = true;
    prev.loop = true;
    prev.playsInline = true;

    if (file.isUrl) {
      prev.src = file.url;
    } else {
      prev.src = URL.createObjectURL(file);
    }

    item.addEventListener('mouseenter', () => prev.play().catch(() => {}));
    item.addEventListener('mouseleave', () => { prev.pause(); prev.currentTime = 0; });

    const lbl = document.createElement('span');
    lbl.textContent = `${i + 1}. ${file.name}`;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const ext = file.name.split('.').pop().toUpperCase();
    meta.textContent = `${ext}${file.size ? '  •  ' + formatBytes(file.size) : ''}`;

    const btnContainer = document.createElement('div');
    btnContainer.style.display = 'flex';
    btnContainer.style.gap = '6px';
    btnContainer.style.marginTop = '10px';

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = '🗑️';
    deleteBtn.style.fontSize = '12px';
    deleteBtn.style.padding = '6px 10px';
    deleteBtn.style.border = 'none';
    deleteBtn.style.borderRadius = '8px';
    deleteBtn.style.background = '#dc2626';
    deleteBtn.style.color = '#fff';
    deleteBtn.style.cursor = 'pointer';
    deleteBtn.title = 'Delete video';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Delete "${file.name}"?`)) {
        files.splice(i, 1);
        if (currentIndex >= files.length) currentIndex = Math.max(0, files.length - 1);
        buildPlaylist();
        if (files.length > 0) playVideo(currentIndex);
      }
    });

    const replaceBtn = document.createElement('button');
    replaceBtn.textContent = '🔄';
    replaceBtn.style.fontSize = '12px';
    replaceBtn.style.padding = '6px 10px';
    replaceBtn.style.border = 'none';
    replaceBtn.style.borderRadius = '8px';
    replaceBtn.style.background = '#2563eb';
    replaceBtn.style.color = '#fff';
    replaceBtn.style.cursor = 'pointer';
    replaceBtn.title = 'Replace video';
    replaceBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const newRawUrl = prompt('Enter new video URL:', file.isUrl ? file.url : '');
      if (newRawUrl && newRawUrl.trim()) {
        files[i] = {
          name: newRawUrl.split('/').pop() || 'Video from URL',
          url: newRawUrl.trim(),
          size: 0,
          isUrl: true
        };
        buildPlaylist();
        if (i === currentIndex) playVideo(i);
      }
    });

    btnContainer.appendChild(deleteBtn);
    btnContainer.appendChild(replaceBtn);

    item.appendChild(prev);
    item.appendChild(lbl);
    item.appendChild(meta);
    item.appendChild(btnContainer);
    playlistEl.appendChild(item);
    item.addEventListener('click', () => playVideo(i));
  });
  highlightActive(currentIndex);
  document.getElementById('videoCount').textContent = files.length;
}

function playVideo(i) {
  if (!files[i]) return;
  currentIndex = i;
  highlightActive(i);

  if (files[i].isUrl) {
    currentUrl = files[i].url;
    if (player) {
      const type = getVideoMime(currentUrl);
      player.src(type ? { src: currentUrl, type } : { src: currentUrl });
      player.play().catch(() => {});
      setTimeout(autoDetectAndResize, 400);
    } else {
      initPlayer(currentUrl);
    }
  } else {
    revokeCurrentObjectUrl();
    currentUrl = URL.createObjectURL(files[i]);
    currentObjectUrl = currentUrl;
    if (player) {
      const type = getVideoMime(currentUrl, files[i]);
      player.src({ src: currentUrl, type });
      player.play().catch(() => {});
      setTimeout(autoDetectAndResize, 400);
    } else {
      initPlayer(currentUrl);
    }
  }
}

function highlightActive(i) {
  document.querySelectorAll('.video-item').forEach((el, idx) => {
    el.classList.toggle('active', idx === i);
  });
  const activeEl = document.querySelectorAll('.video-item')[i];
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function loadFiles(picked) {
  files = sortFiles(picked);
  document.getElementById('videoCount').textContent = files.length;
  buildPlaylist();
  playVideo(0);
}

async function loadVideoFromUrl(rawUrl) {
  if (!rawUrl) return alert('Enter a URL first.');
  const url = rawUrl.trim();

  try {
    currentUrl = url;
    const type = getVideoMime(url);
    if (player) {
      player.src(type ? { src: url, type } : { src: url });
      player.play().catch(() => {});
      setTimeout(autoDetectAndResize, 400);
    } else {
      initPlayer(url);
    }
  } catch (err) {
    console.error(err);
    alert('Failed to load URL: ' + err.message);
  }
}

async function loadAllVideosFromUrls(rawUrls) {
  const inputs = rawUrls.split('\n').map(u => u.trim()).filter(Boolean);
  if (!inputs.length) return alert('Enter URLs first.');

  const urlFiles = [];
  for (const input of inputs) {
    try {
      const url = new URL(input);
      const pathname = url.pathname;
      const hasExtension = /\.[a-zA-Z0-9]+$/.test(pathname);
      if (!hasExtension && inputs.length === 1) {
        const response = await fetch(input);
        const html = await response.text();
        const videoUrls = extractVideoUrlsFromHtml(html, input);
        videoUrls.forEach(vidUrl => {
          urlFiles.push({ name: vidUrl.split('/').pop(), url: vidUrl, size: 0, isUrl: true });
        });
      } else {
        urlFiles.push({ name: input.split('/').pop() || 'Video from URL', url: input, size: 0, isUrl: true });
      }
    } catch (err) {
      console.error(`Failed to process ${input}:`, err);
      alert(`Failed to load ${input}: ${err.message}`);
    }
  }

  if (urlFiles.length) {
    loadFiles([...files, ...urlFiles]);
  }
}

function extractVideoUrlsFromHtml(html, baseUrl) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const links = doc.querySelectorAll('a[href]');
  const videoUrls = [];
  const videoExts = videoExtensions;

  links.forEach(link => {
    const href = link.getAttribute('href');
    if (href) {
      const ext = href.split('.').pop().toLowerCase();
      if (videoExts.includes(ext)) {
        const fullUrl = new URL(href, baseUrl).href;
        videoUrls.push(fullUrl);
      }
    }
  });
  return videoUrls;
}

function isDirectoryListingUrl(rawUrl) {
  try {
    const url = new URL(rawUrl.trim(), window.location.href);
    const path = url.pathname || '/';
    const hasExtension = /\.[a-zA-Z0-9]+$/.test(path);
    return !hasExtension || path.endsWith('/');
  } catch (e) {
    return false;
  }
}

function handleSearch(event) {
  const term = event.target.value.toLowerCase();
  document.querySelectorAll('.video-item').forEach(item => {
    item.style.display = item.innerText.toLowerCase().includes(term) ? 'flex' : 'none';
  });
}

function handleKeyboardShortcuts(event) {
  if (event.target.closest('input, textarea, select')) return;
  if (!player) return;

  switch (event.key) {
    case ' ': event.preventDefault(); togglePlayPause(); break;
    case 'ArrowRight': if (player) player.currentTime(Math.min(player.duration() || 0, player.currentTime() + 10)); break;
    case 'ArrowLeft': if (player) player.currentTime(Math.max(0, player.currentTime() - 10)); break;
    case 'ArrowUp': if (player) player.volume(Math.min(1, player.volume() + 0.1)); break;
    case 'ArrowDown': if (player) player.volume(Math.max(0, player.volume() - 0.1)); break;
    case 'm': if (player) player.muted(!player.muted()); break;
    case 'f': if (player) player.requestFullscreen?.(); break;
  }
}

document.getElementById('prevBtn').addEventListener('click', () => {
  if (!files.length) return;
  currentIndex = (currentIndex - 1 + files.length) % files.length;
  playVideo(currentIndex);
});
document.getElementById('nextBtn').addEventListener('click', () => {
  if (!files.length) return;
  currentIndex = (currentIndex + 1) % files.length;
  playVideo(currentIndex);
});
document.getElementById('skipBackBtn').addEventListener('click', () => {
  if (player) player.currentTime(Math.max(0, player.currentTime() - 10));
});
document.getElementById('skipFwdBtn').addEventListener('click', () => {
  if (player) player.currentTime(Math.min(player.duration() || 0, player.currentTime() + 10));
});
document.getElementById('speedSelect').addEventListener('change', (e) => {
  if (player) {
    const newSpeed = parseFloat(e.target.value) || 1;
    player.playbackRate(newSpeed);
  }
});
modeBtn.addEventListener('click', () => {
  isVR = !isVR;
  const t = player ? player.currentTime() : 0;
  initPlayer(currentUrl, t);
});

document.getElementById('applyResBtn').addEventListener('click', applyCustomSize);
document.getElementById('fitResBtn').addEventListener('click', resetToAuto);
inputW.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyCustomSize(); });
inputH.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyCustomSize(); });

document.getElementById('scanFolderBtn').addEventListener('click', () => folderPicker.click());
document.getElementById('scanFolderBtn2').addEventListener('click', () => document.getElementById('quickPicker').click());

document.getElementById('quickPicker').addEventListener('change', (e) => {
  const picked = Array.from(e.target.files).filter(isVideoFile);
  if (!picked.length) return alert('No video files selected!');
  loadFiles(picked);
});

folderPicker.addEventListener('change', (e) => {
  const picked = Array.from(e.target.files).filter(isVideoFile);
  if (!picked.length) return alert('No video files found in that folder!');
  loadFiles(picked);
});

document.getElementById('sortSelect').addEventListener('change', () => {
  if (files.length) buildPlaylist();
});

document.getElementById('loadUrlBtn').addEventListener('click', () => {
  const urls = document.getElementById('apiUrlInput').value.split('\n').filter(u => u.trim());
  if (urls.length === 1 && isDirectoryListingUrl(urls[0])) {
    loadAllVideosFromUrls(urls[0]);
  } else if (urls.length === 1) {
    loadVideoFromUrl(urls[0]);
  } else {
    loadAllVideosFromUrls(document.getElementById('apiUrlInput').value);
  }
});

document.getElementById('loadAllBtn').addEventListener('click', () => {
  loadAllVideosFromUrls(document.getElementById('apiUrlInput').value);
});

document.getElementById('apiUrlInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const urls = e.target.value.split('\n').filter(u => u.trim());
    if (urls.length === 1 && isDirectoryListingUrl(urls[0])) {
      loadAllVideosFromUrls(urls[0]);
    } else if (urls.length === 1) {
      loadVideoFromUrl(urls[0]);
    } else {
      loadAllVideosFromUrls(e.target.value);
    }
  }
});

document.getElementById('search').addEventListener('input', handleSearch);
window.addEventListener('resize', () => {
  if (autoMode) autoDetectAndResize();
});
window.addEventListener('keydown', handleKeyboardShortcuts);
window.addEventListener('beforeunload', revokeCurrentObjectUrl);

initPlayer(null);
