using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
using System.Reflection;

#if !INSTALLER
[assembly: AssemblyTitle("Re:tone")]
[assembly: AssemblyProduct("Re:tone")]
[assembly: AssemblyVersion("1.0.0.0")]
#endif
internal static class Launcher {
    internal const string AppUrl = "https://retone-v2-mygr.onrender.com/?source=desktop";
    internal static string FindBrowser() {
        foreach (string path in new [] {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft/Edge/Application/msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft/Edge/Application/msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft/Edge/Application/msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Google/Chrome/Application/chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Google/Chrome/Application/chrome.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Google/Chrome/Application/chrome.exe")
        }) if (File.Exists(path)) return path;
        return null;
    }
    [STAThread] static int Main(string[] args) {
        string browser = FindBrowser();
        if (args.Length == 1 && args[0] == "/verify") return browser == null ? 2 : 0;
        if (browser == null) {
            MessageBox.Show("Re:tone을 실행하려면 Microsoft Edge 또는 Google Chrome을 설치해 주세요.", "Re:tone");
            return 2;
        }
        string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Retone/Browser");
        try {
            Process.Start(new ProcessStartInfo(browser, "--app=\"" + AppUrl + "\" --user-data-dir=\"" + profile + "\" --no-first-run --no-default-browser-check") { UseShellExecute = false });
            return 0;
        } catch (Exception e) {
            MessageBox.Show("앱을 실행할 수 없습니다.\n" + e.Message, "Re:tone"); return 1;
        }
    }
}
