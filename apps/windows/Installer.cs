using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Re:tone 설치")]
[assembly: AssemblyProduct("Re:tone")]
[assembly: AssemblyVersion("1.0.0.0")]
internal static class Installer {
    static readonly string InstallDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs/Retone");
    static readonly string[] Payloads = {"Retone.exe", "app.ico", "Uninstall.ps1", "README.txt"};
    static void Extract(string directory) {
        Directory.CreateDirectory(directory);
        foreach (string name in Payloads) {
            using (Stream input = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload." + name)) {
                if (input == null) throw new InvalidDataException("설치 파일이 손상되었습니다: " + name);
                using (Stream output = File.Create(Path.Combine(directory, name))) input.CopyTo(output);
            }
        }
    }
    static void Shortcut(string path) {
        Type shellType = Type.GetTypeFromProgID("WScript.Shell");
        object shell = Activator.CreateInstance(shellType);
        object link = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] {path});
        try {
            Type type = link.GetType();
            type.InvokeMember("TargetPath", BindingFlags.SetProperty, null, link, new object[] {Path.Combine(InstallDir, "Retone.exe")});
            type.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, link, new object[] {InstallDir});
            type.InvokeMember("Description", BindingFlags.SetProperty, null, link, new object[] {"Re:tone"});
            type.InvokeMember("IconLocation", BindingFlags.SetProperty, null, link, new object[] {Path.Combine(InstallDir, "app.ico") + ",0"});
            type.InvokeMember("Save", BindingFlags.InvokeMethod, null, link, null);
        } finally { Marshal.FinalReleaseComObject(link); Marshal.FinalReleaseComObject(shell); }
    }
    static void Install() {
        Extract(InstallDir);
        File.WriteAllText(Path.Combine(InstallDir, ".retone-install"), "retone-v2:1");
        Shortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Retone.lnk"));
        Shortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Retone.lnk"));
        using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\Retone")) {
            key.SetValue("DisplayName", "Re:tone"); key.SetValue("DisplayVersion", "1.0.0");
            key.SetValue("Publisher", "Re:tone"); key.SetValue("InstallLocation", InstallDir);
            key.SetValue("DisplayIcon", Path.Combine(InstallDir, "app.ico"));
            key.SetValue("UninstallString", "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"" + Path.Combine(InstallDir, "Uninstall.ps1") + "\"");
            key.SetValue("URLInfoAbout", "https://retone-v2-mygr.onrender.com/");
            key.SetValue("NoModify", 1); key.SetValue("NoRepair", 1);
        }
    }
    [STAThread] static int Main(string[] args) {
        Application.EnableVisualStyles();
        try {
            if (args.Length == 1 && args[0] == "/verify") {
                foreach (string name in Payloads) using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload." + name)) if (s == null || s.Length == 0) return 1;
                return 0;
            }
            if (args.Length == 2 && args[0] == "/extract") { Extract(Path.GetFullPath(args[1])); return 0; }
            if (args.Length == 2 && args[0] == "/verify-shortcut") { Shortcut(Path.GetFullPath(args[1])); return 0; }
            using (Form form = new Form()) {
                form.Text = "Re:tone 설치"; form.ClientSize = new Size(440, 305); form.FormBorderStyle = FormBorderStyle.FixedDialog;
                form.MaximizeBox = false; form.StartPosition = FormStartPosition.CenterScreen; form.BackColor = Color.FromArgb(247, 240, 229);
                form.Font = new Font("Malgun Gothic", 10);
                Label title = new Label {Text = "Re:tone", Font = new Font("Malgun Gothic", 25, FontStyle.Bold), AutoSize = true, Location = new Point(28, 26)};
                Label body = new Label {Text = "대화의 다음을 더 좋게.\n\n현재 계정과 기능을 그대로 사용합니다.\n기능 업데이트는 앱을 다시 열 때 반영됩니다.\n인터넷 연결과 Edge 또는 Chrome이 필요합니다.", Location = new Point(31, 91), Size = new Size(382, 125)};
                Button install = new Button {Text = "설치", Location = new Point(276, 242), Size = new Size(130, 40), BackColor = Color.FromArgb(215, 230, 94), FlatStyle = FlatStyle.Flat};
                install.Click += delegate {
                    try {
                        if (Launcher.FindBrowser() == null) { MessageBox.Show(form, "먼저 Microsoft Edge 또는 Google Chrome을 설치해 주세요.", "Re:tone"); return; }
                        install.Enabled = false; Install();
                        MessageBox.Show(form, "설치가 완료되었습니다. 바탕 화면의 Re:tone 앱을 실행해 주세요.\n(파일 이름은 Windows 제한 때문에 Retone으로 표시됩니다.)", "Re:tone");
                        form.Close();
                    } catch (Exception e) { install.Enabled = true; MessageBox.Show(form, "설치하지 못했습니다.\n" + e.Message, "Re:tone"); }
                };
                form.Controls.AddRange(new Control[] {title, body, install}); Application.Run(form);
            }
            return 0;
        } catch (Exception e) { MessageBox.Show(e.Message, "Re:tone 설치"); return 1; }
    }
}
