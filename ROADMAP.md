# 🏝️ Dynamic Island Desktop — Project Roadmap & Specification

Dokumen ini adalah acuan utama (blueprint) pengembangan aplikasi **Dynamic Island Desktop** berbasis **Tauri v2** di Windows.

---

## 🎯 1. Visi & Konsep Utama

Membawa pengalaman **Dynamic Island & Dynamic Notch** ke desktop Windows:
- **Nempel di Bezel Atas Layar (`top: 0`)**: Menyatu dengan frame monitor atas lengkap dengan sayap lengkungan (*inverted ears curve*).
- **Non-Intrusif & Smart Auto-Collapse**: Saat tidak aktif/kursor menjauh, widget mengecil sehingga tidak menghalangi jendela kerja atau aplikasi lain.
- **Smart Expand on Hover**: Saat kursor didekatkan ke notch, widget membal membesar (*spring animation*) menampilkan informasi lengkap & kontrol musik.
- **Always on Top**: Tetap terlihat melayang di atas aplikasi lain tanpa border/titlebar window.

---

## 🎨 2. State & Spesifikasi Visual (Berdasarkan Referensi Gambar)

| State | Tampilan | Elemen Visual | Pemicu (Trigger) |
|---|---|---|---|
| **State 1: Idle Eyes** | Kapsul kecil (cute mode) | Dua mata bercahaya putih (*glowing eyes*) dengan animasi kedip (*blink*) dan lirikan | Mode santai / tidak ada musik / idle |
| **State 2: Compact Bar** | Notch tipis aktif | • Indikator ring baterai/status di kiri<br>• Jam digital real-time di tengah (`10:01`)<br>• Waveform visualizer audio bergerak di kanan (`|||`) | Musik sedang berjalan, tapi kursor mouse berada di luar notch |
| **State 3: Expanded Player** | Card melebar ke bawah | • Cover art album rounded<br>• Judul lagu & Artis<br>• Timeline slider (menit terlewat & sisa durasi)<br>• Kontrol media: Previous, Play/Pause, Next<br>• Tombol toggle lirik & pagination dots (`••••`) | Mouse hover / kursor mendekat ke notch |
| **State 4: Expanded Lyrics** | Split card (lebar penuh) | • Sisi kiri: Player ringkas & kontrol<br>• Sisi kanan: Teks lirik yang sedang bernyanyi (*highlighting current line*) | Klik tombol lirik pada mode expanded player |

---

## 🏗️ 3. Arsitektur Teknis

```
dynamic-island/
├── src/                          # FRONTEND (UI & Logika Interaksi)
│   ├── index.html                # Struktur DOM untuk ke-4 state
│   ├── styles.css                # CSS Variables, Bouncy Bezier, Ears SVG Masking
│   ├── main.js                   # State manager, jam real-time, event listener hover
│   └── assets/                   # Ikon & asset
│
└── src-tauri/                    # BACKEND (Rust & OS Integration)
    ├── tauri.conf.json           # Konfigurasi transparent window & always-on-top
    ├── Cargo.toml                # Dependencies Rust (windows crate / SMTC)
    └── src/
        ├── lib.rs                # Handler Tauri commands & window resize listener
        └── media.rs              # Modul integrasi Windows System Media (Spotify/Browser)
```

---

## 🚀 4. Tahapan Pengerjaan (Phase by Phase)

### 📌 Tahap 1: Frontend UI/UX, Komponen & Animasi (SELESAI ✅)
- [x] **Top Notch Attachment**: Posisikan container tepat di `top: 0` dan tambahkan kurva lekukan telinga (*ears curve*) kiri-kanan yang menyatu ke bezel layar.
- [x] **Penyusunan 4 State HTML**:
  - State Eyes (mata kedip dan melirik bercahaya)
  - State Compact (baterai + jam digital real-time + equalizer)
  - State Expanded Player (album art, info, timeline slider, tombol kontrol)
  - State Expanded Lyrics (split player + lirik bersinkronisasi)
- [x] **Animasi Bouncy/Spring CSS**: Halus, responsif, dan terasa organik persis Dynamic Island iOS/macOS dengan kurva kubik `(0.34, 1.4, 0.34, 1)`.
- [x] **Logika Interaksi Frontend (`main.js`)**:
  - Auto-expand saat `mouseenter`, auto-collapse saat `mouseleave`.
  - Jam digital real-time & tanggal lengkap.
  - Mock controller musik interaktif (play/pause toggle, progress timeline jalan, dan tester button).

---

### 📌 Tahap 2: Tauri Window Management & Smart Sizing (SELESAI ✅)
- [x] **Posisi Window Tauri**: Pin window di tengah atas layar (`x: center, y: 0`) saat aplikasi dibuka menggunakan backend Tauri monitor size detection.
- [x] **Smart Resizing & Click-Through Protection**:
  - Command `resize_island` di Rust otomatis menyesuaikan ukuran fisik window Tauri sesuai state (Eyes: 200x56, Compact: 260x60, Player: 500x165, Lyrics: 640x165).
  - Saat compact/idle, area luar notch langsung bebas klik sehingga aplikasi desktop lain (browser, IDE, dll) tidak terhalangi klik mousenya.
  - Saat hover, window membesar seketika agar animasi membal (*spring bounce*) tampil sempurna tanpa clipping.

---

### 📌 Tahap 3: Integrasi Musik Nyata (Windows Media / Spotify API) (SELESAI ✅)
- [x] **Windows Media Transport Controls (SMTC)** di Rust:
  - Otomatis mendeteksi lagu yang sedang diputar di Windows (Spotify, YouTube di browser, Apple Music, Media Player).
  - Mengambil metadata: Judul lagu, artis, durasi, status play/pause, dan posisi timeline secara real-time.
  - Perintah playback langsung: Play/Pause, Next Track, Previous Track berfungsi langsung mengontrol pemutar musik di Windows.
- [x] **Integrasi Lirik Real-Time**:
  - Sinkronisasi lirik otomatis via LRCLIB API dengan baris lirik aktif yang menyala bercahaya mengikuti detik lagu.

---

### 📌 Tahap 4: Polishing, Baterai Laptop & Charging Animation (SELESAI ✅)
- [x] **Integrasi Baterai Laptop Asli**:
  - Menggunakan Win32 `GetSystemPowerStatus` di Rust untuk membaca persentase baterai riil dan status daya AC/charger.
  - Ring indikator baterai melingkar terisi sesuai persentase baterai asli laptop.
- [x] **Banner Notifikasi Cas Baterai (Persis Gambar 1)**:
  - Layout banner 3 kolom: Ring baterai hijau menyala dengan petir `⚡` di kiri, teks `"Charging"` + subtext `"Charger connected"` di tengah, dan persentase baterai besar (misal `"70%"`) di kanan.
  - Otomatis membal membesar saat laptop dicolokkan ke charger!
- [x] **Integrasi TWS / Bluetooth Earbuds Pop-Up (Persis Gambar 2)**:
  - Modul Rust `tws.rs` mendeteksi perangkat TWS/Earbuds Bluetooth yang terhubung aktif ke Windows secara real-time (melalui `AudioEndpoint` dan Windows PnP Property `{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2`).
  - Mengambil **nama asli perangkat** (misal `Soundcore Life Note 3i`) dan **persentase baterai asli** (misal `100%`), bukan nilai hardcoded.
  - **Auto-Hide Jika Tidak Terhubung**: Jika Bluetooth TWS terputus/tidak terkoneksi, seluruh keterangan, dot pagination, dan badge TWS otomatis lenyap tanpa meninggalkan sisa informasi.
  - **Tampilan Real-Time**: TWS banner pop-up identik Gambar 2 saat terhubung, mini badge TWS di header player, dan ring mini di compact bar.
- [x] **Transisi Lirik Halus (Smooth Scrolling)**:
  - Menggunakan `transform: translateY` GPU-accelerated pada viewport lirik dengan Apple-grade edge mask fade, sehingga perpindahan baris lirik mengalir sangat mulus tanpa patah-patah.
- [x] **Ambient Sapphire Glow Aesthetic**:
  - Gradien hitam ke sapphire / deep ocean blue di bagian bawah notch dengan semburat ambient glow halus yang memberi kedalaman estetika mewah.
- [x] **Mata Kucing Predator Elektrik (Global Screen Cursor Tracking)**:
  - Desain mata kucing predator hitam dengan iris biru elektrik neon (`#67e8f9` ke sapphire) bersinar pekat persis seperti referensi foto kucing hitam.
  - Menggunakan Win32 `GetCursorPos` di Rust: pupil mata kucing **melacak kursor mouse secara nyata di mana pun kursor berada di seluruh layar Windows** (bahkan saat kursor sedang berada di luar aplikasi, di browser, game, atau taskbar).

---

## 📝 Catatan Keputusan Desain
1. **Kenapa tidak langsung Rust SMTC?**
   - Supaya feel dan visualnya sudah 100% memuaskan dan enak dilihat terlebih dahulu, lalu dihubungkan dengan data riil tanpa bolak-balik mengubah UI.
2. **Efek Lekukan Bezel**:
   - Menggunakan pseudo element `::before` & `::after` dengan radial gradient masking untuk membuat lengkungan sayap (*ears*) yang menyatu ke atas layar.
