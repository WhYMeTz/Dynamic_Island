$devs = Get-PnpDevice | Where-Object { $_.InstanceId -match 'B038E212E543' }
foreach ($d in $devs) {
    Write-Host "Checking: " $d.InstanceId " (" $d.FriendlyName ")"
    $props = Get-PnpDeviceProperty -InstanceId $d.InstanceId -ErrorAction SilentlyContinue | Where-Object { $_.Data -ne $null }
    foreach ($p in $props) {
        if ($p.KeyName -match 'Battery|104EA319' -or ($p.Data -is [byte] -and $p.Data -gt 0 -and $p.Data -le 100)) {
            Write-Host "   Property: " $p.KeyName " Type: " $p.Type " Data: " $p.Data
        }
    }
}
