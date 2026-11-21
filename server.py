"""
VR Video Player & OfflineTube - Universal Video Server
Cross-platform: Android (Termux), Windows, Linux, macOS.
Auto-scans drives, internal storage & SD cards without manual uploads.
High-performance HTTP Range streaming (206 Partial Content) with Waitress WSGI.
"""

import os, sys, mimetypes, re, json
from pathlib import Path
from urllib.parse import quote, unquote
from flask import Flask, Response, request, jsonify, send_file, abort

BASE_DIR = Path(__file__).parent.resolve()
app = Flask(__name__, static_folder=str(BASE_DIR), static_url_path='')

VIDEO_EXTS = {'.mp4', '.mkv', '.webm', '.mov', '.m4v', '.3gp', '.avi', '.xyz', '.flv', '.ts'}

# Register MIME types
mimetypes.add_type('video/mp4', '.mp4')
mimetypes.add_type('video/webm', '.webm')
mimetypes.add_type('video/x-matroska', '.mkv')
mimetypes.add_type('video/quicktime', '.mov')
mimetypes.add_type('video/mp4', '.xyz')

CACHED_VIDEOS = []
CACHED_FOLDERS = []

def get_storage_roots():
    """Detect storage locations based on the current operating system."""
    roots = []

    # 1. Android (Termux)
    internal_android = Path("/storage/emulated/0")
    if internal_android.is_dir():
        roots.append(("Internal Storage", internal_android))
    elif Path("/sdcard").is_dir():
        roots.append(("Internal Storage", Path("/sdcard")))

    storage_dir = Path("/storage")
    if storage_dir.is_dir():
        try:
            for p in storage_dir.iterdir():
                if p.name not in ("self", "emulated") and p.is_dir():
                    roots.append((f"SD Card ({p.name})", p))
        except Exception:
            pass

    # 2. Windows Drives
    if sys.platform == 'win32':
        import ctypes
        bitmask = ctypes.windll.kernel32.GetLogicalDrives()
        for letter in 'CDEFGHIJKLMNOPQRSTUVWXYZ':
            if bitmask & 1:
                p = Path(f"{letter}:\\")
                if p.is_dir():
                    roots.append((f"Drive {letter}:", p))
            bitmask >>= 1

    # 3. Linux / macOS
    if not roots:
        home = Path.home()
        for common_folder in ("Videos", "Movies", "Downloads"):
            p = home / common_folder
            if p.is_dir():
                roots.append((f"Home/{common_folder}", p))
        # External mounts
        for media_root in ("/media", "/mnt", "/Volumes"):
            mp = Path(media_root)
            if mp.is_dir():
                try:
                    for sub in mp.iterdir():
                        if sub.is_dir():
                            roots.append((f"External ({sub.name})", sub))
                except Exception:
                    pass

    # Fallback to current directory if nothing found
    if not roots:
        roots.append(("Current Directory", BASE_DIR))

    return roots

def scan_all_videos():
    """Scan all storage roots and group videos folder-wise."""
    global CACHED_VIDEOS, CACHED_FOLDERS
    videos = []
    folder_map = {}
    roots = get_storage_roots()
    vid_id = 1

    for storage_label, root_path in roots:
        try:
            for current_dir, dirs, files in os.walk(str(root_path)):
                # Ignore system / cache directories
                dirs[:] = [
                    d for d in dirs 
                    if not d.startswith('.') and d not in (
                        'System Volume Information', 'LOST.DIR', '.mcs', '$RECYCLE.BIN', 'Windows', 'node_modules'
                    )
                ]
                
                for fname in files:
                    if fname.startswith('.'):
                        continue
                    ext = os.path.splitext(fname)[1].lower()
                    if ext in VIDEO_EXTS:
                        full_path = os.path.join(current_dir, fname)
                        try:
                            fsize = os.path.getsize(full_path)
                        except OSError:
                            fsize = 0
                            
                        folder_name = os.path.basename(current_dir) or "Root"
                        folder_key = f"{folder_name} [{storage_label}]"
                        
                        v_obj = {
                            "id": vid_id,
                            "name": fname,
                            "folder": folder_name,
                            "folder_key": folder_key,
                            "storage": storage_label,
                            "path": full_path,
                            "size": fsize,
                            "url": f"/video?path={quote(full_path)}"
                        }
                        videos.append(v_obj)
                        vid_id += 1
                        
                        folder_map[folder_key] = folder_map.get(folder_key, 0) + 1
        except Exception as e:
            print(f"Error scanning {root_path}: {e}")

    CACHED_VIDEOS = videos
    CACHED_FOLDERS = [
        {"key": k, "name": k, "count": v}
        for k, v in sorted(folder_map.items(), key=lambda x: -x[1])
    ]
    print(f"[VR Player] Scan complete: {len(CACHED_VIDEOS)} videos found in {len(CACHED_FOLDERS)} folders.")

@app.after_request
def add_cors_headers(response):
    response.headers['Access-Control-Allow-Origin'] = '*'
    response.headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS'
    response.headers['Access-Control-Allow-Headers'] = 'Range, Content-Type, Accept-Encoding'
    response.headers['Accept-Ranges'] = 'bytes'
    return response

@app.route("/")
def index():
    html_path = BASE_DIR / "index.html"
    if html_path.is_file():
        return send_file(str(html_path))
    return "<h1>index.html not found</h1>", 404

@app.route("/api/status")
def api_status():
    return jsonify({
        "status": "online",
        "total_videos": len(CACHED_VIDEOS),
        "total_folders": len(CACHED_FOLDERS),
        "roots": [f"{label}: {str(p)}" for label, p in get_storage_roots()]
    })

@app.route("/api/folders")
def api_folders():
    return jsonify({
        "total_videos": len(CACHED_VIDEOS),
        "folders": CACHED_FOLDERS
    })

@app.route("/api/videos")
def api_videos():
    folder = request.args.get("folder", "").strip()
    query = request.args.get("search", "").strip().lower()
    
    result = CACHED_VIDEOS
    if folder and folder != "__ALL__":
        result = [v for v in result if v["folder_key"] == folder or v["folder"] == folder]
    if query:
        result = [v for v in result if query in v["name"].lower()]
        
    return jsonify({
        "count": len(result),
        "videos": result
    })

@app.route("/api/rescan")
def api_rescan():
    scan_all_videos()
    return jsonify({
        "status": "ok",
        "total_videos": len(CACHED_VIDEOS),
        "total_folders": len(CACHED_FOLDERS)
    })

def generate_file_chunks(file_path, start, length, chunk_size=512*1024):
    """Generator yielding file byte ranges in chunks."""
    with open(file_path, "rb") as f:
        f.seek(start)
        remaining = length
        while remaining > 0:
            to_read = min(remaining, chunk_size)
            chunk = f.read(to_read)
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk

@app.route("/video")
def stream_video():
    """Stream video with HTTP Byte-Range support (206 Partial Content)."""
    raw_path = request.args.get("path", "")
    if not raw_path:
        abort(400, "Missing path parameter")
        
    resolved_path = Path(unquote(raw_path)).resolve()
    if not resolved_path.is_file():
        abort(404, "Video file not found")
        
    if resolved_path.suffix.lower() not in VIDEO_EXTS:
        abort(403, "File type not supported")

    file_size = os.path.getsize(resolved_path)
    content_type = mimetypes.guess_type(str(resolved_path))[0] or 'video/mp4'

    range_header = request.headers.get('Range', None)
    if not range_header:
        response = Response(
            generate_file_chunks(str(resolved_path), 0, file_size),
            status=200,
            mimetype=content_type,
            direct_passthrough=True
        )
        response.headers['Content-Length'] = str(file_size)
        response.headers['Accept-Ranges'] = 'bytes'
        return response

    match = re.search(r'bytes=(\d+)-(\d*)', range_header)
    if not match:
        abort(416, "Requested Range Not Satisfiable")

    start = int(match.group(1))
    end = int(match.group(2)) if match.group(2) else file_size - 1

    if start >= file_size or end >= file_size:
        resp = Response(status=416)
        resp.headers['Content-Range'] = f'bytes */{file_size}'
        return resp

    length = end - start + 1
    response = Response(
        generate_file_chunks(str(resolved_path), start, length, chunk_size=512*1024),
        status=206,
        mimetype=content_type,
        direct_passthrough=True
    )
    response.headers['Content-Range'] = f'bytes {start}-{end}/{file_size}'
    response.headers['Content-Length'] = str(length)
    response.headers['Accept-Ranges'] = 'bytes'
    response.headers['Cache-Control'] = 'public, max-age=86400'
    return response

@app.route("/<path:filename>")
def serve_static(filename):
    file_path = (BASE_DIR / filename).resolve()
    if file_path.is_file() and str(file_path).startswith(str(BASE_DIR)):
        return send_file(str(file_path))
    abort(404)

def main():
    print("=" * 50)
    print("  VR Video Player & OfflineTube Server")
    print("=" * 50)
    scan_all_videos()
    
    port = 8080
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        port = int(sys.argv[1])
        
    try:
        from waitress import serve
        print(f"\n[Ready] High-performance Waitress server running on http://0.0.0.0:{port}")
        serve(app, host="0.0.0.0", port=port, threads=8, connection_limit=200, channel_timeout=60)
    except ImportError:
        print(f"\n[Ready] Flask development server running on http://0.0.0.0:{port}")
        app.run(host="0.0.0.0", port=port, threaded=True)

if __name__ == "__main__":
    main()
