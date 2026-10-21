// =========================================================
// DYNAMIC ISLAND — LOGIKA INTERAKSI & MEDIA/BATERAI WINDOWS
// Mata Kucing Mengikuti Kursor, Smooth Lyrics, Baterai & Cas
// =========================================================

const island = document.getElementById("island");
const compactClock = document.getElementById("compact-clock");
const playerDateTime = document.getElementById("player-datetime");

// State tracker
let baseCollapsedState = "compact"; // "compact" atau "eyes"
let expandedState = "player";       // "player" atau "lyrics"
let currentState = "compact";
let isHovered = false;
let chargingAlertTimeout = null;

// Media playback state
let isPlaying = false;
let currentSeconds = 0;
let totalSeconds = 0;
let lastTrackTitle = "";
let syncedLyricsData = [];
let lastActiveLyricIndex = -1;

// Battery state tracker
let prevIsCharging = null;

// Tauri API
const invoke = window.__TAURI__?.core?.invoke;

// Peta dimensi window Tauri permanen 600x155 (ZERO RESIZE = ZERO FLICKER)
const sizeMap = {
  eyes: { width: 600, height: 155 },
  compact: { width: 600, height: 155 },
  charging: { width: 600, height: 155 },
  tws: { width: 600, height: 155 },
  volume: { width: 600, height: 155 },
  welcome: { width: 600, height: 155 },
  player: { width: 600, height: 155 },
  lyrics: { width: 600, height: 155 },
};

async function syncTauriWindowSize(state) {
  // Window tetap stabil di 600x155, tidak perlu resize OS
  return;
}

function updateActiveDot(state) {
  const dots = document.querySelectorAll(".pagination-bar .dot");
  dots.forEach((dot) => {
    if (dot.getAttribute("data-view") === state) {
      dot.classList.add("active");
    } else {
      dot.classList.remove("active");
    }
  });
}

function toggleEyesMode() {
  if (currentState === "eyes") {
    baseCollapsedState = "compact";
    setState("compact");
  } else {
    baseCollapsedState = "eyes";
    setState("eyes");
  }
}

// =========================================================
// 1. STATE SWITCHER FUNCTION
// =========================================================
async function setState(newState, syncWindow = true) {
  currentState = newState;
  island.setAttribute("data-state", newState);

  if (newState === "player" || newState === "lyrics") {
    expandedState = newState;
  } else if (
    newState !== "charging" &&
    newState !== "tws" &&
    newState !== "volume" &&
    newState !== "welcome"
  ) {
    baseCollapsedState = newState;
  }

  updateActiveDot(newState);

  if (syncWindow) {
    await syncTauriWindowSize(newState);
  }
}

// =========================================================
// 2. GLOBAL CURSOR HIT-TESTING, CAT-EYES TRACKER & CLICK-THROUGH
// (Window permanen 600x155 tanpa resize OS = BEBAS KEDIP TOTAL!)
// =========================================================
const glowEyesGroup = document.getElementById("glow-eyes-group");
let currentClickThrough = false;
let leaveCollapseTimeout = null;

let tuckedHoverDwellTimeout = null;
let isTuckedHovered = false;
let lastIsFullScreenApp = false;
let fullscreenTuckTimeout = null;
let isDismissingBanner = false;
let isTwsConnecting = false;
let twsActiveUntil = 0;
let twsConnectedSuppressionTimer = null;

function dismissTemporaryBanner() {
  if (isDismissingBanner) return;
  isDismissingBanner = true;

  if (lastIsFullScreenApp && !isHovered) {
    // Mode Fullscreen: Langsung meluncur naik ke bezel atas (tuck) tanpa ganti halaman!
    island.classList.add("tucked-notch");
    setClickThrough(true);

    // Tunggu sampai animasi tuck selesai (450ms) dan notch sudah 100% tersembunyi di balik bezel:
    setTimeout(() => {
      currentState = baseCollapsedState;
      island.setAttribute("data-state", baseCollapsedState);
      updateActiveDot(baseCollapsedState);
      isDismissingBanner = false;
    }, 450);
  } else {
    // Mode Desktop: transisi morph langsung kembali ke compact/baseCollapsedState
    isDismissingBanner = false;
    setState(baseCollapsedState, false);
  }
}

function setClickThrough(ignore) {
  if (currentClickThrough === ignore || !invoke) return;
  currentClickThrough = ignore;
  invoke("set_click_through", { ignore }).catch(() => {});
}

async function pollGlobalCursor() {
  if (!invoke) return;

  try {
    const info = await invoke("get_eye_tracker_info");
    if (!info) return;

    const scaleFactor = (info.window_width / 600) || 1.0;
    const cursorLocalX = (info.cursor_x - info.window_x) / scaleFactor;
    const cursorLocalY = (info.cursor_y - info.window_y) / scaleFactor;

    const isFullScreenApp = Boolean(info.is_foreground_fullscreen || info.is_foreground_maximized);
    lastIsFullScreenApp = isFullScreenApp;

    const isTemporaryBanner = (
      !isDismissingBanner && (
        currentState === "volume" ||
        currentState === "tws" ||
        currentState === "charging" ||
        currentState === "welcome"
      )
    );

    const isTucked = island.classList.contains("tucked-notch");
    const rect = island.getBoundingClientRect();

    // Area target Dynamic Island di tengah atas layar:
    // Disesuaikan agar responsif saat digeser bolak-balik (lebar 160px: 220..380, tinggi 10px dari atas)
    // dan tetap menyisakan ruang luas bagi tab browser di bawahnya (Y >= 14px)!
    const isOverNotchTarget = (
      cursorLocalX >= 220 &&
      cursorLocalX <= 380 &&
      cursorLocalY >= -8 &&
      cursorLocalY <= 10
    );

    const satBubble = document.getElementById("satellite-bubble");
    let isOverSatellite = false;
    if (satBubble && !satBubble.classList.contains("hidden")) {
      const satRect = satBubble.getBoundingClientRect();
      isOverSatellite = (
        cursorLocalX >= satRect.left - 6 &&
        cursorLocalX <= satRect.right + 6 &&
        cursorLocalY >= -8 &&
        cursorLocalY <= satRect.bottom + 8
      );
    }

    // Jika sedang terbuka: ikuti ukuran bounding box yang sedang aktif dengan margin aman
    const isOverActiveIsland = (
      (
        cursorLocalX >= rect.left - 8 &&
        cursorLocalX <= rect.right + 8 &&
        cursorLocalY >= -8 &&
        cursorLocalY <= rect.bottom + 8
      ) || isOverSatellite
    );

    // Responsif di segala kondisi: baik saat tucked maupun sedang transisi membuka!
    const isCursorTargetingIsland = isOverNotchTarget || isOverActiveIsland;

    // =========================================================
    // KONDISI 1: SAAT MODE FULLSCREEN / MAXIMIZED
    // =========================================================
    if (isFullScreenApp) {
      if (isTemporaryBanner) {
        // SEDANG ADA NOTIFIKASI SEMENTARA (VOLUME / TWS / CHARGER / WELCOME):
        // Wajib muncul beberapa detik di fullscreen sesuai permintaan user!
        if (leaveCollapseTimeout) {
          clearTimeout(leaveCollapseTimeout);
          leaveCollapseTimeout = null;
        }
        if (fullscreenTuckTimeout) {
          clearTimeout(fullscreenTuckTimeout);
          fullscreenTuckTimeout = null;
        }
        island.classList.remove("tucked-notch");
        setClickThrough(!isOverActiveIsland);
      } else if (isCursorTargetingIsland) {
        // Kursor diarahkan ke arah dynamic island -> LANGSUNG MUNCUL TANPA DELAY!
        if (leaveCollapseTimeout) {
          clearTimeout(leaveCollapseTimeout);
          leaveCollapseTimeout = null;
        }
        if (fullscreenTuckTimeout) {
          clearTimeout(fullscreenTuckTimeout);
          fullscreenTuckTimeout = null;
        }
        island.classList.remove("tucked-notch");
        setClickThrough(false);
      } else {
        // Kursor keluar dari dynamic island -> Beri jeda 160ms agar transisi hilang super halus saat digeser bolak-balik
        if (!fullscreenTuckTimeout && !island.classList.contains("tucked-notch")) {
          fullscreenTuckTimeout = setTimeout(() => {
            island.classList.add("tucked-notch");
            setClickThrough(true);
            fullscreenTuckTimeout = null;
          }, 160);
        }
      }
    } else {
      // =========================================================
      // KONDISI 2: SAAT KELUAR DARI FULLSCREEN (DESKTOP BIASA)
      // =========================================================
      if (fullscreenTuckTimeout) {
        clearTimeout(fullscreenTuckTimeout);
        fullscreenTuckTimeout = null;
      }
      island.classList.remove("tucked-notch");
      setClickThrough(!isOverActiveIsland);

      if (isCursorTargetingIsland) {
        if (!isHovered) {
          isHovered = true;
          clearTimeout(chargingAlertTimeout);
          clearTimeout(twsAlertTimeout);
          if (leaveCollapseTimeout) {
            clearTimeout(leaveCollapseTimeout);
            leaveCollapseTimeout = null;
          }
          if (currentState === "compact" || currentState === "eyes" || currentState === "charging" || currentState === "tws") {
            setState(expandedState, false);
          }
        }
      } else {
        if (isHovered) {
          isHovered = false;
          if (leaveCollapseTimeout) clearTimeout(leaveCollapseTimeout);
          leaveCollapseTimeout = setTimeout(() => {
            if (!isHovered && (currentState === "player" || currentState === "lyrics")) {
              setState(baseCollapsedState, false);
            }
          }, 220);
        }
      }
    }

    // Eye tracking jika mode mata aktif
    if (currentState === "eyes" && glowEyesGroup) {
      const windowCenterX = info.window_x + (info.window_width / 2);
      const windowCenterY = info.window_y + (38 * scaleFactor / 2);
      const deltaX = info.cursor_x - windowCenterX;
      const deltaY = info.cursor_y - windowCenterY;

      const angle = Math.atan2(deltaY, deltaX);
      const dist = Math.hypot(deltaX, deltaY);
      const factor = Math.min(1.0, dist / 320);
      const eyeX = Math.cos(angle) * (factor * 8.5);
      const eyeY = Math.sin(angle) * (factor * 3.5);

      glowEyesGroup.style.transform = `translate(${eyeX.toFixed(1)}px, ${eyeY.toFixed(1)}px)`;
    }

  } catch {
    // Fallback
  }
}

// Jalankan tracking global & hit-testing setiap 25ms (40 FPS, sangat mulus)
setInterval(pollGlobalCursor, 25);

// DOM Mouse Event pendukung untuk responsivitas seketika
island.addEventListener("mouseenter", () => {
  setClickThrough(false);
  isHovered = true;
  clearTimeout(chargingAlertTimeout);
  clearTimeout(twsAlertTimeout);
  if (leaveCollapseTimeout) {
    clearTimeout(leaveCollapseTimeout);
    leaveCollapseTimeout = null;
  }
  if (currentState === "compact" || currentState === "eyes" || currentState === "charging" || currentState === "tws") {
    setState(expandedState, false);
  }
});

island.addEventListener("mouseleave", () => {
  isHovered = false;
  if (leaveCollapseTimeout) clearTimeout(leaveCollapseTimeout);
  leaveCollapseTimeout = setTimeout(() => {
    if (!isHovered && (currentState === "player" || currentState === "lyrics")) {
      setState(baseCollapsedState, false);
    }
  }, 180);
});

// =========================================================
// 4. JAM & TANGGAL REAL-TIME
// =========================================================
function updateClock() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  if (compactClock) {
    compactClock.textContent = `${hours}:${minutes}`;
  }

  if (playerDateTime) {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const dayName = days[now.getDay()];
    const dateNum = now.getDate();
    const monthName = months[now.getMonth()];

    playerDateTime.innerHTML = `${dayName}, ${dateNum} ${monthName} · <b>${hours}:${minutes}</b>`;
  }
}

setInterval(updateClock, 1000);
updateClock();

// =========================================================
// 5. INTEGRASI BATERAI LAPTOP & CHARGING ALERT BANNER (GAMBAR 1)
// =========================================================
const compactBatteryCircle = document.getElementById("compact-battery-circle");
const playerBatteryCircle = document.getElementById("player-battery-circle");
const compactBatteryGauge = document.getElementById("compact-battery-gauge");
const playerBatteryGauge = document.getElementById("player-battery-gauge");
const compactBatteryBolt = document.getElementById("compact-battery-bolt");
const playerBatteryBolt = document.getElementById("player-battery-bolt");
const chargingAlertCircle = document.getElementById("charging-alert-circle");
const chargingAlertPercent = document.getElementById("charging-alert-percent");
const playerBatteryPct = document.getElementById("player-battery-pct");

async function fetchBatteryStatus() {
  if (!invoke) return;

  try {
    const battery = await invoke("get_battery_info");
    if (!battery) return;

    const pct = Math.min(100, Math.max(0, battery.percentage));
    const strokeDash = `${pct}, 100`;

    if (compactBatteryCircle) compactBatteryCircle.setAttribute("stroke-dasharray", strokeDash);
    if (playerBatteryCircle) playerBatteryCircle.setAttribute("stroke-dasharray", strokeDash);
    if (chargingAlertCircle) chargingAlertCircle.setAttribute("stroke-dasharray", strokeDash);
    if (chargingAlertPercent) chargingAlertPercent.textContent = `${pct}%`;
    if (playerBatteryPct) playerBatteryPct.textContent = `${pct}%`;

    const titleText = `Baterai Laptop: ${pct}%${battery.is_charging ? " (Mengisi Daya ⚡)" : ""}`;
    if (compactBatteryGauge) {
      compactBatteryGauge.title = titleText;
      if (pct <= 20) compactBatteryGauge.classList.add("low");
      else compactBatteryGauge.classList.remove("low");

      if (battery.is_charging) compactBatteryGauge.classList.add("charging");
      else compactBatteryGauge.classList.remove("charging");
    }

    if (playerBatteryGauge) {
      playerBatteryGauge.title = titleText;
      if (pct <= 20) playerBatteryGauge.classList.add("low");
      else playerBatteryGauge.classList.remove("low");

      if (battery.is_charging) playerBatteryGauge.classList.add("charging");
      else playerBatteryGauge.classList.remove("charging");
    }

    if (battery.is_charging) {
      compactBatteryBolt?.classList.remove("hidden");
      playerBatteryBolt?.classList.remove("hidden");
    } else {
      compactBatteryBolt?.classList.add("hidden");
      playerBatteryBolt?.classList.add("hidden");
    }

    if (prevIsCharging !== null && !prevIsCharging && battery.is_charging) {
      triggerChargingAlert(pct);
    }
    prevIsCharging = battery.is_charging;

  } catch (err) {
    console.error("Gagal membaca status baterai:", err);
  }
}

function triggerChargingAlert(pct) {
  if (isHovered && (currentState === "player" || currentState === "lyrics")) return;

  if (chargingAlertPercent) {
    chargingAlertPercent.textContent = `${pct}%`;
  }

  island.classList.remove("tucked-notch");
  setState("charging", false);

  clearTimeout(chargingAlertTimeout);
  chargingAlertTimeout = setTimeout(() => {
    if (!isHovered && currentState === "charging") {
      dismissTemporaryBanner();
    }
  }, 3500);
}

setInterval(fetchBatteryStatus, 1500);
fetchBatteryStatus();

// =========================================================
// 6. INTEGRASI TWS / BLUETOOTH EARBUDS BANNER (GAMBAR 2)
// (Real-time Bluetooth TWS, Otomatis Sembunyi Jika Tidak Konek)
// =========================================================
const twsDeviceName = document.getElementById("tws-device-name");
const twsDeviceStatus = document.getElementById("tws-device-status");
const twsBatteryCircle = document.getElementById("tws-battery-circle");
const dotTws = document.getElementById("dot-tws");
const playerTwsBadge = document.getElementById("player-tws-badge");
const playerTwsPct = document.getElementById("player-tws-pct");

let prevTwsConnected = false;
let twsAlertTimeout = null;
let lastTwsInfo = { is_connected: false, name: "", battery_percentage: 0 };

async function fetchTwsStatus() {
  if (!invoke) return;

  try {
    const tws = await invoke("get_tws_info");
    if (!tws) return;

    lastTwsInfo = tws;

    if (tws.is_connected) {
      // TWS Terhubung! Tampilkan data real
      const displayName = tws.name || "Bluetooth TWS";
      const batteryText = tws.battery_percentage > 0 ? `${tws.battery_percentage}%` : "";
      const statusSubtext = batteryText ? `Connected · ${batteryText}` : "Connected";

      if (twsDeviceName) twsDeviceName.textContent = displayName;
      if (twsDeviceStatus) twsDeviceStatus.textContent = statusSubtext;
      if (twsBatteryCircle) {
        twsBatteryCircle.setAttribute("stroke-dasharray", `${tws.battery_percentage || 100}, 100`);
      }

      // Tampilkan dot TWS di pagination
      if (dotTws) dotTws.classList.remove("hidden");

      // Tampilkan mini badge TWS di header player
      if (playerTwsBadge) {
        playerTwsBadge.classList.remove("hidden");
        playerTwsBadge.title = `${displayName}: ${batteryText || "Connected"}`;
      }
      if (playerTwsPct) {
        playerTwsPct.textContent = batteryText || "ON";
      }

      // Jika baru pertama kali connect (dari posisi disconnect)
      if (!prevTwsConnected) {
        // Redam event volume endpoint switch yang otomatis dipicu Windows saat Bluetooth konek
        isTwsConnecting = true;
        twsActiveUntil = Date.now() + 4500;
        clearTimeout(twsConnectedSuppressionTimer);
        twsConnectedSuppressionTimer = setTimeout(() => {
          isTwsConnecting = false;
        }, 4500);

        if (invoke) {
          invoke("get_volume_info").then((v) => {
            if (v) {
              lastKnownVolume = v.volume;
              lastKnownMuted = v.is_muted;
            }
          }).catch(() => {});
        }

        triggerTwsAlert(displayName, tws.battery_percentage);
      }
    } else {
      // TIDAK ADA KONEKSI BLUETOOTH TWS
      // Sembunyikan seluruh indikator & dot TWS
      if (dotTws) dotTws.classList.add("hidden");
      if (playerTwsBadge) playerTwsBadge.classList.add("hidden");

      // Jika user sedang berada di tampilan TWS saat disconnected, segera kembalikan ke compact
      if (currentState === "tws") {
        clearTimeout(twsAlertTimeout);
        dismissTemporaryBanner();
      }

      if (twsDeviceName) twsDeviceName.textContent = "";
      if (twsDeviceStatus) twsDeviceStatus.textContent = "";
    }

    prevTwsConnected = tws.is_connected;
  } catch (err) {
    console.error("Gagal memeriksa status TWS:", err);
  }
}

function triggerTwsAlert(name, batteryPct) {
  if (isHovered && (currentState === "player" || currentState === "lyrics")) return;

  // Redam volume HUD selama banner TWS aktif
  isTwsConnecting = true;
  twsActiveUntil = Date.now() + 4500;
  clearTimeout(twsConnectedSuppressionTimer);
  twsConnectedSuppressionTimer = setTimeout(() => {
    isTwsConnecting = false;
  }, 4500);

  if (volumeAlertTimeout) {
    clearTimeout(volumeAlertTimeout);
    volumeAlertTimeout = null;
  }

  const displayName = name || "Baseus Encok WM01";
  const displayBattery = batteryPct > 0 ? batteryPct : 100;
  const statusSubtext = `Terhubung · ${displayBattery}%`;

  if (twsDeviceName) twsDeviceName.textContent = displayName;
  if (twsDeviceStatus) twsDeviceStatus.textContent = statusSubtext;

  // Wajib langsung un-tuck dan muncul walau sedang mode fullscreen
  if (fullscreenTuckTimeout) {
    clearTimeout(fullscreenTuckTimeout);
    fullscreenTuckTimeout = null;
  }
  island.classList.remove("tucked-notch");
  setState("tws", false);

  clearTimeout(twsAlertTimeout);
  twsAlertTimeout = setTimeout(() => {
    if (currentState === "tws") {
      dismissTemporaryBanner();
    }
  }, 3800); // Tampil selama 3.8 detik persis di video
}

setInterval(fetchTwsStatus, 2000);
fetchTwsStatus();

if (playerTwsBadge) {
  playerTwsBadge.addEventListener("click", (e) => {
    e.stopPropagation();
    if (lastTwsInfo.is_connected) {
      triggerTwsAlert(lastTwsInfo.name, lastTwsInfo.battery_percentage);
    }
  });
}

// =========================================================
// 5B. VOLUME HUD LOGIC (Persis Video Referensi 00:15)
// =========================================================
const volumeIconSpeaker = document.getElementById("volume-icon-speaker");
const volumeIconMute = document.getElementById("volume-icon-mute");
const volumeBarFill = document.getElementById("volume-bar-fill");
const volumeIconWrap = document.getElementById("volume-icon-wrap");
let volumeAlertTimeout = null;
let lastKnownVolume = null;
let lastKnownMuted = null;
let shakeTimeout = null;

function triggerVolumeHapticShake() {
  island.classList.remove("volume-shake");
  // Force reflow agar animasi getar langsung terpicu ulang seketika
  void island.offsetWidth;
  island.classList.add("volume-shake");

  if (volumeIconWrap) {
    volumeIconWrap.classList.remove("volume-icon-shake");
    void volumeIconWrap.offsetWidth;
    volumeIconWrap.classList.add("volume-icon-shake");
  }

  clearTimeout(shakeTimeout);
  shakeTimeout = setTimeout(() => {
    island.classList.remove("volume-shake");
    volumeIconWrap?.classList.remove("volume-icon-shake");
  }, 440);
}

function triggerVolumeHUD(volume, isMuted) {
  if (isHovered && (currentState === "player" || currentState === "lyrics")) return;

  const vol = Math.min(100, Math.max(0, volume));

  // Selalu update fill bar agar nilai volume tetap akurat di background
  if (volumeBarFill) {
    volumeBarFill.style.width = isMuted ? "0%" : `${vol}%`;
  }

  // Jika TWS sedang connect atau banner TWS sedang tampil:
  // JANGAN buka HUD volume (redam pergantian endpoint audio otomatis saat TWS konek)
  if (currentState === "tws" || isTwsConnecting || Date.now() < twsActiveUntil) {
    return;
  }

  if (volumeIconSpeaker && volumeIconMute) {
    if (isMuted || vol === 0) {
      volumeIconSpeaker.classList.add("hidden");
      volumeIconMute.classList.remove("hidden");
    } else {
      volumeIconMute.classList.add("hidden");
      volumeIconSpeaker.classList.remove("hidden");

      const wave1 = volumeIconSpeaker.querySelector(".vol-wave-1");
      const wave2 = volumeIconSpeaker.querySelector(".vol-wave-2");
      if (wave1) wave1.style.display = vol > 12 ? "block" : "none";
      if (wave2) wave2.style.display = vol > 45 ? "block" : "none";
    }
  }

  // Wajib langsung un-tuck dan muncul walau sedang mode fullscreen
  if (fullscreenTuckTimeout) {
    clearTimeout(fullscreenTuckTimeout);
    fullscreenTuckTimeout = null;
  }
  island.classList.remove("tucked-notch");
  setState("volume", false);

  // Efek getar / haptic shake saat volume mencapai batas 0% atau 100% persis seperti di video!
  if (vol >= 100 || vol === 0 || isMuted) {
    triggerVolumeHapticShake();
  }

  clearTimeout(volumeAlertTimeout);
  volumeAlertTimeout = setTimeout(() => {
    if (currentState === "volume") {
      dismissTemporaryBanner();
    }
  }, 1800); // 1.8 detik seperti di video
}

// Event listener dari Tauri backend (Realtime Windows Core Audio Event)
if (window.__TAURI__?.event?.listen) {
  window.__TAURI__.event.listen("volume-changed", (event) => {
    const payload = event.payload;
    if (payload) {
      if (!isTwsConnecting && currentState !== "tws" && Date.now() >= twsActiveUntil) {
        triggerVolumeHUD(payload.volume, payload.is_muted);
      } else if (volumeBarFill) {
        volumeBarFill.style.width = payload.is_muted ? "0%" : `${payload.volume}%`;
      }
    }
  });
}

// Fallback Polling Master Volume Windows
async function pollMasterVolume() {
  if (!invoke) return;
  try {
    const v = await invoke("get_volume_info");
    if (!v) return;

    if (
      lastKnownVolume !== null &&
      (v.volume !== lastKnownVolume || v.is_muted !== lastKnownMuted)
    ) {
      if (!isTwsConnecting && currentState !== "tws" && Date.now() >= twsActiveUntil) {
        triggerVolumeHUD(v.volume, v.is_muted);
      }
    }

    lastKnownVolume = v.volume;
    lastKnownMuted = v.is_muted;
  } catch {}
}

setInterval(pollMasterVolume, 150);

// =========================================================
// 6. KONTROL ELEMEN MEDIA & FORMATTER WAKTU
// =========================================================
const trackTitleEl = document.getElementById("track-title");
const trackArtistEl = document.getElementById("track-artist");
const lyricsTrackTitleEl = document.getElementById("lyrics-track-title");
const lyricsTrackArtistEl = document.getElementById("lyrics-track-artist");

const timeCurrentEl = document.getElementById("time-current");
const timeRemainingEl = document.getElementById("time-remaining");
const progressFill = document.getElementById("progress-fill");
const progressThumb = document.getElementById("progress-thumb");

const lyricsTimeCurrentEl = document.getElementById("lyrics-time-current");
const lyricsTimeRemainingEl = document.getElementById("lyrics-time-remaining");
const lyricsProgressFill = document.getElementById("lyrics-progress-fill");

const compactEqualizer = document.getElementById("compact-equalizer");
const playerEqualizer = document.getElementById("player-equalizer");
const albumArtEl = document.getElementById("album-art");
const lyricsAlbumArtEl = document.getElementById("lyrics-album-art");

const btnPlay = document.getElementById("btn-play");
const btnLyricsPlay = document.getElementById("btn-lyrics-play");
const btnPrev = document.getElementById("btn-prev");
const btnNext = document.getElementById("btn-next");
const btnLyricsPrev = document.getElementById("btn-lyrics-prev");
const btnLyricsNext = document.getElementById("btn-lyrics-next");

const btnLyrics = document.getElementById("btn-lyrics");
const btnLyricsBack = document.getElementById("btn-lyrics-back");
const btnNextView = document.getElementById("btn-next-view");

function formatTime(totalSec) {
  const mins = Math.floor(Math.abs(totalSec) / 60);
  const secs = Math.floor(Math.abs(totalSec) % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function updateTimelineUI() {
  const percent = totalSeconds > 0 ? Math.min(100, Math.max(0, (currentSeconds / totalSeconds) * 100)) : 0;
  
  if (progressFill) progressFill.style.width = `${percent}%`;
  if (progressThumb) progressThumb.style.left = `${percent}%`;
  if (lyricsProgressFill) lyricsProgressFill.style.width = `${percent}%`;

  const curText = formatTime(currentSeconds);
  const remText = totalSeconds > currentSeconds ? `-${formatTime(totalSeconds - currentSeconds)}` : "-00:00";

  if (timeCurrentEl) timeCurrentEl.textContent = curText;
  if (timeRemainingEl) timeRemainingEl.textContent = remText;
  if (lyricsTimeCurrentEl) lyricsTimeCurrentEl.textContent = curText;
  if (lyricsTimeRemainingEl) lyricsTimeRemainingEl.textContent = remText;

  updateSmoothLyricsScroll(currentSeconds);
}

function setPlaybackStateUI(playing) {
  isPlaying = playing;

  [btnPlay, btnLyricsPlay].forEach((btn) => {
    if (!btn) return;
    const iconPause = btn.querySelector(".icon-pause");
    const iconPlay = btn.querySelector(".icon-play");
    if (isPlaying) {
      iconPause?.classList.remove("hidden");
      iconPlay?.classList.add("hidden");
    } else {
      iconPause?.classList.add("hidden");
      iconPlay?.classList.remove("hidden");
    }
  });

  if (isPlaying) {
    compactEqualizer?.classList.remove("paused");
    playerEqualizer?.classList.remove("paused");
    albumArtEl?.classList.add("spinning");
    lyricsAlbumArtEl?.classList.add("spinning");
  } else {
    compactEqualizer?.classList.add("paused");
    playerEqualizer?.classList.add("paused");
    albumArtEl?.classList.remove("spinning");
    lyricsAlbumArtEl?.classList.remove("spinning");
  }
}

// =========================================================
// 7. INTEGRASI WINDOWS MEDIA (SMTC VIA TAURI)
// =========================================================
async function fetchWindowsMedia() {
  if (!invoke) return;

  try {
    const info = await invoke("get_media_info");
    if (!info) return;

    if (info.is_active) {
      if (trackTitleEl && info.title) trackTitleEl.textContent = info.title;
      if (lyricsTrackTitleEl && info.title) lyricsTrackTitleEl.textContent = info.title;
      if (trackArtistEl && info.artist) trackArtistEl.textContent = info.artist;
      if (lyricsTrackArtistEl && info.artist) lyricsTrackArtistEl.textContent = info.artist;

      // Update Cover Art dari Spotify / Windows GSMTC
      if (info.album_art) {
        if (albumArtEl) {
          albumArtEl.style.backgroundImage = `url("${info.album_art}")`;
        }
        if (lyricsAlbumArtEl) {
          lyricsAlbumArtEl.style.backgroundImage = `url("${info.album_art}")`;
        }
      }

      setPlaybackStateUI(info.is_playing);
      currentSeconds = info.position_seconds;
      if (info.duration_seconds > 0) {
        totalSeconds = info.duration_seconds;
      }
      updateTimelineUI();

      if (info.title && info.title !== lastTrackTitle && info.title !== "Media Player") {
        lastTrackTitle = info.title;
        fetchLyricsForTrack(info.title, info.artist);
      }
    }

    // Dynamic app theme for compact equalizer
    if (compactEqualizer) {
      compactEqualizer.classList.remove("app-spotify", "app-youtube");
      if (info.app_type === "spotify") {
        compactEqualizer.classList.add("app-spotify");
      } else if (info.app_type === "youtube") {
        compactEqualizer.classList.add("app-youtube");
      }
    }

    // =========================================================
    // DUAL ISLAND: SATELLITE BUBBLE (Spotify + YouTube Split Pill)
    // =========================================================
    const satBubble = document.getElementById("satellite-bubble");
    const satSpotify = document.getElementById("satellite-icon-spotify");
    const satYoutube = document.getElementById("satellite-icon-youtube");
    const satMedia = document.getElementById("satellite-icon-media");

    if (info.secondary && (info.secondary.title || info.secondary.is_playing)) {
      if (satBubble) {
        satBubble.classList.remove("hidden");
        island.classList.add("dual-island");

        satBubble.classList.remove("type-spotify", "type-youtube", "type-media");
        satSpotify?.classList.add("hidden");
        satYoutube?.classList.add("hidden");
        satMedia?.classList.add("hidden");

        if (info.secondary.app_type === "spotify") {
          satBubble.classList.add("type-spotify");
          satSpotify?.classList.remove("hidden");
        } else if (info.secondary.app_type === "youtube") {
          satBubble.classList.add("type-youtube");
          satYoutube?.classList.remove("hidden");
        } else {
          satBubble.classList.add("type-media");
          satMedia?.classList.remove("hidden");
        }

        if (info.secondary.is_playing) {
          satBubble.classList.add("playing");
        } else {
          satBubble.classList.remove("playing");
        }

        const secName = info.secondary.title || (info.secondary.app_type === "spotify" ? "Spotify" : "YouTube");
        satBubble.title = `${secName} • Klik untuk beralih`;
      }
    } else {
      if (satBubble) {
        satBubble.classList.add("hidden");
        satBubble.classList.remove("playing");
      }
      island.classList.remove("dual-island");
    }
  } catch (err) {
    console.error("Gagal mengambil info media:", err);
  }
}

setInterval(fetchWindowsMedia, 500);
fetchWindowsMedia();

function triggerFastMediaPoll() {
  // Polling beruntun cepat agar perubahan lagu Spotify / Windows tertangkap seketika
  [90, 220, 420, 700, 1100].forEach((delay) => {
    setTimeout(fetchWindowsMedia, delay);
  });
}

// Handler Tombol Playback
async function handleTogglePlay(e) {
  if (e) e.stopPropagation();
  // Optimistic UI update seketika
  isPlaying = !isPlaying;
  setPlaybackStateUI(isPlaying);

  if (invoke) {
    invoke("media_toggle_play").catch(() => {});
    triggerFastMediaPoll();
  }
}

async function handleNext(e) {
  if (e) e.stopPropagation();

  // Animasi tactile seketika: teks lagu bergeser halus ke kiri tanda skip
  if (trackTitleEl) {
    trackTitleEl.style.transition = "transform 0.15s ease, opacity 0.15s ease";
    trackTitleEl.style.transform = "translateX(-10px)";
    trackTitleEl.style.opacity = "0.5";
    setTimeout(() => {
      if (trackTitleEl) {
        trackTitleEl.style.transform = "translateX(0)";
        trackTitleEl.style.opacity = "1";
      }
    }, 200);
  }

  // Putar piringan vinyl sedikit sebagai respon tactile
  const albumArt = document.getElementById("album-art");
  if (albumArt) {
    albumArt.style.transition = "transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)";
    albumArt.style.transform = "rotate(45deg) scale(0.94)";
    setTimeout(() => {
      if (albumArt) albumArt.style.transform = "";
    }, 340);
  }

  if (invoke) {
    invoke("media_next").catch(() => {});
    triggerFastMediaPoll();
  }
}

async function handlePrev(e) {
  if (e) e.stopPropagation();

  // Animasi tactile seketika: teks lagu bergeser halus ke kanan tanda prev
  if (trackTitleEl) {
    trackTitleEl.style.transition = "transform 0.15s ease, opacity 0.15s ease";
    trackTitleEl.style.transform = "translateX(10px)";
    trackTitleEl.style.opacity = "0.5";
    setTimeout(() => {
      if (trackTitleEl) {
        trackTitleEl.style.transform = "translateX(0)";
        trackTitleEl.style.opacity = "1";
      }
    }, 200);
  }

  const albumArt = document.getElementById("album-art");
  if (albumArt) {
    albumArt.style.transition = "transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)";
    albumArt.style.transform = "rotate(-45deg) scale(0.94)";
    setTimeout(() => {
      if (albumArt) albumArt.style.transform = "";
    }, 340);
  }

  if (invoke) {
    invoke("media_prev").catch(() => {});
    triggerFastMediaPoll();
  }
}

if (btnPlay) btnPlay.addEventListener("click", handleTogglePlay);
if (btnLyricsPlay) btnLyricsPlay.addEventListener("click", handleTogglePlay);
if (btnNext) btnNext.addEventListener("click", handleNext);
if (btnLyricsNext) btnLyricsNext.addEventListener("click", handleNext);
if (btnPrev) btnPrev.addEventListener("click", handlePrev);
if (btnLyricsPrev) btnLyricsPrev.addEventListener("click", handlePrev);

function switchToLyricsMode() {
  // Transisi CSS pelebaran & slide lirik yang super mulus tanpa kedip (canvas window sudah 600px)
  setState("lyrics", false);
}

function switchToPlayerMode() {
  // Transisi CSS slide kembali ke player mode tanpa resize window OS
  setState("player", false);
}

if (btnLyrics) {
  btnLyrics.addEventListener("click", async (e) => {
    e.stopPropagation();
    await switchToLyricsMode();
  });
}

if (btnNextView) {
  btnNextView.addEventListener("click", async (e) => {
    e.stopPropagation();
    await switchToLyricsMode();
  });
}

if (btnLyricsBack) {
  btnLyricsBack.addEventListener("click", async (e) => {
    e.stopPropagation();
    await switchToPlayerMode();
  });
}

// Beralih mode via Pagination Dots (Dot 1: Player, Dot 2: Lyrics, Dot 3: Compact, Dot 4: Eyes)
const paginationDots = document.querySelectorAll(".pagination-bar .dot");
paginationDots.forEach((dot) => {
  dot.addEventListener("click", async (e) => {
    e.stopPropagation();
    const target = dot.getAttribute("data-view");
    if (target) {
      if (target === "eyes") baseCollapsedState = "eyes";
      if (target === "compact") baseCollapsedState = "compact";
      await setState(target);
    }
  });
});

// Klik Kanan pada Dynamic Island untuk switch instan Mode Mata Kucing 🐱 <-> Jam
island.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  e.stopPropagation();
  toggleEyesMode();
});

// Double click pada Dynamic Island untuk switch mode
island.addEventListener("dblclick", (e) => {
  e.stopPropagation();
  toggleEyesMode();
});

// Klik langsung pada Jam untuk switch ke Mata Kucing
if (compactClock) {
  compactClock.style.cursor = "pointer";
  compactClock.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleEyesMode();
  });
}

// Klik pada area Mata Kucing untuk kembali ke Jam
const viewEyesEl = document.getElementById("view-eyes");
if (viewEyesEl) {
  viewEyesEl.style.cursor = "pointer";
  viewEyesEl.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleEyesMode();
  });
}


// =========================================================
// 8. SISTEM LIRIK REAL-TIME DENGAN TRANSISI HALUS (SMOOTH SCROLL)
// =========================================================
const lyricsList = document.getElementById("lyrics-list");
const lyricsViewport = document.getElementById("lyrics-viewport");

async function fetchLyricsForTrack(title, artist) {
  try {
    const cleanTitle = title.replace(/\([^)]*\)|\[[^\]]*\]/g, "").trim();
    const cleanArtist = artist.split(/[,&]/)[0].trim();

    const query = new URLSearchParams({
      track_name: cleanTitle,
      artist_name: cleanArtist,
    });

    const res = await fetch(`https://lrclib.net/api/get?${query}`);
    if (!res.ok) return;

    const data = await res.json();
    if (data.syncedLyrics) {
      parseLrcLyrics(data.syncedLyrics);
    }
  } catch {
    // Fallback default
  }
}

function parseLrcLyrics(lrcText) {
  const lines = lrcText.split("\n");
  const parsed = [];
  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

  for (const line of lines) {
    const match = line.match(timeRegex);
    if (match) {
      const mins = parseInt(match[1], 10);
      const secs = parseInt(match[2], 10);
      const totalSec = mins * 60 + secs;
      const text = line.replace(timeRegex, "").trim();
      if (text) {
        parsed.push({ time: totalSec, text });
      }
    }
  }

  syncedLyricsData = parsed;
  lastActiveLyricIndex = -1;
  renderLyricsDOM();
}

function renderLyricsDOM() {
  if (!lyricsList) return;
  if (!syncedLyricsData || syncedLyricsData.length === 0) return;

  lyricsList.innerHTML = "";
  syncedLyricsData.forEach((item, index) => {
    const div = document.createElement("div");
    div.className = "lyric-item future";
    div.textContent = item.text;
    div.dataset.index = index;
    lyricsList.appendChild(div);
  });
}

function updateSmoothLyricsScroll(currentSec) {
  if (!syncedLyricsData || syncedLyricsData.length === 0 || !lyricsList) return;

  // Temukan indeks lirik yang sedang aktif
  let activeIndex = 0;
  for (let i = 0; i < syncedLyricsData.length; i++) {
    if (currentSec >= syncedLyricsData[i].time) {
      activeIndex = i;
    } else {
      break;
    }
  }

  if (activeIndex === lastActiveLyricIndex) return;
  lastActiveLyricIndex = activeIndex;

  const items = lyricsList.querySelectorAll(".lyric-item");
  items.forEach((item, idx) => {
    item.classList.remove("past", "current", "future", "dim");
    if (idx < activeIndex) {
      item.classList.add("past");
    } else if (idx === activeIndex) {
      item.classList.add("current");
    } else if (idx === activeIndex + 1) {
      item.classList.add("future");
    } else {
      item.classList.add("future", "dim");
    }
  });

  // Hitung offset perpindahan halus (GPU transform translateY)
  const activeElement = items[activeIndex];
  if (activeElement && lyricsViewport) {
    const viewportHeight = lyricsViewport.clientHeight;
    const itemTop = activeElement.offsetTop;
    const itemHeight = activeElement.clientHeight;

    // Posisikan baris aktif tepat di tengah viewport
    const targetScroll = itemTop - (viewportHeight / 2) + (itemHeight / 2);
    lyricsList.style.transform = `translateY(-${Math.max(0, targetScroll)}px)`;
  }
}

// Inisialisasi awal sinkronisasi window
setTimeout(() => {
  syncTauriWindowSize("compact");
}, 200);

// =========================================================
// 10. INTERAKSI CUTE MUSIC COMPANION (Gerak-gerak Lucu)
// =========================================================
const cuteCompanion = document.getElementById("cute-companion");
const petExpression = document.getElementById("pet-expression");
let petMoodIdx = 0;

const petMoodVariations = [
  // 0: Happy music listening arcs (^ ^)
  `
    <path class="pet-eye" d="M 13.5 19.5 Q 15.5 17 17.5 19.5" fill="none" stroke="#18181b" stroke-width="1.8" stroke-linecap="round" />
    <path class="pet-eye" d="M 22.5 19.5 Q 24.5 17 26.5 19.5" fill="none" stroke="#18181b" stroke-width="1.8" stroke-linecap="round" />
    <path d="M 18.5 22.5 Q 20 23.8 21.5 22.5" fill="none" stroke="#18181b" stroke-width="1.4" stroke-linecap="round" />
  `,
  // 1: Playful Wink & Tongue (^ <)
  `
    <path class="pet-eye" d="M 13.5 19.5 Q 15.5 17 17.5 19.5" fill="none" stroke="#18181b" stroke-width="1.8" stroke-linecap="round" />
    <path d="M 23 18 L 26.5 21.5 M 26.5 18 L 23 21.5" stroke="#18181b" stroke-width="1.8" stroke-linecap="round" />
    <path d="M 18.5 22.5 Q 20 24.5 21.5 22.5" fill="#ff70a6" stroke="#18181b" stroke-width="1.3" />
  `,
  // 2: Heart Eyes (♥ ♥)
  `
    <path d="M 13.5 17.8 A 1.8 1.8 0 0 1 17 17.8 Q 17 21 15.2 22.2 Q 13.5 21 13.5 17.8 Z" fill="#ef4444" />
    <path d="M 22.5 17.8 A 1.8 1.8 0 0 1 26 17.8 Q 26 21 24.2 22.2 Q 22.5 21 22.5 17.8 Z" fill="#ef4444" />
    <path d="M 18.5 22.8 Q 20 24 21.5 22.8" fill="none" stroke="#18181b" stroke-width="1.4" stroke-linecap="round" />
  `,
  // 3: Cool Star Shades / Sunglasses (⌐■_■)
  `
    <rect x="12" y="17" width="6.5" height="4.5" rx="1.5" fill="#18181b" />
    <rect x="21.5" y="17" width="6.5" height="4.5" rx="1.5" fill="#18181b" />
    <line x1="18.5" y1="18.5" x2="21.5" y2="18.5" stroke="#18181b" stroke-width="1.6" />
    <path d="M 18.5 22.8 Q 20 23.8 21.5 22.8" fill="none" stroke="#18181b" stroke-width="1.4" stroke-linecap="round" />
  `
];

if (cuteCompanion && petExpression) {
  cuteCompanion.addEventListener("click", () => {
    petMoodIdx = (petMoodIdx + 1) % petMoodVariations.length;
    petExpression.innerHTML = petMoodVariations[petMoodIdx];
    cuteCompanion.classList.add("pet-bounce");
    setTimeout(() => cuteCompanion.classList.remove("pet-bounce"), 450);
  });
}

// =========================================================
// 11. STARTUP WELCOME BANNER & ROBOT DADA-DADA / LEWAT
// =========================================================
const welcomeRobotWrap = document.getElementById("welcome-robot-wrap");
const compactRobotWrap = document.getElementById("compact-robot-wrap");
const robotWalkerRunner = document.getElementById("robot-walker-runner");
const welcomeTitle = document.getElementById("welcome-title");
const welcomeSubtitle = document.getElementById("welcome-subtitle");
const welcomePillText = document.getElementById("welcome-pill-text");

// Fungsi animasi Robot Lewat (Melintas di atas Dynamic Island)
let isRobotWalking = false;
function triggerRobotLewat() {
  if (isRobotWalking || !robotWalkerRunner) return;
  isRobotWalking = true;

  robotWalkerRunner.classList.remove("active");
  // Force reflow
  void robotWalkerRunner.offsetWidth;
  robotWalkerRunner.classList.add("active");

  setTimeout(() => {
    robotWalkerRunner.classList.remove("active");
    isRobotWalking = false;
  }, 7600);
}

// Interaksi klik Robot di Welcome Banner (360 Flip Spin)
if (welcomeRobotWrap) {
  welcomeRobotWrap.addEventListener("click", () => {
    welcomeRobotWrap.classList.add("spin-flip");
    setTimeout(() => welcomeRobotWrap.classList.remove("spin-flip"), 700);
  });
}

// Interaksi klik Robot di Compact Mode (360 Flip + Robot Lewat Melintas)
if (compactRobotWrap) {
  compactRobotWrap.addEventListener("click", (e) => {
    e.stopPropagation();
    compactRobotWrap.classList.add("spin-flip");
    setTimeout(() => compactRobotWrap.classList.remove("spin-flip"), 600);
    triggerRobotLewat();
  });
}

async function triggerWelcomeBanner() {
  const now = new Date();
  const hour = now.getHours();

  let greeting = "Selamat Datang";
  let subtitle = "System Ready · All systems nominal 🚀";

  if (hour >= 4 && hour < 11) {
    greeting = "Selamat Pagi";
    subtitle = "Ready to conquer today? Let's go! 🚀";
  } else if (hour >= 11 && hour < 15) {
    greeting = "Selamat Siang";
    subtitle = "Tetap semangat & produktif hari ini! ✨";
  } else if (hour >= 15 && hour < 18) {
    greeting = "Selamat Sore";
    subtitle = "Keep up the great momentum! 🎯";
  } else {
    greeting = "Selamat Malam";
    subtitle = "Waktunya santai & istirahat yang cukup ✨";
  }

  let username = "Acer";
  if (invoke) {
    try {
      const u = await invoke("get_system_username");
      if (u) username = u;
    } catch {}
  }

  // Huruf kapital awal nama
  const capUsername = username.charAt(0).toUpperCase() + username.slice(1);

  if (welcomeTitle) welcomeTitle.textContent = `${greeting}, ${capUsername}!`;
  if (welcomeSubtitle) welcomeSubtitle.textContent = subtitle;

  // Tampilkan Welcome Banner keren
  island.classList.remove("tucked-notch");
  setState("welcome", false);

  // Setelah 4.5 detik, kembali secara mulus ke mode compact / eyes
  setTimeout(() => {
    if (currentState === "welcome") {
      dismissTemporaryBanner();
    }
  }, 4500);
}

// Jalankan otomatis saat aplikasi pertama kali menyala (boot / startup)
setTimeout(() => {
  triggerWelcomeBanner();
}, 700);

// Periodik robot lewat setiap 80 detik sekali saat idle di mode compact / eyes
setInterval(() => {
  if (!isHovered && (currentState === "compact" || currentState === "eyes")) {
    triggerRobotLewat();
  }
}, 80000);

// Listener Klik pada Satellite Bubble untuk swap media session (Spotify <-> YouTube)
const satBubbleElement = document.getElementById("satellite-bubble");
if (satBubbleElement) {
  satBubbleElement.addEventListener("click", async (e) => {
    e.stopPropagation();
    satBubbleElement.style.transform = "scale(0.85)";
    setTimeout(() => {
      satBubbleElement.style.transform = "";
    }, 180);

    if (invoke) {
      try {
        await invoke("swap_media_session");
        triggerFastMediaPoll();
      } catch (err) {
        console.error("Gagal swap media session:", err);
      }
    }
  });
}

// Expose fungsi test agar user bisa mencobanya kapan saja lewat devtools / console
window.testWelcome = triggerWelcomeBanner;
window.testRobotLewat = triggerRobotLewat;
window.testVolume = (vol = 68, isMuted = false) => triggerVolumeHUD(vol, isMuted);
window.testTws = (name = "Baseus Encok WM01", bat = 100) => triggerTwsAlert(name, bat);
window.testDualIsland = (appType = "youtube", isPlaying = true) => {
  const sb = document.getElementById("satellite-bubble");
  const sSpo = document.getElementById("satellite-icon-spotify");
  const sYt = document.getElementById("satellite-icon-youtube");
  const sMed = document.getElementById("satellite-icon-media");
  if (!sb) return;

  sb.classList.remove("hidden");
  island.classList.add("dual-island");
  sb.classList.remove("type-spotify", "type-youtube", "type-media");
  sSpo?.classList.add("hidden");
  sYt?.classList.add("hidden");
  sMed?.classList.add("hidden");

  if (appType === "spotify") {
    sb.classList.add("type-spotify");
    sSpo?.classList.remove("hidden");
  } else if (appType === "youtube") {
    sb.classList.add("type-youtube");
    sYt?.classList.remove("hidden");
  } else {
    sb.classList.add("type-media");
    sMed?.classList.remove("hidden");
  }

  if (isPlaying) {
    sb.classList.add("playing");
  } else {
    sb.classList.remove("playing");
  }
};

// Shortcut keyboard praktis:
// Klik Dynamic Island lalu tekan:
// - 'W' : Tampilkan Welcome Popup keren (Robot melayang + dada-dada)
// - 'R' : Animasi Robot Lewat (Robot melintas jalan & dada-dada)
// - 'V' : Test Popup Volume HUD (Tekan berulang untuk tes getar saat 100% & 0%)
// - 'T' : Test Popup TWS Connected (persis video)
// - 'D' : Test Dual Island (Split Gelembung Spotify + YouTube)
const testVolLevels = [100, 65, 0, 40];
let testVolIndex = 0;
let testDualApp = "youtube";
window.addEventListener("keydown", (e) => {
  if (e.key === "w" || e.key === "W") {
    triggerWelcomeBanner();
  } else if (e.key === "r" || e.key === "R") {
    triggerRobotLewat();
  } else if (e.key === "v" || e.key === "V") {
    const vol = testVolLevels[testVolIndex];
    testVolIndex = (testVolIndex + 1) % testVolLevels.length;
    triggerVolumeHUD(vol, vol === 0);
  } else if (e.key === "t" || e.key === "T") {
    triggerTwsAlert("Baseus Encok WM01", 100);
  } else if (e.key === "d" || e.key === "D") {
    window.testDualIsland(testDualApp, true);
    testDualApp = testDualApp === "youtube" ? "spotify" : "youtube";
  }
});

console.log("🏝️ Dynamic Island Ready!");


