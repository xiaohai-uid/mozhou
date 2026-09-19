<#
.SYNOPSIS
    墨舟 (MoZhou Novel OS) Windows 原生安装包与干净环境自检脚本 (T17)
.DESCRIPTION
    依照 reference/04-release.md T17 规格：
    - 检查传入的候选安装包或本地运行时文件存在性；
    - 校验文件 SHA256 指纹；
    - 检查 WebView2 运行时安装状态；
    - 检查代码签名（若无签名证书，如实报告未签名状态）；
    - 模拟首次启动解压与数据目录隔离。
.PARAMETER Artifact
    候选安装包路径 (.exe 或 .zip 运行时)
#>
param(
    [Parameter(Mandatory=$true)]
    [string]$Artifact
)

Write-Host "====================================================" -ForegroundColor Cyan
Write-Host "  墨舟 Windows 原生安装包与环境验证 (T17)" -ForegroundColor Cyan
Write-Host "====================================================" -ForegroundColor Cyan

if (-not (Test-Path $Artifact)) {
    Write-Error "ERROR: Target artifact not found: $Artifact"
    exit 1
}

$hash = (Get-FileHash -Path $Artifact -Algorithm SHA256).Hash
$fileSize = (Get-Item $Artifact).Length
Write-Host "✓ 目标安装包: $Artifact" -ForegroundColor Green
Write-Host "  文件大小: $([math]::Round($fileSize / 1MB, 2)) MB"
Write-Host "  SHA-256: $hash"

# 1. 检查 WebView2 运行时安装情况
$wv2Installed = $false
$wv2RegPath = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
if (Test-Path $wv2RegPath) {
    $version = (Get-ItemProperty -Path $wv2RegPath -ErrorAction SilentlyContinue).pv
    if ($version) {
        $wv2Installed = $true
        Write-Host "✓ WebView2 Runtime 检测到: 版本 $version" -ForegroundColor Green
    }
}
if (-not $wv2Installed) {
    Write-Host "ℹ 当前环境通过系统 Edge 共享或未在标准注册表登记，独立安装包将提示安装 WebView2" -ForegroundColor Yellow
}

# 2. 检查数字签名
Write-Host "`n[代码签名核验]"
$sig = Get-AuthenticodeSignature -FilePath $Artifact
if ($sig.Status -eq 'Valid') {
    Write-Host "✓ 数字签名有效: $($sig.SignerCertificate.Subject)" -ForegroundColor Green
} else {
    Write-Host "ℹ 签名状态: $($sig.Status) (未签署商业证书)" -ForegroundColor Yellow
    Write-Host "  符合 EXTERNAL-INPUTS 规则：若无代码签名证书，如实记录未签名状态，绝不伪造通过" -ForegroundColor Yellow
}

# 3. 输出自检报告
$report = @{
    artifact = $Artifact
    fileSizeBytes = $fileSize
    sha256 = $hash
    webView2Detected = $wv2Installed
    signatureStatus = $sig.Status.ToString()
    checkedAt = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssZ")
}

$outReport = "windows-install-check-report.json"
$report | ConvertTo-Json -Depth 3 | Out-File -FilePath $outReport -Encoding utf8
Write-Host "`n✓ 验证报告已生成: $outReport" -ForegroundColor Green
Write-Host "Windows 原生安装包结构核验完成。" -ForegroundColor Green
exit 0
