use serde::{Deserialize, Serialize};
use std::process::Command;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct TwsInfo {
    pub is_connected: bool,
    pub name: String,
    pub battery_percentage: u8,
}

static CURRENT_TWS: Mutex<Option<TwsInfo>> = Mutex::new(None);

pub fn start_tws_monitor() {
    thread::spawn(|| {
        loop {
            let info = check_connected_tws();
            if let Ok(mut lock) = CURRENT_TWS.lock() {
                *lock = Some(info);
            }
            thread::sleep(Duration::from_millis(2000));
        }
    });
}

pub fn get_current_tws() -> TwsInfo {
    if let Ok(lock) = CURRENT_TWS.lock() {
        if let Some(info) = &*lock {
            return info.clone();
        }
    }
    TwsInfo::default()
}

const TWS_SCRIPT: &str = r#"
$audio = Get-PnpDevice -Class 'AudioEndpoint' -Status 'OK' -ErrorAction SilentlyContinue | Where-Object { 
    $_.FriendlyName -notmatch 'Realtek|Speaker|Microphone|High Definition|NVIDIA|AMD|Default|FxSound' 
} | Select-Object -First 1

if ($audio) {
    $rawName = $audio.FriendlyName
    $cleanName = $rawName -replace '^Headphones \((.*)\)$', '$1' -replace '^Headset \((.*)\)$', '$1' -replace '^Speakers \((.*)\)$', '$1'
    
    $battery = 0
    $bthDevs = Get-PnpDevice -FriendlyName "*$cleanName*" -ErrorAction SilentlyContinue
    foreach ($d in $bthDevs) {
        $p = Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2' -ErrorAction SilentlyContinue
        if ($p -and $p.Data -ne $null -and $p.Data -gt 0 -and $p.Data -le 100) {
            $battery = [int]$p.Data
            break
        }
    }
    
    if ($battery -eq 0) {
        $allBthWithBat = Get-PnpDevice -Class 'Bluetooth' -ErrorAction SilentlyContinue
        foreach ($d in $allBthWithBat) {
            $p = Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2' -ErrorAction SilentlyContinue
            if ($p -and $p.Data -ne $null -and $p.Data -gt 0 -and $p.Data -le 100) {
                $battery = [int]$p.Data
                break
            }
        }
    }

    [PSCustomObject]@{
        is_connected = $true
        name = $cleanName
        battery_percentage = $battery
    } | ConvertTo-Json -Compress
} else {
    '{"is_connected":false,"name":"","battery_percentage":0}'
}
"#;

fn check_connected_tws() -> TwsInfo {
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", TWS_SCRIPT]);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    if let Ok(output) = cmd.output() {
        if let Ok(text) = String::from_utf8(output.stdout) {
            let trimmed = text.trim();
            if let Ok(info) = serde_json::from_str::<TwsInfo>(trimmed) {
                return info;
            }
        }
    }

    TwsInfo::default()
}
