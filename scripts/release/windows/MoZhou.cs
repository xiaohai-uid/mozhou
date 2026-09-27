using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class MoZhou
{
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
    private static readonly object LogLock = new object();
    private static string data;
    private static string log;
    private static Process server;
    private static bool headless;
    private static bool stopping;

    [STAThread]
    private static int Main(string[] args)
    {
        data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MoZhou");
        bool stop = false, noOpen = false;
        for (int i = 0; i < args.Length; i++)
        {
            if (args[i] == "--data-dir" && i + 1 < args.Length) data = Path.GetFullPath(args[++i]);
            else if (args[i] == "--stop") stop = true;
            else if (args[i] == "--no-open") noOpen = true;
            else if (args[i] == "--headless") headless = true;
            else return 2;
        }
        string identity;
        using (var sha = SHA256.Create()) identity = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(data.ToUpperInvariant()))).Replace("-", "");
        string mutexName = "Local\\MoZhou-" + identity;
        string stopName = mutexName + "-stop";
        if (stop)
        {
            try {
                using (var evt = EventWaitHandle.OpenExisting(stopName)) evt.Set();
                using (var running = Mutex.OpenExisting(mutexName)) {
                    try { if (!running.WaitOne(20000)) return 1; }
                    catch (AbandonedMutexException) { }
                    running.ReleaseMutex();
                }
            } catch (WaitHandleCannotBeOpenedException) { }
            return 0;
        }
        Directory.CreateDirectory(data);
        log = Path.Combine(data, "desktop.log");
        bool created;
        using (var single = new Mutex(true, mutexName, out created))
        {
            if (!created) {
                if (!noOpen) {
                    try { OpenBrowser(ReadRunningUrl()); }
                    catch { MessageBox.Show("墨舟正在启动，请稍后从托盘打开工作台。", "墨舟"); }
                }
                return 0;
            }
            try {
                using (var stopEvent = new EventWaitHandle(false, EventResetMode.ManualReset, stopName))
                {
                    string url = StartServer();
                    Application.EnableVisualStyles();
                    using (var tray = new NotifyIcon())
                    using (var menu = new ContextMenuStrip())
                    using (var timer = new System.Windows.Forms.Timer())
                    {
                        tray.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath) ?? SystemIcons.Application;
                        tray.Text = "墨舟 · 本地写作工作台";
                        menu.Items.Add("打开墨舟", null, delegate { OpenBrowser(url); });
                        menu.Items.Add("打开书稿与数据目录", null, delegate { Process.Start("explorer.exe", data); });
                        menu.Items.Add("退出墨舟", null, delegate { stopEvent.Set(); });
                        tray.ContextMenuStrip = menu;
                        tray.DoubleClick += delegate { OpenBrowser(url); };
                        tray.Visible = !headless;
                        timer.Interval = 200;
                        timer.Tick += delegate {
                            if (stopEvent.WaitOne(0) || server.HasExited) {
                                timer.Stop();
                                bool unexpected = server.HasExited && !stopping && !stopEvent.WaitOne(0);
                                StopServer();
                                tray.Visible = false;
                                if (unexpected && !headless) MessageBox.Show("本地服务已退出。请重新打开墨舟；详情见数据目录 desktop.log。", "墨舟");
                                Application.ExitThread();
                            }
                        };
                        timer.Start();
                        if (!noOpen) OpenBrowser(url);
                        Application.Run();
                    }
                }
                return 0;
            } catch (Exception error) {
                WriteLog(error.ToString());
                if (!headless) MessageBox.Show("墨舟启动失败：" + error.Message + "\n\n日志：" + log, "墨舟", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            } finally {
                StopServer();
                single.ReleaseMutex();
            }
        }
    }

    private static string StartServer()
    {
        string folder = AppDomain.CurrentDomain.BaseDirectory;
        int port = FindStablePort();
        var info = new ProcessStartInfo(Path.Combine(folder, "runtime", "node.exe"), "\"" + Path.Combine(folder, "desktop-server.mjs") + "\"");
        info.WorkingDirectory = folder;
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.RedirectStandardInput = true;
        info.RedirectStandardOutput = true;
        info.RedirectStandardError = true;
        info.StandardOutputEncoding = Encoding.UTF8;
        info.StandardErrorEncoding = Encoding.UTF8;
        info.EnvironmentVariables["MOZHOU_DATA_ROOT"] = data;
        info.EnvironmentVariables["PORT"] = port.ToString();
        server = new Process();
        server.StartInfo = info;
        server.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) WriteLog(e.Data); };
        server.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e) { if (e.Data != null) WriteLog(e.Data); };
        server.Start();
        server.BeginOutputReadLine();
        server.BeginErrorReadLine();
        string url = "http://127.0.0.1:" + port;
        for (int i = 0; i < 120; i++) {
            if (server.HasExited) throw new Exception("本地服务退出，代码 " + server.ExitCode);
            try {
                var health = Health(url);
                if (Convert.ToInt32(health["pid"]) == server.Id && Convert.ToBoolean(health["ok"])) {
                    File.WriteAllText(Path.Combine(data, "desktop-session.json"), Json.Serialize(new { url = url, pid = server.Id, launcherPid = Process.GetCurrentProcess().Id }), Encoding.UTF8);
                    return url;
                }
            } catch (WebException) { }
            Thread.Sleep(250);
        }
        throw new Exception("本地服务启动超时，请查看日志。");
    }

    private static int FindStablePort()
    {
        // Keep the browser origin stable across restarts so its localStorage can
        // restore the last active book. The fallback still handles an unrelated
        // process already owning the deterministic port.
        byte[] digest;
        using (var sha = SHA256.Create()) digest = sha.ComputeHash(Encoding.UTF8.GetBytes(data.ToUpperInvariant()));
        int basePort = 43000 + (((digest[0] << 8) | digest[1]) % 1000);
        for (int offset = 0; offset < 1000; offset++)
        {
            int port = 43000 + ((basePort - 43000 + offset) % 1000);
            TcpListener listener = null;
            try
            {
                listener = new TcpListener(IPAddress.Loopback, port);
                listener.Start();
                return port;
            }
            catch (SocketException) { }
            finally { if (listener != null) listener.Stop(); }
        }
        throw new Exception("没有可用的本地端口（43000-43999）。");
    }

    private static Dictionary<string, object> Health(string url)
    {
        var request = (HttpWebRequest)WebRequest.Create(url + "/api/health");
        request.Proxy = null;
        request.Timeout = 500;
        using (var response = request.GetResponse())
        using (var reader = new StreamReader(response.GetResponseStream()))
            return Json.Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
    }

    private static string ReadRunningUrl()
    {
        var state = Json.Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(data, "desktop-session.json")));
        string url = Convert.ToString(state["url"]);
        var uri = new Uri(url);
        if (uri.Scheme != "http" || uri.Host != "127.0.0.1") throw new Exception("Invalid local address");
        if (Convert.ToInt32(Health(url)["pid"]) != Convert.ToInt32(state["pid"])) throw new Exception("Stale session");
        return url;
    }

    private static void OpenBrowser(string url) { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
    private static void WriteLog(string text) {
        lock (LogLock) {
            try { File.AppendAllText(log, DateTime.UtcNow.ToString("o") + " " + text + Environment.NewLine, Encoding.UTF8); }
            catch (IOException) { }
        }
    }
    private static void StopServer()
    {
        if (server == null || stopping) return;
        stopping = true;
        try {
            if (!server.HasExited) {
                server.StandardInput.WriteLine("shutdown");
                server.StandardInput.Flush();
                if (!server.WaitForExit(15000)) {
                    WriteLog("Server exceeded shutdown timeout; terminating owned process.");
                    server.Kill();
                    server.WaitForExit(5000);
                }
            }
        } catch (InvalidOperationException) { }
          catch (IOException) { }
        finally { server.Dispose(); }
    }
}
