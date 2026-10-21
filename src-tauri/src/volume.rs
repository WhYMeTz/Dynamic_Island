use serde::{Deserialize, Serialize};
use windows::core::BOOL;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{
    eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
};

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct VolumeInfo {
    pub volume: u8,
    pub is_muted: bool,
}

pub fn get_master_volume() -> Result<VolumeInfo, String> {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| e.to_string())?;
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eMultimedia)
            .map_err(|e| e.to_string())?;
        let endpoint_volume: IAudioEndpointVolume =
            device.Activate(CLSCTX_ALL, None).map_err(|e| e.to_string())?;

        let level = endpoint_volume
            .GetMasterVolumeLevelScalar()
            .map_err(|e| e.to_string())?;

        let muted: BOOL = endpoint_volume
            .GetMute()
            .map_err(|e| e.to_string())?;

        Ok(VolumeInfo {
            volume: (level * 100.0).round() as u8,
            is_muted: muted.as_bool(),
        })
    }
}

pub fn start_volume_monitor(app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        use tauri::Emitter;
        let mut last_vol: Option<u8> = None;
        let mut last_muted: Option<bool> = None;

        loop {
            if let Ok(info) = get_master_volume() {
                let changed = match (last_vol, last_muted) {
                    (Some(v), Some(m)) => v != info.volume || m != info.is_muted,
                    _ => false,
                };

                last_vol = Some(info.volume);
                last_muted = Some(info.is_muted);

                if changed {
                    let _ = app_handle.emit("volume-changed", &info);
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(80));
        }
    });
}
