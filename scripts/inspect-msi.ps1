param([string]$Path)

$installer = New-Object -ComObject WindowsInstaller.Installer
$db = $installer.GetType().InvokeMember('OpenDatabase','InvokeMethod',$null,$installer,@($Path, 0))
$view = $db.GetType().InvokeMember('OpenView','InvokeMethod',$null,$db,@('SELECT File, FileName, FileSize FROM File ORDER BY FileSize DESC'))
$null = $view.GetType().InvokeMember('Execute','InvokeMethod',$null,$view,$null)
$count = 0
$total = 0
while ($true) {
    $rec = $view.GetType().InvokeMember('Fetch','InvokeMethod',$null,$view,$null)
    if ($null -eq $rec) { break }
    $name = $rec.GetType().InvokeMember('StringData','GetProperty',$null,$rec,@(2))
    $size = $rec.GetType().InvokeMember('IntegerData','GetProperty',$null,$rec,@(3))
    Write-Output ("{0,12} {1}" -f $size, $name)
    $count++
    $total += $size
}
Write-Output ("---")
Write-Output ("count={0}  total_bytes={1}" -f $count, $total)
