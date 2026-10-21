use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::Serialize;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};
use windows::Storage::Streams::DataReader;

#[derive(Serialize, Clone, Debug, Default)]
pub struct MediaSecondaryItem {
    pub app_type: String, // "spotify", "youtube", "media"
    pub title: String,
    pub artist: String,
    pub is_playing: bool,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct MediaInfo {
    pub is_active: bool,
    pub app_type: String, // "spotify", "youtube", "media"
    pub title: String,
    pub artist: String,
    pub is_playing: bool,
    pub position_seconds: i64,
    pub duration_seconds: i64,
    pub album_art: Option<String>,
    pub secondary: Option<MediaSecondaryItem>,
}

fn detect_app_type(source_id: &str, title: &str) -> String {
    let lower_src = source_id.to_lowercase();
    let lower_title = title.to_lowercase();

    if lower_src.contains("spotify") {
        "spotify".to_string()
    } else if lower_src.contains("youtube")
        || lower_title.contains("youtube")
        || lower_src.contains("chrome")
        || lower_src.contains("msedge")
        || lower_src.contains("brave")
        || lower_src.contains("firefox")
        || lower_src.contains("opera")
    {
        "youtube".to_string()
    } else {
        "media".to_string()
    }
}

pub fn get_current_media_info() -> Result<MediaInfo, String> {
    std::thread::spawn(|| {
        pollster::block_on(get_current_media_info_internal())
    })
    .join()
    .map_err(|_| "Media query thread failed".to_string())?
}

async fn get_current_media_info_internal() -> Result<MediaInfo, String> {
    let manager_op = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .map_err(|e| e.to_string())?;
    
    let manager = manager_op.await.map_err(|e| e.to_string())?;

    let cur_session_opt = manager.GetCurrentSession().ok();
    let mut all_sessions_vec = Vec::new();

    if let Ok(sessions) = manager.GetSessions() {
        let count = sessions.Size().unwrap_or(0);
        for i in 0..count {
            if let Ok(s) = sessions.GetAt(i) {
                all_sessions_vec.push(s);
            }
        }
    }

    if let Some(session) = cur_session_opt.or_else(|| all_sessions_vec.first().cloned()) {
        let mut info = MediaInfo {
            is_active: true,
            ..Default::default()
        };

        let src_id = session.SourceAppUserModelId().map(|s| s.to_string()).unwrap_or_default();

        // Status playback (Playing / Paused)
        if let Ok(playback_info) = session.GetPlaybackInfo() {
            if let Ok(status) = playback_info.PlaybackStatus() {
                info.is_playing = status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing;
            }
        }

        // Timeline (durasi & posisi)
        if let Ok(timeline) = session.GetTimelineProperties() {
            if let Ok(pos) = timeline.Position() {
                info.position_seconds = pos.Duration / 10_000_000;
            }
            if let Ok(end) = timeline.EndTime() {
                info.duration_seconds = end.Duration / 10_000_000;
            }
        }

        // Metadata lagu (Judul, Artis, Album Art)
        let (title_opt, artist_opt, stream_op_opt) = if let Ok(media_props_op) = session.TryGetMediaPropertiesAsync() {
            if let Ok(props) = media_props_op.await {
                let t = props.Title().ok().map(|s| s.to_string());
                let a = props.Artist().ok().map(|s| s.to_string());
                let s_op = props.Thumbnail().ok().and_then(|t_ref| t_ref.OpenReadAsync().ok());
                (t, a, s_op)
            } else {
                (None, None, None)
            }
        } else {
            (None, None, None)
        };

        if let Some(t) = title_opt {
            if !t.is_empty() {
                info.title = t;
            }
        }
        if let Some(a) = artist_opt {
            if !a.is_empty() {
                info.artist = a;
            }
        }

        info.app_type = detect_app_type(&src_id, &info.title);

        if let Some(stream_op) = stream_op_opt {
            if let Ok(stream) = stream_op.await {
                if let Ok(size) = stream.Size() {
                    if size > 0 && size < 10_000_000 {
                        if let Ok(reader) = DataReader::CreateDataReader(&stream) {
                            if let Ok(load_op) = reader.LoadAsync(size as u32) {
                                if load_op.await.is_ok() {
                                    let mut bytes = vec![0u8; size as usize];
                                    if reader.ReadBytes(&mut bytes).is_ok() {
                                        let b64 = BASE64.encode(&bytes);
                                        let mime = if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
                                            "image/jpeg"
                                        } else if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
                                            "image/png"
                                        } else if bytes.starts_with(b"RIFF") {
                                            "image/webp"
                                        } else {
                                            "image/jpeg"
                                        };
                                        info.album_art = Some(format!("data:{};base64,{}", mime, b64));
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Fallback jika judul kosong
        if info.title.is_empty() {
            info.title = "Media Player".to_string();
        }
        if info.artist.is_empty() {
            info.artist = "Windows Audio".to_string();
        }

        // Cari sesi kedua (misal jika primary adalah Spotify dan ada YouTube, atau sebaliknya)
        for other_session in all_sessions_vec {
            let other_src = other_session.SourceAppUserModelId().map(|s| s.to_string()).unwrap_or_default();
            // Lewati jika ini sesi yang sama
            if other_src == src_id {
                continue;
            }

            let mut sec_title = String::new();
            let mut sec_artist = String::new();
            let mut sec_playing = false;

            if let Ok(pb) = other_session.GetPlaybackInfo() {
                if let Ok(st) = pb.PlaybackStatus() {
                    sec_playing = st == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing;
                }
            }

            if let Ok(props_op) = other_session.TryGetMediaPropertiesAsync() {
                if let Ok(props) = props_op.await {
                    sec_title = props.Title().map(|s| s.to_string()).unwrap_or_default();
                    sec_artist = props.Artist().map(|s| s.to_string()).unwrap_or_default();
                }
            }

            let sec_type = detect_app_type(&other_src, &sec_title);

            // Hanya tampilkan sebagai secondary jika judulnya ada atau sedang playing
            if !sec_title.is_empty() || sec_playing {
                info.secondary = Some(MediaSecondaryItem {
                    app_type: sec_type,
                    title: if sec_title.is_empty() { "Media Player".to_string() } else { sec_title },
                    artist: sec_artist,
                    is_playing: sec_playing,
                });
                break;
            }
        }

        Ok(info)
    } else {
        Ok(MediaInfo {
            is_active: false,
            app_type: "none".to_string(),
            title: "Tidak ada lagu yang diputar".to_string(),
            artist: "-".to_string(),
            is_playing: false,
            position_seconds: 0,
            duration_seconds: 0,
            album_art: None,
            secondary: None,
        })
    }
}

pub async fn toggle_play_pause() -> Result<(), String> {
    let manager_op = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .map_err(|e| e.to_string())?;
    let manager = manager_op.await.map_err(|e| e.to_string())?;

    if let Ok(session) = manager.GetCurrentSession() {
        let op = session.TryTogglePlayPauseAsync().map_err(|e| e.to_string())?;
        let _ = op.await;
    }
    Ok(())
}

pub async fn next_track() -> Result<(), String> {
    let manager_op = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .map_err(|e| e.to_string())?;
    let manager = manager_op.await.map_err(|e| e.to_string())?;

    if let Ok(session) = manager.GetCurrentSession() {
        let op = session.TrySkipNextAsync().map_err(|e| e.to_string())?;
        let _ = op.await;
    }
    Ok(())
}

pub async fn prev_track() -> Result<(), String> {
    let manager_op = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .map_err(|e| e.to_string())?;
    let manager = manager_op.await.map_err(|e| e.to_string())?;

    if let Ok(session) = manager.GetCurrentSession() {
        let op = session.TrySkipPreviousAsync().map_err(|e| e.to_string())?;
        let _ = op.await;
    }
    Ok(())
}

pub async fn swap_media_session() -> Result<(), String> {
    let manager_op = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
        .map_err(|e| e.to_string())?;
    let manager = manager_op.await.map_err(|e| e.to_string())?;

    let cur_src = manager.GetCurrentSession().ok().and_then(|s| s.SourceAppUserModelId().ok().map(|id| id.to_string())).unwrap_or_default();

    if let Ok(sessions) = manager.GetSessions() {
        let count = sessions.Size().unwrap_or(0);
        for i in 0..count {
            if let Ok(s) = sessions.GetAt(i) {
                let other_src = s.SourceAppUserModelId().map(|id| id.to_string()).unwrap_or_default();
                if other_src != cur_src {
                    let _ = s.TryTogglePlayPauseAsync();
                    break;
                }
            }
        }
    }
    Ok(())
}
