# Launched by Task Scheduler at logon. Keeps the dose-suggestion sidecar
# alive across reboots/logoffs without a visible console window.
Set-Location -Path $PSScriptRoot
npm start *> "$PSScriptRoot\service.log"
