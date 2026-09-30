param([Parameter(Mandatory=$true)][int]$ApplicationProcessId,[Parameter(Mandatory=$true)][string]$SelectedPath)
$ErrorActionPreference='Stop'
# Common-dialog controls are not consistently exposed through UI Automation.
# This helper only operates the isolated test application's native file picker.
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class CollaborationPicker {
  private delegate bool Enumerate(IntPtr hwnd, IntPtr data);
  [DllImport("user32.dll")] private static extern bool EnumWindows(Enumerate callback, IntPtr data);
  [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr hwnd, Enumerate callback, IntPtr data);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr hwnd, StringBuilder name, int length);
  [DllImport("user32.dll")] private static extern int GetDlgCtrlID(IntPtr hwnd);
  [DllImport("user32.dll", EntryPoint="SendMessageW")] private static extern IntPtr SendNumber(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);
  [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam);
  private static string ClassName(IntPtr hwnd) { var b=new StringBuilder(256); GetClassName(hwnd,b,b.Capacity); return b.ToString(); }
  public static bool Choose(int pid, string path) {
    bool selected=false;
    EnumWindows((window,data)=> {
      uint owner; GetWindowThreadProcessId(window,out owner);
      if(owner!=(uint)pid || ClassName(window)!="#32770") return true;
      IntPtr edit=IntPtr.Zero;
      EnumChildWindows(window,(child,unused)=> {
        int id=GetDlgCtrlID(child);
        if(ClassName(child)=="Edit" && (id==1001 || id==1148)) edit=child;
        return true;
      },IntPtr.Zero);
      if(edit==IntPtr.Zero) return true;
      // WM_SETTEXT alone changes the visible edit without updating IFileDialog's
      // selected filename on some Windows builds. Character input raises change events.
      SendNumber(edit,0x00B1,IntPtr.Zero,new IntPtr(-1));
      SendNumber(edit,0x0303,IntPtr.Zero,IntPtr.Zero);
      foreach(char c in path) SendNumber(edit,0x0102,new IntPtr(c),new IntPtr(1));
      PostMessage(window,0x0111,new IntPtr(1),IntPtr.Zero);
      selected=true; return false;
    },IntPtr.Zero);
    return selected;
  }
  public static string Describe(int pid) {
    var output=new StringBuilder();
    EnumWindows((window,data)=> {
      uint owner; GetWindowThreadProcessId(window,out owner);
      if(owner!=(uint)pid) return true;
      output.AppendLine("Window "+ClassName(window));
      EnumChildWindows(window,(child,unused)=> { output.AppendLine(GetDlgCtrlID(child)+" "+ClassName(child)); return true; },IntPtr.Zero);
      return true;
    },IntPtr.Zero);
    return output.ToString();
  }
}
'@
$deadline=[DateTime]::UtcNow.AddSeconds(25)
while ([DateTime]::UtcNow -lt $deadline) {
  if ([CollaborationPicker]::Choose($ApplicationProcessId,$SelectedPath)) { exit 0 }
  Start-Sleep -Milliseconds 150
}
Write-Output ([CollaborationPicker]::Describe($ApplicationProcessId))
throw 'No native file picker found for the isolated test process.'
