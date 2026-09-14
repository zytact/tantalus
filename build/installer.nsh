!ifndef BUILD_UNINSTALLER
  Var legacyTauriInstall

  !macro customInit
    StrCpy $legacyTauriInstall "false"
    ReadRegStr $0 HKCU "Software\Arnab\${PRODUCT_NAME}" ""
    ${If} $0 != ""
      StrCpy $legacyTauriInstall "true"
      StrCpy $INSTDIR $0
    ${EndIf}
  !macroend

  !macro customInstall
    ${If} $legacyTauriInstall == "true"
      Delete "$INSTDIR\uninstall.exe"
      DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"
      DeleteRegKey HKCU "Software\Arnab\${PRODUCT_NAME}"
      DeleteRegKey /ifempty HKCU "Software\Arnab"
    ${EndIf}
  !macroend
!endif
