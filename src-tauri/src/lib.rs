use tauri::{Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewWindow};

mod battery;
mod cursor;
mod media;
mod tws;
mod volume;

unsafe extern "system" {
    fn SetWindowPos(
        hwnd: isize,
        hwnd_insert_after: isize,
        x: i32,
        y: i32,
        cx: i32,
        cy: i32,
        flags: u32,
    ) -> i32;
}

// Command untuk mengubah ukuran dan reposisi Dynamic Island ke tengah atas layar
#[tauri::command]
fn resize_island(window: WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    if let Ok(Some(monitor)) = window.current_monitor() {
        let scale_factor = window.scale_factor().unwrap_or(1.0);
        let phys_width = (width * scale_factor).round() as i32;
        let phys_height = (height * scale_factor).round() as i32;

        let monitor_pos = monitor.position();
        let monitor_size = monitor.size();

        // Hitung posisi horizontal tepat di tengah monitor
        let center_x = monitor_pos.x + ((monitor_size.width as i32 - phys_width) / 2);
        let top_y = monitor_pos.y; // Menempel tepat di atas monitor

        // Cek jika ukuran dan posisi sudah sama persis, abaikan agar tidak ada re-render sia-sia
        if let (Ok(cur_pos), Ok(cur_size)) = (window.outer_position(), window.outer_size()) {
            if cur_pos.x == center_x && cur_pos.y == top_y && cur_size.width as i32 == phys_width && cur_size.height as i32 == phys_height {
                return Ok(());
            }
        }

        // Terapkan ukuran dan posisi secara ATOMIK dalam 1 frame Win32 menggunakan SetWindowPos
        // SWP_NOZORDER (0x0004) | SWP_NOACTIVATE (0x0010) = 0x0014
        if let Ok(hwnd) = window.hwnd() {
            unsafe {
                SetWindowPos(hwnd.0 as isize, 0, center_x, top_y, phys_width, phys_height, 0x0014);
            }
        } else {
            let _ = window.set_size(Size::Physical(PhysicalSize::new(phys_width as u32, phys_height as u32)));
            let _ = window.set_position(Position::Physical(PhysicalPosition::new(center_x, top_y)));
        }

        Ok(())
    } else {
        Err("Monitor tidak ditemukan".to_string())
    }
}

#[tauri::command]
fn set_click_through(window: WebviewWindow, ignore: bool) -> Result<(), String> {
    window.set_ignore_cursor_events(ignore).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_system_username() -> String {
    std::env::var("USERNAME")
        .or_else(|_| std::env::var("USER"))
        .unwrap_or_else(|_| "User".to_string())
}

// Global Cursor & Eye Tracker Command
#[tauri::command]
fn get_eye_tracker_info(window: WebviewWindow) -> cursor::EyeTrackerInfo {
    cursor::get_eye_tracker_info(&window)
}

// Battery Status Command
#[tauri::command]
fn get_battery_info() -> Result<battery::BatteryInfo, String> {
    Ok(battery::get_system_battery())
}

// TWS / Bluetooth Earbuds Command
#[tauri::command]
fn get_tws_info() -> Result<tws::TwsInfo, String> {
    Ok(tws::get_current_tws())
}

// Media Control Commands
#[tauri::command]
fn get_media_info() -> Result<media::MediaInfo, String> {
    media::get_current_media_info()
}

#[tauri::command]
async fn media_toggle_play() -> Result<(), String> {
    media::toggle_play_pause().await
}

#[tauri::command]
async fn media_next() -> Result<(), String> {
    media::next_track().await
}

#[tauri::command]
async fn media_prev() -> Result<(), String> {
    media::prev_track().await
}

#[tauri::command]
fn get_volume_info() -> Result<volume::VolumeInfo, String> {
    volume::get_master_volume()
}

#[tauri::command]
async fn swap_media_session() -> Result<(), String> {
    media::swap_media_session().await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            tws::start_tws_monitor();
            volume::start_volume_monitor(app.handle().clone());

            if let Some(window) = app.get_webview_window("main") {
                // Posisi awal saat aplikasi dibuka: ukuran canvas 600x155 di tengah atas monitor
                let _ = resize_island(window, 600.0, 155.0);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            resize_island,
            set_click_through,
            get_system_username,
            get_eye_tracker_info,
            get_battery_info,
            get_tws_info,
            get_media_info,
            media_toggle_play,
            media_next,
            media_prev,
            swap_media_session,
            get_volume_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
