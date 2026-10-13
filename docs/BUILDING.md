# Build TaxiNow Pro / 构建指南

I keep the application source and release downloads together here. Building is
optional: use the installer above if you only want to run TaxiNow Pro. Any reuse
of the source or build output remains subject to [LICENSE](../LICENSE) and
[EULA.txt](../EULA.txt).

### Windows prerequisites

- .NET SDK 10.0.x and the Windows desktop build tools.
- Node.js 24, pnpm 11.5.3, and Python 3.12 (the versions used in CI).
- Microsoft Edge WebView2 Evergreen Runtime to run the desktop app.
- The MSFS SimConnect SDK for live MSFS tracking. The build looks for
  `MSFS_SDK_ROOT`, then `C:\MSFS 2024 SDK`, then `C:\MSFS SDK`.
- Inno Setup for creating the Windows installer.

```powershell
git clone https://github.com/skylarkning/TaxiNow.git
cd TaxiNow
.\scripts\build.ps1 -Configuration Release
```

The build compiles the shared web app, packages the Python map pipeline, builds
the .NET application, and runs the test suites. Without the SimConnect SDK,
maps and replay remain available but live MSFS tracking does not.

Create the self-contained Windows installer and portable ZIP:

```powershell
.\scripts\package-windows.ps1
```

Run the local server or Windows desktop shell:

```powershell
dotnet run --project .\src\TaxiNow.Server
# Browser: http://127.0.0.1:8780
dotnet run --project .\src\TaxiNow.App
```

For development without a running simulator:

```powershell
$env:TaxiNow__TelemetryMode = 'replay'
dotnet run --project .\src\TaxiNow.App
```

The shared MapLibre web app lives in `src/TaxiNow.Web`, the WPF/WebView2 shell in
`src/TaxiNow.App`, the local service in `src/TaxiNow.Server`, and the acquisition
pipeline in `tools/map_pipeline`. I document implementation details in the
[development guide](../docs/DEVELOPMENT.md), simulator setup in
[Windows environment notes](../docs/WINDOWS_ENVIRONMENT.md), packaging in
[distribution notes](../docs/DISTRIBUTION.md), and regional map generation in the
[local map-pack builder guide](../docs/LOCAL_MAP_PACK_BUILDER.md).

Airport geometry from OpenStreetMap is © OpenStreetMap contributors and licensed
under ODbL 1.0. The included CYYZ regression asset retains its attribution in
metadata and the map UI. See [NOTICE](../NOTICE) for data and component licenses.

### 从源代码构建

我在本仓库统一维护程序源代码和发布下载。如果只想使用 TaxiNow Pro，
直接下载上方安装包即可。源代码及构建产物的复用仍须遵守许可证和 EULA。

在 Windows 上准备 .NET SDK 10.0.x、Node.js 24、pnpm 11.5.3、Python 3.12
及 WebView2 Runtime，然后运行上方构建命令。实时连接 MSFS 需要 SimConnect SDK，
制作安装包需要 Inno Setup。开发细节请参阅上述文档。
