; The installer asks where to install, but not for whom: it always installs for the
; current user, so neither installing nor updating needs administrator rights.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend
