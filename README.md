# 🎬 VR Video Player & OfflineTube
### *The Ultimate Offline YouTube & Immersive VR Media Server*

[![Python](https://img.shields.io/badge/Python-3.8+-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Platform](https://img.shields.io/badge/Platform-Android%20%7C%20Windows%20%7C%20Linux%20%7C%20macOS-blue)](#-cross-platform-support)
[![WebXR](https://img.shields.io/badge/VR-360%C2%B0%20%7C%20Gyroscope%20%7C%20Cinema-FF0055)](#-key-features--benefits)
[![Build APK](https://github.com/mr-Anil-prajapati/VRvidioplayer/actions/workflows/build-apk.yml/badge.svg)](https://github.com/mr-Anil-prajapati/VRvidioplayer/actions/workflows/build-apk.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> **Turn your Android Phone (via Termux) or PC into a high-speed, private Offline YouTube server.** 
> Watch your local videos and SD Card media organized by folder in **Normal Cinema Mode** or **360° Immersive VR Mode** with zero internet, zero buffering, and zero manual uploading!

---

## 🌟 Why VR Video Player & OfflineTube?

| Feature | Regular Video Players | VR Video Player & OfflineTube |
|---|---|---|
| **VR 360° Mode** | ❌ Rare / Extra Apps | ✅ **Built-in 360° spherical projection + Gyroscope tracking** |
| **Video Discovery** | ❌ Manual file selection | ✅ **Auto-scans Phone, SD Card & Hard Drives folder-wise** |
| **YouTube-like UI** | ❌ Boring file trees | ✅ **YouTube playlist view, live hover previews & instant search** |
| **Streaming Speed** | ⚠️ Slow buffering | ✅ **Waitress WSGI + 512 KB Chunked Range Streaming (206)** |
| **Repeat / Loop** | ⚠️ Full playlist loop only | ✅ **Dedicated 'Loop 1 Video' toggle for repeat practice** |
| **Internet Needed?** | ❌ Many require ads/data | ✅ **100% Offline on Localhost or Local Wi-Fi** |

---

## 🚀 Key Features & Benefits

### 🥽 1. Immersive VR 360° & Cinema Mode
* **True 360° Virtual Reality:** One-click toggle between standard high-definition playback and 360° equirectangular VR projection.
* **Gyroscope Head Tracking:** Move your phone or VR headset to look all around the scene naturally.
* **FOV Zoom & Rotation:** Zoom in/out (30% to 300%) and rotate the video 90°, 180°, or 270° for sideways or ceiling viewing.
* **Compatible with Any Headset:** Google Cardboard, Meta Quest, Pico, Apple Vision Pro, or bare phone screen.

### 📂 2. Zero-Upload Automatic Folder Organization
* **No File Uploads Needed:** Never waste time picking individual files.
* **Auto-Discovery:** Automatically scans:
  * 📱 **Android Internal Storage** (`/storage/emulated/0` - Movies, Download, DCIM, WhatsApp)
  * 💾 **External MicroSD Cards** (`/storage/XXXX-XXXX` - songs, recordings, archives)
  * 💻 **PC Hard Drives** (`C:`, `D:`, `E:`, etc.)
* **Folder Dropdown:** Filter by folder instantly (e.g., `video songs [SD Card]`, `Movies`, `Camera`).

### ⚡ 3. High-Speed Range Streaming (No Buffering)
* **Production Waitress WSGI Engine:** 8 concurrent worker threads with persistent HTTP Keep-Alive connections.
* **512 KB Chunked Range Streaming (`206 Partial Content`):** Instant video start times and buttery-smooth seeking/scrubbing across 4K, 1080p, and VR video files.
* **Smart Browser Caching:** Previously watched segments replay instantly without re-downloading.

### 🎬 4. YouTube-Style Sidebar with Live Video Previews
* **On-Demand Animated Previews:** Hover (on PC) or tap (on phone) any video in the sidebar to preview the video live in place.
* **Zero Network Lag:** Previews load strictly on-demand (`preload="none"`), ensuring 100% of bandwidth goes to your active video.
* **Metadata Badges:** Displays video format (`MP4`, `MKV`, `WEBM`), folder source (`[SD Card]`), and file size (`MB/GB`).

### 🛠️ 5. Power User Tools
* **🔁 Loop 1 Video Toggle:** Keep your favorite music video, dance routine, or tutorial playing on continuous repeat with zero gap.
* **⏩ Variable Playback Speed:** Fine-tune audio and video speed from **0.25x** (ultra slow-motion) up to **4.0x** (quick skimming).
* **📐 Auto Resolution Detection:** Automatically reads native resolution (e.g., `1920 × 1080`) and scales the player perfectly. Also supports custom width × height.
* **🔍 Instant Search:** Filter through hundreds of videos in milliseconds.

---

## 📱 How to Use on Android (via Termux)

Run your personal video server directly on your Android phone!

### Step 1: Install Termux & Enable Storage
Open **Termux** on your phone and run:
```bash
termux-setup-storage
pkg update -y && pkg install python git -y
```
*(Tap **Allow** when Android prompts for storage permission)*

### Step 2: Clone & Start Server
```bash
git clone https://github.com/mr-Anil-prajapati/VRvidioplayer.git
cd VRvidioplayer
pip install -r requirements.txt
./start_server.sh
```

### Step 3: Open in Browser
Open Chrome, Firefox, or Samsung Internet on your phone and visit:
👉 **`http://localhost:8080`**

*(To watch from your PC or TV on the same Wi-Fi, open `http://<PHONE_IP>:8080`)*

---

## 💻 How to Use on Windows PC

### Method 1: One-Click Startup (Easiest)
1. Download or clone this repository.
2. Double-click **`START_SERVER.bat`**.
3. It will automatically check dependencies, start the server, and open your browser!

### Method 2: Command Line
```powershell
pip install -r requirements.txt
python server.py 8080
```
Open **`http://localhost:8080/`** in your browser.

---

## 🐧 How to Use on Linux / macOS

```bash
git clone https://github.com/mr-Anil-prajapati/VRvidioplayer.git
cd VRvidioplayer
pip install -r requirements.txt
python3 server.py 8080
```
Open **`http://localhost:8080/`** in your browser.

---

## 📦 Android APK (Native App)

This repository includes a standalone Android App wrapper in the [`android/`](android/) directory.
- Built with Android WebView, hardware acceleration, full-screen immersive sticky mode, and device file-chooser support.
- **Automated Cloud Build:** Every git push triggers the [GitHub Actions APK Workflow](.github/workflows/build-apk.yml) which automatically compiles and publishes `VRVideoPlayer.apk` under **Releases** and **Artifacts**.

To compile locally:
```bash
cd android
./gradlew assembleDebug
```
The APK is generated at `android/app/build/outputs/apk/debug/app-debug.apk`.

---

## 📂 Project Architecture

```text
VRvidioplayer/
├── server.py              # Universal Python streaming server (Waitress + Flask)
├── index.html             # Video Player UI (VR 360, folder selector, VideoJS)
├── style.css              # Dark cinema-grade styling
├── script.js              # Player controls & helper utilities
├── START_SERVER.bat       # 1-Click launcher for Windows
├── start_server.sh        # 1-Click launcher for Termux / Linux
├── requirements.txt       # Python dependencies (flask, waitress)
├── .github/workflows/     # Automated APK build CI/CD
│   └── build-apk.yml
└── android/               # Native Android application source code
    └── app/src/main/
        ├── AndroidManifest.xml
        └── java/com/vrplayer/app/MainActivity.java
```

---

## 🎯 Supported Video Formats

| Container / Extension | Codec Support | Range Streaming |
|---|---|---|
| **`.mp4`** | H.264 / H.265 / AAC | ✅ Full Range Seeking |
| **`.mkv`** | Matroska / VP9 / H.264 | ✅ Supported |
| **`.webm`** | VP8 / VP9 / Opus | ✅ Supported |
| **`.mov`** | Apple QuickTime | ✅ Supported |
| **`.m4v`, `.3gp`, `.avi`, `.ts`** | Standard mobile video | ✅ Supported |
| **`.xyz`** | Custom media container | ✅ Supported |

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!
Feel free to check the [issues page](https://github.com/mr-Anil-prajapati/VRvidioplayer/issues).

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.

---

*Made with ❤️ by [Anil Kumar](https://github.com/mr-Anil-prajapati)*
