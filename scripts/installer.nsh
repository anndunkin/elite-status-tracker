; installer.nsh — Custom NSIS macros for Elite Status Tracker

!macro preInit
  ; intentionally empty — path override happens in customInit
!macroend

!macro customInit
  StrCpy $INSTDIR "$EXEDIR\Elite Status Tracker"
!macroend

!macro customInstall
!macroend

!macro customUnInstall
!macroend
