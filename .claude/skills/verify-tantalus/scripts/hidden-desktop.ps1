# Starts a command on a separate, named Windows desktop, the Windows counterpart of Xvfb.
# Its windows are real and render, but they never show on the user's screen or take focus.
# The desktop goes away once the last process on it exits.
#
# Prints the process ID of the command it started.
#
#   hidden-desktop.ps1 <desktop name> <base64 of the UTF-8 command line>
param([string]$Desktop, [string]$CommandLine64)
Add-Type @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class HiddenDesktop {
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern IntPtr CreateDesktop(string name, IntPtr device, IntPtr mode, uint flags, uint access, IntPtr attributes);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct STARTUPINFO {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
  }
  [StructLayout(LayoutKind.Sequential)]
  struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool CreateProcess(string app, string command, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  public static int Launch(string desktop, string command) {
    // 0x10000000 is GENERIC_ALL. Opening an existing desktop of the same name also succeeds.
    if (CreateDesktop(desktop, IntPtr.Zero, IntPtr.Zero, 0, 0x10000000, IntPtr.Zero) == IntPtr.Zero) throw new Win32Exception();
    var si = new STARTUPINFO(); si.cb = Marshal.SizeOf(si); si.lpDesktop = desktop;
    PROCESS_INFORMATION pi;
    if (!CreateProcess(null, command, IntPtr.Zero, IntPtr.Zero, false, 0, IntPtr.Zero, null, ref si, out pi)) throw new Win32Exception();
    return pi.dwProcessId;
  }
}
"@
[HiddenDesktop]::Launch($Desktop, [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($CommandLine64)))
