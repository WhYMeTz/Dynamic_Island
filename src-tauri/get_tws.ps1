# Script untuk membaca perangkat Bluetooth Audio/TWS yang aktif dan baterai aslinya
$devices = Get-PnpDevice -Class 'Bluetooth' -Status 'OK' -ErrorAction SilentlyContinue

$found = $null
foreach ($dev in $devices) {
    $name = $dev.FriendlyName
    if ($name -match 'Adapter|Enumerator|Transport|Protocol|Service') {
        continue
    }

    # Cek apakah device ini punya property battery level
    $prop = Get-PnpDeviceProperty -InstanceId $dev.InstanceId -KeyName '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2' -ErrorAction SilentlyContinue
    if ($prop -and $prop.Data -ne $null) {
        $found = [PSCustomObject]@{
            Name = $name
            Battery = [int]$prop.Data
            Connected = $true
        }
        break
    }
}

# Jika tidak ada yang punya property baterai tapi ada AudioEndpoint aktif non-speaker
if (-not $found) {
    $audioEndpoints = Get-PnpDevice -Class 'AudioEndpoint' -Status 'OK' -ErrorAction SilentlyContinue
    foreach ($audio in $audioEndpoints) {
        $aname = $audio.FriendlyName
        if ($aname -notmatch 'Realtek|Speaker|Microphone|High Definition|NVIDIA|AMD|Default|FxSound') {
            # Cari nama aslinya
            $cleanName = $aname -replace '^Headphones \((.*)\)$', '$1' -replace '^Headset \((.*)\)$', '$1'
            # Cek baterai di registry atau PnP device
            $bthDev = Get-PnpDevice -FriendlyName "*$cleanName*" -Status 'OK' -ErrorAction SilentlyContinue | Select-Object -First 1
            $bat = 0
            if ($bthDev) {
                $bprop = Get-PnpDeviceProperty -InstanceId $bthDev.InstanceId -KeyName '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2' -ErrorAction SilentlyContinue
                if ($bprop -and $bprop.Data -ne $null) {
                    $bat = [int]$bprop.Data
                }
            }
            $found = [PSCustomObject]@{
                Name = $cleanName
                Battery = $bat
                Connected = $true
            }
            break
        }
    }
}

if ($found) {
    $found | ConvertTo-Json -Compress
} else {
    '{"Connected":false,"Name":"","Battery":0}'
}
