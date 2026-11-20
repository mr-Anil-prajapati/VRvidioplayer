"""
VR Video Player - Local Network Streaming Server
Run: python server.py            (port 8000)
     python server.py --port 9090
     python server.py --scan      (scan D:\\ on start)
"""
import os, sys, json, socket, sqlite3, mimetypes, threading, argparse, re
from pathlib import Path
from datetime import datetime
from flask import Flask, Response, request, jsonify, send_from_directory, abort, stream_with_context
from flask_cors import CORS

BASE_DIR   = Path(__file__).parent.resolve()
DB_PATH    = BASE_DIR / "video_library.db"
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

VIDEO_EXTENSIONS = {
    '.mp4','.mkv','.mpg','.mpeg','.avi','.mov',
    '.wmv','.webm','.m4v','.flv','.ts','.3gp',
    '.m2ts','.mts','.vob','.ogv','.rm','.rmvb','.xyz'
}
CHUNK_SIZE = 1024 * 1024

app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path='')
CORS(app)

scan_status = {"running": False, "message": "Idle", "found": 0, "scanned_dirs": 0, "last_scan": None}

# ─── DATABASE ────────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS videos (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                path       TEXT    UNIQUE NOT NULL,
                name       TEXT    NOT NULL,
                folder     TEXT    NOT NULL,
                extension  TEXT    NOT NULL,
                size_bytes INTEGER DEFAULT 0,
                modified_at TEXT,
                added_at   TEXT DEFAULT (datetime('now')),
                duration   REAL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS scan_dirs (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                path     TEXT UNIQUE NOT NULL,
                enabled  INTEGER DEFAULT 1,
                added_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS settings (
                key  TEXT PRIMARY KEY,
                value TEXT
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS videos_fts
                USING fts5(name, path, content='videos', content_rowid='id');
        """)
        conn.execute("INSERT OR IGNORE INTO settings(key,value) VALUES ('port','8000'),('autostart','0')")
        conn.commit()

# ─── UTILITIES ───────────────────────────────────────────────────────────────

def get_available_drives():
    drives = []
    if sys.platform == 'win32':
        import ctypes
        bitmask = ctypes.windll.kernel32.GetLogicalDrives()
        for letter in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ':
            if bitmask & 1:
                drives.append(letter + ":\\")
            bitmask >>= 1
    else:
        drives = ['/']
    return [d for d in drives if os.path.exists(d) and os.access(d, os.R_OK)]

def is_video_file(p):
    return Path(p).suffix.lower() in VIDEO_EXTENSIONS

def safe_path_check(file_path):
    try:
        resolved = str(Path(file_path).resolve())
    except Exception:
        return False
    if resolved.startswith(str(UPLOAD_DIR.resolve())):
        return True
    with get_db() as conn:
        rows = conn.execute("SELECT path FROM scan_dirs WHERE enabled=1").fetchall()
    for row in rows:
        try:
            if resolved.startswith(str(Path(row['path']).resolve())):
                return True
        except Exception:
            pass
    return False

def get_lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'

# ─── SCANNING ────────────────────────────────────────────────────────────────

def scan_directory(directory, conn):
    global scan_status
    try:
        for entry in Path(directory).rglob('*'):
            if not entry.is_file() or not is_video_file(entry):
                continue
            try:
                stat = entry.stat()
                mtime = datetime.fromtimestamp(stat.st_mtime).isoformat()
                conn.execute("""
                    INSERT INTO videos(path,name,folder,extension,size_bytes,modified_at)
                    VALUES(?,?,?,?,?,?)
                    ON CONFLICT(path) DO UPDATE SET
                        size_bytes=excluded.size_bytes,
                        modified_at=excluded.modified_at
                """, (str(entry), entry.name, str(entry.parent), entry.suffix.lower(), stat.st_size, mtime))
                scan_status['found'] += 1
                scan_status['message'] = "Scanning... found {} videos".format(scan_status['found'])
            except Exception:
                pass
        conn.commit()
        try:
            conn.execute("INSERT INTO videos_fts(videos_fts) VALUES('rebuild')")
            conn.commit()
        except Exception:
            pass
    except Exception as e:
        print("[scan] Error:", e)

def run_scan(directories):
    global scan_status
    scan_status.update({"running": True, "found": 0, "scanned_dirs": 0, "message": "Starting scan..."})
    conn = get_db()
    for d in directories:
        scan_status['message'] = "Scanning {}...".format(d)
        scan_directory(d, conn)
        scan_status['scanned_dirs'] += 1
    # Remove missing files
    rows = conn.execute("SELECT id, path FROM videos").fetchall()
    removed = 0
    for row in rows:
        if not Path(row['path']).exists():
            conn.execute("DELETE FROM videos WHERE id=?", (row['id'],))
            removed += 1
    if removed:
        conn.commit()
        try:
            conn.execute("INSERT INTO videos_fts(videos_fts) VALUES('rebuild')")
            conn.commit()
        except Exception:
            pass
    conn.close()
    scan_status.update({
        "running": False,
        "last_scan": datetime.now().isoformat(),
        "message": "Scan complete: {} videos found, {} stale removed".format(scan_status['found'], removed)
    })

# ─── STREAMING ───────────────────────────────────────────────────────────────

def _stream_file(file_path):
    try:
        file_size = os.path.getsize(file_path)
    except OSError:
        return abort(404)

    ext = Path(file_path).suffix.lower()
    mime_map = {
        '.mp4':'video/mp4','.mkv':'video/x-matroska','.webm':'video/webm',
        '.avi':'video/x-msvideo','.mov':'video/mp4','.m4v':'video/mp4',
        '.mpg':'video/mpeg','.mpeg':'video/mpeg','.wmv':'video/x-ms-wmv',
        '.flv':'video/x-flv','.ts':'video/mp2t','.3gp':'video/3gpp',
        '.xyz':'video/mp4',
    }
    content_type = mime_map.get(ext, mimetypes.guess_type(file_path)[0] or 'video/mp4')
    range_header = request.headers.get('Range')

    if range_header:
        match = re.match(r'bytes=(\d*)-(\d*)', range_header)
        if not match:
            return abort(416)
        s_str, e_str = match.group(1), match.group(2)
        start = int(s_str) if s_str else 0
        end   = int(e_str) if e_str else file_size - 1
        end   = min(end, file_size - 1)
        length = end - start + 1

        def gen_chunk():
            with open(file_path, 'rb') as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(CHUNK_SIZE, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        return Response(stream_with_context(gen_chunk()), 206, {
            'Content-Range':  'bytes {}-{}/{}'.format(start, end, file_size),
            'Accept-Ranges':  'bytes',
            'Content-Length': str(length),
            'Content-Type':   content_type,
        })
    else:
        def gen_full():
            with open(file_path, 'rb') as f:
                while True:
                    chunk = f.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    yield chunk
        return Response(stream_with_context(gen_full()), 200, {
            'Accept-Ranges':  'bytes',
            'Content-Length': str(file_size),
            'Content-Type':   content_type,
        })

# ─── API ROUTES ──────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return send_from_directory(str(BASE_DIR), 'index.html')

@app.route('/api/info')
def api_info():
    lan_ip = get_lan_ip()
    host   = request.host
    port   = host.split(':')[-1] if ':' in host else '8000'
    return jsonify({"hostname": socket.gethostname(), "lan_ip": lan_ip,
                    "port": port, "url": "http://{}:{}".format(lan_ip, port),
                    "platform": sys.platform, "python": sys.version.split()[0]})

@app.route('/api/drives')
def api_drives():
    return jsonify({"drives": get_available_drives()})

@app.route('/api/scan-dirs', methods=['GET'])
def api_get_scan_dirs():
    with get_db() as conn:
        rows = conn.execute("SELECT id,path,enabled,added_at FROM scan_dirs ORDER BY id").fetchall()
    return jsonify({"dirs": [dict(r) for r in rows]})

@app.route('/api/scan-dirs', methods=['POST'])
def api_add_scan_dir():
    data = request.get_json(force=True) or {}
    path = data.get('path','').strip()
    if not path or not os.path.isdir(path):
        return jsonify({"error": "Invalid or non-existent path"}), 400
    with get_db() as conn:
        conn.execute("INSERT OR IGNORE INTO scan_dirs(path) VALUES(?)", (path,))
        conn.commit()
    return jsonify({"ok": True, "path": path})

@app.route('/api/scan-dirs/<int:dir_id>', methods=['DELETE'])
def api_delete_scan_dir(dir_id):
    with get_db() as conn:
        conn.execute("DELETE FROM scan_dirs WHERE id=?", (dir_id,))
        conn.commit()
    return jsonify({"ok": True})

@app.route('/api/scan-dirs/<int:dir_id>/toggle', methods=['POST'])
def api_toggle_scan_dir(dir_id):
    with get_db() as conn:
        conn.execute("UPDATE scan_dirs SET enabled=1-enabled WHERE id=?", (dir_id,))
        conn.commit()
        row = conn.execute("SELECT enabled FROM scan_dirs WHERE id=?", (dir_id,)).fetchone()
    return jsonify({"ok": True, "enabled": bool(row['enabled']) if row else False})

@app.route('/api/scan', methods=['POST'])
def api_start_scan():
    if scan_status['running']:
        return jsonify({"error": "Scan already running"}), 409
    data     = request.get_json(force=True) or {}
    dirs_req = data.get('dirs')
    if dirs_req:
        directories = [d for d in dirs_req if os.path.isdir(d)]
    else:
        with get_db() as conn:
            rows = conn.execute("SELECT path FROM scan_dirs WHERE enabled=1").fetchall()
        directories = [r['path'] for r in rows]
    if not directories:
        return jsonify({"error": "No directories configured to scan"}), 400
    threading.Thread(target=run_scan, args=(directories,), daemon=True).start()
    return jsonify({"ok": True, "dirs": directories, "message": "Scan started"})

@app.route('/api/scan/status')
def api_scan_status():
    return jsonify(scan_status)

@app.route('/api/videos')
def api_videos():
    q      = request.args.get('q','').strip()
    page   = max(1, int(request.args.get('page', 1)))
    limit  = min(200, max(1, int(request.args.get('limit', 50))))
    ext    = request.args.get('ext','').strip().lower()
    sort   = request.args.get('sort','name')
    order  = request.args.get('order','asc')
    offset = (page-1)*limit

    valid_sorts = {'name','size_bytes','modified_at','added_at'}
    valid_orders = {'asc','desc'}
    sort  = sort  if sort  in valid_sorts  else 'name'
    order = order if order in valid_orders else 'asc'

    with get_db() as conn:
        params = []
        if q:
            sql = """
                SELECT v.id,v.path,v.name,v.folder,v.extension,v.size_bytes,v.modified_at,v.added_at
                FROM videos v JOIN videos_fts f ON v.id=f.rowid
                WHERE videos_fts MATCH ?
            """
            params.append(q+'*')
        else:
            sql = "SELECT id,path,name,folder,extension,size_bytes,modified_at,added_at FROM videos WHERE 1=1"
        if ext:
            e = '.'+ext if not ext.startswith('.') else ext
            sql += " AND extension=?"
            params.append(e)
        if not q:
            sql += " ORDER BY {} {}".format(sort, order)
        sql += " LIMIT ? OFFSET ?"
        params += [limit, offset]
        rows = conn.execute(sql, params).fetchall()

        count_sql, count_params = "SELECT COUNT(*) FROM videos WHERE 1=1", []
        if ext:
            e = '.'+ext if not ext.startswith('.') else ext
            count_sql += " AND extension=?"
            count_params.append(e)
        total = conn.execute(count_sql, count_params).fetchone()[0]

    return jsonify({"videos": [dict(r) for r in rows], "total": total,
                    "page": page, "limit": limit, "pages": max(1,(total+limit-1)//limit)})

@app.route('/api/videos/<int:vid>')
def api_video_info(vid):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM videos WHERE id=?", (vid,)).fetchone()
    return jsonify(dict(row)) if row else abort(404)

@app.route('/api/stream/<int:vid>')
def api_stream(vid):
    with get_db() as conn:
        row = conn.execute("SELECT path FROM videos WHERE id=?", (vid,)).fetchone()
    if not row:
        return abort(404)
    if not safe_path_check(row['path']):
        return abort(403)
    return _stream_file(row['path'])

@app.route('/api/stream-path')
def api_stream_path():
    fp = request.args.get('path','')
    if not fp or not safe_path_check(fp):
        return abort(403)
    return _stream_file(fp)

@app.route('/api/upload', methods=['POST'])
def api_upload():
    if 'file' not in request.files:
        return jsonify({"error": "No file part"}), 400
    file = request.files['file']
    dest = request.form.get('dest', str(UPLOAD_DIR))
    dest_path = Path(dest).resolve()

    allowed = str(dest_path).startswith(str(UPLOAD_DIR.resolve()))
    if not allowed:
        with get_db() as conn:
            for row in conn.execute("SELECT path FROM scan_dirs WHERE enabled=1").fetchall():
                if str(dest_path).startswith(str(Path(row['path']).resolve())):
                    allowed = True
                    break
    if not allowed:
        return jsonify({"error": "Destination not allowed"}), 403

    dest_path.mkdir(parents=True, exist_ok=True)
    filename = Path(file.filename or 'upload.mp4').name
    target   = dest_path / filename
    i = 1
    while target.exists():
        target = dest_path / "{}_{}{}".format(target.stem, i, target.suffix)
        i += 1
    file.save(str(target))

    ext = target.suffix.lower()
    if ext in VIDEO_EXTENSIONS:
        stat  = target.stat()
        mtime = datetime.fromtimestamp(stat.st_mtime).isoformat()
        with get_db() as conn:
            conn.execute("""
                INSERT OR IGNORE INTO videos(path,name,folder,extension,size_bytes,modified_at)
                VALUES(?,?,?,?,?,?)
            """, (str(target), target.name, str(target.parent), ext, stat.st_size, mtime))
            conn.commit()
            try:
                conn.execute("INSERT INTO videos_fts(videos_fts) VALUES('rebuild')")
                conn.commit()
            except Exception:
                pass
    return jsonify({"ok": True, "path": str(target), "name": target.name})

@app.route('/api/upload-dirs')
def api_upload_dirs():
    dirs = [str(UPLOAD_DIR)]
    with get_db() as conn:
        for row in conn.execute("SELECT path FROM scan_dirs WHERE enabled=1").fetchall():
            dirs.append(row['path'])
    return jsonify({"dirs": dirs})

@app.route('/api/add-d-drive', methods=['POST'])
def api_add_d_drive():
    d_drive = 'D:\\'
    if not os.path.isdir(d_drive):
        return jsonify({"error": "D drive not found"}), 404
    with get_db() as conn:
        conn.execute("INSERT OR IGNORE INTO scan_dirs(path) VALUES(?)", (d_drive,))
        conn.commit()
    if not scan_status['running']:
        threading.Thread(target=run_scan, args=([d_drive],), daemon=True).start()
    return jsonify({"ok": True, "message": "D:\\ added and scan started"})

@app.route('/api/browse')
def api_browse():
    path = request.args.get('path','')
    if not path:
        drives = get_available_drives()
        return jsonify({"items": [{"name": d, "path": d, "type": "drive"} for d in drives]})
    base = Path(path)
    if not base.exists() or not base.is_dir():
        return jsonify({"error": "Path not found"}), 404
    items = []
    try:
        for entry in sorted(base.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())):
            try:
                items.append({"name": entry.name, "path": str(entry),
                               "type": "dir" if entry.is_dir() else "file"})
            except Exception:
                pass
    except PermissionError:
        return jsonify({"error": "Permission denied"}), 403
    return jsonify({"items": items, "current": str(base), "parent": str(base.parent)})

@app.route('/api/settings', methods=['GET'])
def api_get_settings():
    with get_db() as conn:
        rows = conn.execute("SELECT key,value FROM settings").fetchall()
    return jsonify({r['key']: r['value'] for r in rows})

@app.route('/api/settings', methods=['POST'])
def api_save_settings():
    data = request.get_json(force=True) or {}
    with get_db() as conn:
        for k,v in data.items():
            conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", (k,str(v)))
        conn.commit()
    return jsonify({"ok": True})

@app.route('/<path:filename>')
def static_files(filename):
    return send_from_directory(str(BASE_DIR), filename)

# ─── STARTUP ─────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='VR Video Player Server')
    parser.add_argument('--port', type=int, default=8000)
    parser.add_argument('--host', default='0.0.0.0')
    parser.add_argument('--scan', action='store_true', help='Start D:\\ scan on launch')
    args = parser.parse_args()

    init_db()

    with get_db() as conn:
        existing = conn.execute("SELECT COUNT(*) FROM scan_dirs").fetchone()[0]
        if existing == 0 and os.path.isdir('D:\\'):
            conn.execute("INSERT OR IGNORE INTO scan_dirs(path) VALUES('D:\\')")
            conn.commit()
            print("[init] D:\\ auto-added to scan directories.")

    if args.scan:
        with get_db() as conn:
            rows = conn.execute("SELECT path FROM scan_dirs WHERE enabled=1").fetchall()
        dirs = [r['path'] for r in rows]
        if dirs:
            threading.Thread(target=run_scan, args=(dirs,), daemon=True).start()

    lan_ip = get_lan_ip()
    print()
    print("=" * 58)
    print("  VR Video Player - Local Network Server")
    print("=" * 58)
    print("  Local  : http://127.0.0.1:{}".format(args.port))
    print("  Network: http://{}:{}  <- open on phone/laptop".format(lan_ip, args.port))
    print("=" * 58)
    print("  Ctrl+C to stop")
    print()

    app.run(host=args.host, port=args.port, threaded=True, use_reloader=False)

if __name__ == '__main__':
    main()
