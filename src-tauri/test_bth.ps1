# Test properties on Soundcore Life Note 3i
$dev = Get-PnpDevice -FriendlyName '*Soundcore*' | Select-Object -First 1

if ($dev) {
    Write-Host "Device ID: " $dev.InstanceId
    Write-Host "Status: " $dev.Status
    
    # Check present
    $present = Get-PnpDeviceProperty -InstanceId $dev.InstanceId -KeyName '{A8B865DD-2E3D-4094-AD97-E593A70C75D6} 19' -ErrorAction SilentlyContinue
    Write-Host "DEVPKEY_Device_IsPresent: " ($present.Data)

    # Check connection status in AEP or Bluetooth
    $conn = Get-PnpDeviceProperty -InstanceId $dev.InstanceId -KeyName '{A45C254E-DF1C-4EFD-8020-67D146A850E0} 2' -ErrorAction SilentlyContinue
    Write-Host "Device Connected Property: " ($conn.Data)
    
    # Check Audio Endpoint
    $audio = Get-PnpDevice -Class 'AudioEndpoint' -Status 'OK' | Where-Object { $_.FriendlyName -match 'Soundcore' }
    Write-Host "Audio Endpoint Active: " ($audio -ne $null)
} else {
    Write-Host "Soundcore not found"
}
