; One-time NSIS migration from the pre-V2 display name.
; Technical identity and user data stay under com.a2ui.terminal. This hook only
; removes the legacy program files/installer registration before installing the
; renamed product. /UPDATE keeps app data and skips the uninstaller data prompt.

Var A2uiLegacyInstallMigrated

!macro NSIS_HOOK_PREINSTALL
  StrCpy $A2uiLegacyInstallMigrated 0
  ReadRegStr $R8 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\A2UI Terminal" "UninstallString"
  ReadRegStr $R9 HKCU "Software\a2ui\A2UI Terminal" ""

  ${If} $R8 != ""
  ${AndIf} $R9 != ""
    DetailPrint "Migrating the existing A2UI Terminal installation without deleting app data..."
    StrCpy $R8 "$R8 /UPDATE /P _?=$R9"
    ClearErrors
    ExecWait '$R8' $R7
    ${If} ${Errors}
    ${OrIf} $R7 != 0
      MessageBox MB_ICONSTOP "The existing A2UI Terminal installation could not be upgraded safely. Your app data was not deleted."
      Abort
    ${EndIf}
    StrCpy $A2uiLegacyInstallMigrated 1
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $A2uiLegacyInstallMigrated = 1
    Delete "$DESKTOP\A2UI Terminal.lnk"
    Delete "$SMPROGRAMS\A2UI Terminal.lnk"
    DeleteRegKey HKCU "Software\a2ui\A2UI Terminal"
  ${EndIf}
!macroend

; Managed results are user-owned deliverables. The stock Tauri "Delete app
; data" option removes the entire application-data directory, including those
; files, while it cannot remove Credential Manager entries. Refuse that
; misleading partial wipe and direct users to the in-app, reviewed clear flow.
!macro NSIS_HOOK_PREUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
    MessageBox MB_ICONSTOP "To avoid deleting your managed results, A2UI Workbench cannot use the installer's Delete app data option. Reinstall or open the app, use Settings > Clear all local data, then uninstall without selecting this option."
    Abort
  ${EndIf}
!macroend
