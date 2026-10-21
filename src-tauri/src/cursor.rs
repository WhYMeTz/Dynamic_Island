use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

static PREV_FULLSCREEN: AtomicBool = AtomicBool::new(false);
static PREV_MAXIMIZED: AtomicBool = AtomicBool::new(false);

#[repr(C)]
#[derive(Default, Debug, Clone, Copy)]
struct POINT {
    x: i32,
    y: i32,
}

#[repr(C)]
#[derive(Default, Debug, Clone, Copy)]
struct RECT {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[repr(C)]
struct MONITORINFO {
    cb_size: u32,
    rc_monitor: RECT,
    rc_work: RECT,
    dw_flags: u32,
}

unsafe extern "system" {
    fn GetCursorPos(lpPoint: *mut POINT) -> i32;
    fn GetForegroundWindow() -> isize;
    fn GetAncestor(hwnd: isize, ga_flags: u32) -> isize;
    fn GetWindowRect(hwnd: isize, lpRect: *mut RECT) -> i32;
    fn GetShellWindow() -> isize;
    fn GetDesktopWindow() -> isize;
    fn IsZoomed(hwnd: isize) -> i32;
    fn GetWindowLongW(hwnd: isize, n_index: i32) -> i32;
    fn GetWindowThreadProcessId(hwnd: isize, lpdw_process_id: *mut u32) -> u32;
    fn GetCurrentProcessId() -> u32;
    fn MonitorFromWindow(hwnd: isize, dw_flags: u32) -> isize;
    fn GetMonitorInfoW(h_monitor: isize, lpmi: *mut MONITORINFO) -> i32;
    fn GetClassNameW(hwnd: isize, lpClassName: *mut u16, nMaxCount: i32) -> i32;
}

const GA_ROOT: u32 = 2;
const GWL_STYLE: i32 = -16;
const WS_MAXIMIZE: i32 = 0x01000000;
const MONITOR_DEFAULTTONEAREST: u32 = 2;

unsafe fn is_desktop_window(hwnd: isize) -> bool {
    if hwnd == 0 {
        return true;
    }
    if unsafe { hwnd == GetShellWindow() || hwnd == GetDesktopWindow() } {
        return true;
    }

    let mut class_buf = [0u16; 64];
    let len = unsafe { GetClassNameW(hwnd, class_buf.as_mut_ptr(), 64) };
    if len > 0 {
        let class_name = String::from_utf16_lossy(&class_buf[..len as usize]);
        if class_name == "Progman"
            || class_name == "WorkerW"
            || class_name == "Shell_TrayWnd"
            || class_name == "Shell_SecondaryTrayWnd"
        {
            return true;
        }
    }
    false
}

#[derive(Serialize, Clone, Debug)]
pub struct EyeTrackerInfo {
    pub cursor_x: i32,
    pub cursor_y: i32,
    pub window_x: i32,
    pub window_y: i32,
    pub window_width: u32,
    pub window_height: u32,
    pub is_foreground_fullscreen: bool,
    pub is_foreground_maximized: bool,
}

pub fn get_eye_tracker_info(window: &WebviewWindow) -> EyeTrackerInfo {
    let mut pt = POINT::default();
    unsafe {
        GetCursorPos(&mut pt);
    }

    let win_pos = window.outer_position().unwrap_or(PhysicalPosition::new(0, 0));
    let win_size = window.outer_size().unwrap_or(PhysicalSize::new(200, 50));

    let fg = unsafe { GetForegroundWindow() };

    let mut is_fullscreen = false;
    let mut is_maximized = false;

    // 1. Cek apakah foreground adalah Desktop (Progman/WorkerW) atau Taskbar Windows
    if unsafe { is_desktop_window(fg) } {
        // Desktop aktif (seluruh tab ditutup atau klik wallpaper/desktop):
        // Pastikan status fullscreen & maximized SELALU di-reset ke false!
        PREV_FULLSCREEN.store(false, Ordering::Relaxed);
        PREV_MAXIMIZED.store(false, Ordering::Relaxed);
    } else {
        let root = unsafe { GetAncestor(fg, GA_ROOT) };
        let target = if root != 0 { root } else { fg };

        if unsafe { is_desktop_window(target) } {
            PREV_FULLSCREEN.store(false, Ordering::Relaxed);
            PREV_MAXIMIZED.store(false, Ordering::Relaxed);
        } else {
            let mut pid = 0u32;
            unsafe { GetWindowThreadProcessId(target, &mut pid) };
            let my_pid = unsafe { GetCurrentProcessId() };

            if pid == my_pid {
                // Dynamic Island sendiri yang sedang diklik / berfokus.
                // Jangan pernah anggap fullscreen saat user berinteraksi dengan Dynamic Island!
                is_fullscreen = false;
                is_maximized = false;
            } else {
                let style = unsafe { GetWindowLongW(target, GWL_STYLE) };
                let zoomed = unsafe { IsZoomed(target) } != 0 || (style & WS_MAXIMIZE) != 0;

                let h_mon = unsafe { MonitorFromWindow(target, MONITOR_DEFAULTTONEAREST) };
                let mut mi = MONITORINFO {
                    cb_size: std::mem::size_of::<MONITORINFO>() as u32,
                    rc_monitor: RECT::default(),
                    rc_work: RECT::default(),
                    dw_flags: 0,
                };

                if h_mon != 0 && unsafe { GetMonitorInfoW(h_mon, &mut mi) } != 0 {
                    let mut win_rect = RECT::default();
                    if unsafe { GetWindowRect(target, &mut win_rect) } != 0 {
                        // Cek True Fullscreen (YouTube Fullscreen, F11, Game, dsb): menutupi seluruh monitor
                        if win_rect.left <= mi.rc_monitor.left 
                            && win_rect.top <= mi.rc_monitor.top 
                            && win_rect.right >= mi.rc_monitor.right 
                            && win_rect.bottom >= mi.rc_monitor.bottom {
                            is_fullscreen = true;
                        }

                        // Cek Maximized (Browser atau aplikasi layar penuh normal)
                        if zoomed || (
                            win_rect.left <= mi.rc_work.left + 10 
                            && win_rect.top <= mi.rc_work.top + 10 
                            && win_rect.right >= mi.rc_work.right - 10
                        ) {
                            is_maximized = true;
                        }
                    }
                }

                PREV_FULLSCREEN.store(is_fullscreen, Ordering::Relaxed);
                PREV_MAXIMIZED.store(is_maximized, Ordering::Relaxed);
            }
        }
    }

    EyeTrackerInfo {
        cursor_x: pt.x,
        cursor_y: pt.y,
        window_x: win_pos.x,
        window_y: win_pos.y,
        window_width: win_size.width,
        window_height: win_size.height,
        is_foreground_fullscreen: is_fullscreen,
        is_foreground_maximized: is_maximized,
    }
}
