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
