; Extra installer steps (electron-builder includes this file).
;
; Windows keeps a cache of app icons and can go on showing an old one, e.g. in the taskbar's right-click
; menu, after the app's icon changes. After installing or updating, tell Windows to refresh its icons.
!macro customInstall
  ; SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST): file icons may have changed
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ; Rebuild the icon cache Windows 10 / 11 use for the taskbar and Start menu
  nsExec::Exec '"$SYSDIR\ie4uinit.exe" -show'
!macroend
