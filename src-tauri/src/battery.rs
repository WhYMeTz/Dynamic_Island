use serde::Serialize;

#[repr(C)]
#[derive(Default, Debug, Clone, Copy)]
#[allow(non_snake_case)]
struct SYSTEM_POWER_STATUS {
    ACLineStatus: u8,
    BatteryFlag: u8,
    BatteryLifePercent: u8,
    SystemStatusFlag: u8,
    BatteryLifeTime: u32,
    BatteryFullLifeTime: u32,
}

unsafe extern "system" {
    fn GetSystemPowerStatus(lpSystemPowerStatus: *mut SYSTEM_POWER_STATUS) -> i32;
}

#[derive(Serialize, Clone, Debug)]
pub struct BatteryInfo {
    pub percentage: u8,
    pub is_charging: bool,
    pub has_battery: bool,
}

pub fn get_system_battery() -> BatteryInfo {
    let mut status = SYSTEM_POWER_STATUS::default();
    let result = unsafe { GetSystemPowerStatus(&mut status) };

    if result != 0 {
        // BatteryFlag 128 = No system battery (desktop PC)
        let has_battery = status.BatteryFlag != 128 && status.BatteryLifePercent <= 100;
        let percentage = if status.BatteryLifePercent <= 100 {
            status.BatteryLifePercent
        } else {
            100 // Fallback untuk desktop PC
        };

        // ACLineStatus: 1 = Online (Plugged in / Charging), 0 = Offline (On Battery)
        let is_charging = status.ACLineStatus == 1;

        BatteryInfo {
            percentage,
            is_charging,
            has_battery,
        }
    } else {
        BatteryInfo {
            percentage: 100,
            is_charging: true,
            has_battery: false,
        }
    }
}
