[CmdletBinding()]
param(
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$LockPath = Join-Path $RepoRoot 'polygen.lock.json'
if (-not (Test-Path -LiteralPath $LockPath -PathType Leaf)) {
  throw "PolyGen lock file not found: $LockPath"
}

function Get-RequiredLockString([object]$Object, [string]$Name) {
  $Property = $Object.PSObject.Properties[$Name]
  if ($null -eq $Property -or [string]::IsNullOrWhiteSpace([string]$Property.Value)) {
    throw "PolyGen lock field '$Name' is missing or empty."
  }
  return ([string]$Property.Value).Trim()
}

function Assert-SafePathComponent([string]$Value, [string]$FieldName) {
  if ([string]::IsNullOrWhiteSpace($Value) -or
      [IO.Path]::IsPathRooted($Value) -or
      $Value -in @('.', '..') -or
      $Value.IndexOfAny([char[]]@('/', '\')) -ge 0 -or
      $Value.IndexOfAny([char[]]@('<', '>', ':', '"', '|', '?', '*')) -ge 0 -or
      $Value -match '[\x00-\x1f]' -or
      $Value.EndsWith('.') -or $Value.EndsWith(' ')) {
    throw "PolyGen lock field '$FieldName' must be one safe path component."
  }
}

function Test-ItemIsLink([System.IO.FileSystemInfo]$Item) {
  if (($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    return $true
  }
  $LinkTypeProperty = $Item.PSObject.Properties['LinkType']
  return $null -ne $LinkTypeProperty -and -not [string]::IsNullOrWhiteSpace([string]$LinkTypeProperty.Value)
}

$Lock = Get-Content -LiteralPath $LockPath -Raw | ConvertFrom-Json
$Distribution = Get-RequiredLockString $Lock 'distribution'
if ($Distribution -cne 'github-release') {
  throw "Unsupported PolyGen distribution '$Distribution' in $LockPath"
}

$Version = Get-RequiredLockString $Lock 'version'
$ReleaseTag = Get-RequiredLockString $Lock 'releaseTag'
$SourceCommit = Get-RequiredLockString $Lock 'sourceCommit'
$Repository = Get-RequiredLockString $Lock 'repository'
Assert-SafePathComponent $Version 'version'
Assert-SafePathComponent $ReleaseTag 'releaseTag'
if ($SourceCommit -notmatch '^[0-9a-fA-F]{40}$') {
  throw 'PolyGen lock sourceCommit must be a 40-character Git commit.'
}
$SourceCommit = $SourceCommit.ToLowerInvariant()
$RepositoryUri = $null
if (-not [Uri]::TryCreate($Repository, [UriKind]::Absolute, [ref]$RepositoryUri) -or
    $RepositoryUri.Scheme -cne [Uri]::UriSchemeHttps -or
    $RepositoryUri.Host -cne 'github.com' -or
    -not $RepositoryUri.IsDefaultPort -or
    -not [string]::IsNullOrEmpty($RepositoryUri.UserInfo) -or
    -not [string]::IsNullOrEmpty($RepositoryUri.Query) -or
    -not [string]::IsNullOrEmpty($RepositoryUri.Fragment)) {
  throw "PolyGen lock repository must be an HTTPS GitHub owner/repository URL: $Repository"
}
$RepositoryMatch = [Text.RegularExpressions.Regex]::Match(
  $RepositoryUri.AbsolutePath,
  '^/(?<owner>[A-Za-z0-9_.-]+)/(?<repo>[A-Za-z0-9_.-]+)/?$'
)
if (-not $RepositoryMatch.Success) {
  throw "PolyGen lock repository must be an HTTPS GitHub owner/repository URL: $Repository"
}
$RepositoryOwner = $RepositoryMatch.Groups['owner'].Value
$RepositoryName = $RepositoryMatch.Groups['repo'].Value
$Repository = "https://github.com/$RepositoryOwner/$RepositoryName"

# Validate every supported artifact before honoring an override. This makes a lock
# defect fail identically on every CI host instead of hiding until that OS runs.
$PlatformDefinitions = @(
  [pscustomobject]@{ Key = 'windows-x64'; Asset = 'windowsX64Asset'; Sha256 = 'windowsX64Sha256'; ArchiveRoot = 'windowsX64ArchiveRoot'; Executable = 'windowsX64Executable' },
  [pscustomobject]@{ Key = 'linux-x64'; Asset = 'linuxX64Asset'; Sha256 = 'linuxX64Sha256'; ArchiveRoot = 'linuxX64ArchiveRoot'; Executable = 'linuxX64Executable' },
  [pscustomobject]@{ Key = 'macos-x64'; Asset = 'macosX64Asset'; Sha256 = 'macosX64Sha256'; ArchiveRoot = 'macosX64ArchiveRoot'; Executable = 'macosX64Executable' },
  [pscustomobject]@{ Key = 'macos-arm64'; Asset = 'macosArm64Asset'; Sha256 = 'macosArm64Sha256'; ArchiveRoot = 'macosArm64ArchiveRoot'; Executable = 'macosArm64Executable' }
)
$PlatformLocks = @{}
foreach ($Definition in $PlatformDefinitions) {
  $AssetValue = Get-RequiredLockString $Lock $Definition.Asset
  $Sha256Value = (Get-RequiredLockString $Lock $Definition.Sha256).ToLowerInvariant()
  $ArchiveRootValue = Get-RequiredLockString $Lock $Definition.ArchiveRoot
  $ExecutableValue = Get-RequiredLockString $Lock $Definition.Executable
  Assert-SafePathComponent $AssetValue $Definition.Asset
  Assert-SafePathComponent $ArchiveRootValue $Definition.ArchiveRoot
  Assert-SafePathComponent $ExecutableValue $Definition.Executable
  if ($AssetValue -notmatch '(?i)\.(zip|tar\.gz)$') {
    throw "PolyGen lock field '$($Definition.Asset)' must name a .zip or .tar.gz archive."
  }
  if ($Sha256Value -notmatch '^[0-9a-f]{64}$') {
    throw "PolyGen lock field '$($Definition.Sha256)' must contain exactly 64 hexadecimal characters."
  }
  $PlatformLocks[$Definition.Key] = [pscustomobject]@{
    Key = $Definition.Key
    Asset = $AssetValue
    Sha256 = $Sha256Value
    ArchiveRoot = $ArchiveRootValue
    Executable = $ExecutableValue
  }
}

if (-not [string]::IsNullOrWhiteSpace($env:POLYGEN_BIN)) {
  if (-not (Test-Path -LiteralPath $env:POLYGEN_BIN -PathType Leaf)) {
    throw "POLYGEN_BIN does not exist: $env:POLYGEN_BIN"
  }
  (Resolve-Path -LiteralPath $env:POLYGEN_BIN).Path
  return
}

if (-not [string]::IsNullOrWhiteSpace($env:POLYGEN_ROOT)) {
  $SourceRoot = (Resolve-Path -LiteralPath $env:POLYGEN_ROOT).Path
  $SourceExecutable = if ($env:OS -eq 'Windows_NT') {
    Join-Path $SourceRoot 'target\release\polygen.exe'
  } else {
    Join-Path $SourceRoot 'target/release/polygen'
  }
  if (-not (Test-Path -LiteralPath $SourceExecutable -PathType Leaf)) {
    throw "PolyGen source override is not built: $SourceExecutable"
  }
  (Resolve-Path -LiteralPath $SourceExecutable).Path
  return
}

$OnWindows = $env:OS -eq 'Windows_NT'
$OnMacOS = -not $OnWindows -and [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
  [System.Runtime.InteropServices.OSPlatform]::OSX
)
$Architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()

if ($OnWindows) {
  if ($Architecture -notin @('x64', 'amd64')) { throw "Unsupported Windows architecture: $Architecture" }
  $PlatformKey = 'windows-x64'
} elseif ($OnMacOS) {
  if ($Architecture -eq 'arm64') {
    $PlatformKey = 'macos-arm64'
  } elseif ($Architecture -eq 'x64') {
    $PlatformKey = 'macos-x64'
  } else {
    throw "Unsupported macOS architecture: $Architecture"
  }
} else {
  if ($Architecture -ne 'x64') { throw "Unsupported Linux architecture: $Architecture" }
  $PlatformKey = 'linux-x64'
}

$PlatformLock = $PlatformLocks[$PlatformKey]
$Asset = $PlatformLock.Asset
$ExpectedHash = $PlatformLock.Sha256
$ArchiveRoot = $PlatformLock.ArchiveRoot
$ExecutableName = $PlatformLock.Executable

$CacheBase = if (-not [string]::IsNullOrWhiteSpace($env:POLYGEN_CACHE_DIR)) {
  $env:POLYGEN_CACHE_DIR
} else {
  Join-Path (Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'PolyGen') 'tools'
}
$CacheRoot = [IO.Path]::GetFullPath($CacheBase)
$PathComparison = if ($OnWindows) { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }
$VersionRoot = Join-Path $CacheRoot (Join-Path $Version $PlatformKey)
$InstallRoot = Join-Path $VersionRoot $ArchiveRoot
$Executable = Join-Path $InstallRoot $ExecutableName
$MarkerPath = Join-Path $InstallRoot '.polygen-release.json'
$ArchivePath = Join-Path $VersionRoot $Asset
$InstallLockPath = Join-Path $VersionRoot '.install.lock'

function Assert-CachePath([string]$Path) {
  $FullPath = [IO.Path]::GetFullPath($Path)
  $TrimCharacters = [char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  $RootWithSeparator = $CacheRoot.TrimEnd($TrimCharacters) + [IO.Path]::DirectorySeparatorChar
  if (-not $FullPath.StartsWith($RootWithSeparator, $PathComparison)) {
    throw "Refusing to modify a path outside the PolyGen cache: $FullPath"
  }
}

function Assert-ContainedPath([string]$Path, [string]$Root, [string]$Description) {
  $FullPath = [IO.Path]::GetFullPath($Path)
  $FullRoot = [IO.Path]::GetFullPath($Root)
  $TrimCharacters = [char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  $RootWithSeparator = $FullRoot.TrimEnd($TrimCharacters) + [IO.Path]::DirectorySeparatorChar
  if (-not $FullPath.Equals($FullRoot, $PathComparison) -and
      -not $FullPath.StartsWith($RootWithSeparator, $PathComparison)) {
    throw "$Description escapes its expected root: $FullPath"
  }
}

function Remove-CacheTree([string]$Path) {
  Assert-CachePath $Path
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $Item = Get-Item -LiteralPath $Path -Force
  if (Test-ItemIsLink $Item) {
    Remove-Item -LiteralPath $Path -Force
  } else {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
}

function Enter-ExclusiveInstallLock([string]$Path, [int]$TimeoutSeconds = 180) {
  Assert-CachePath $Path
  $Deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ($true) {
    try {
      return [IO.File]::Open($Path, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    } catch [IO.IOException] {
      if ([DateTime]::UtcNow -ge $Deadline) {
        throw "Timed out waiting for the PolyGen install lock: $Path"
      }
      Start-Sleep -Milliseconds 200
    }
  }
}

function Assert-ArchiveEntryName([string]$Name, [string]$ExpectedRoot) {
  if ([string]::IsNullOrWhiteSpace($Name)) {
    throw 'PolyGen archive contains an empty entry name.'
  }
  $Normalized = $Name.Replace('\', '/')
  if ($Normalized.StartsWith('/') -or $Normalized -match '^[A-Za-z]:') {
    throw "PolyGen archive contains an absolute entry: $Name"
  }
  if ($Normalized.Contains('//') -or $Normalized.Contains(':') -or $Normalized -match '[\x00-\x1f]') {
    throw "PolyGen archive contains an invalid entry: $Name"
  }
  $Normalized = $Normalized.TrimEnd('/')
  $Segments = $Normalized.Split('/')
  if ($Segments.Count -eq 0 -or $Segments[0] -cne $ExpectedRoot -or
      @($Segments | Where-Object { $_ -in @('', '.', '..') }).Count -ne 0) {
    throw "PolyGen archive entry is outside '$ExpectedRoot': $Name"
  }
}

function Assert-ArchiveIsSafe([string]$Path, [string]$ExpectedRoot, [string]$AssetName) {
  if ($AssetName.EndsWith('.zip', [StringComparison]::OrdinalIgnoreCase)) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $Zip = [IO.Compression.ZipFile]::OpenRead($Path)
    try {
      foreach ($Entry in $Zip.Entries) {
        Assert-ArchiveEntryName $Entry.FullName $ExpectedRoot
        $UnixType = ($Entry.ExternalAttributes -shr 16) -band 0xF000
        if ($UnixType -eq 0xA000 -or ($Entry.ExternalAttributes -band 0x400) -ne 0) {
          throw "PolyGen archive contains a link entry: $($Entry.FullName)"
        }
      }
    } finally {
      $Zip.Dispose()
    }
    return
  }

  $EntryNames = @(& tar -tzf $Path)
  if ($LASTEXITCODE -ne 0) { throw "Failed to inspect PolyGen archive: $Path" }
  foreach ($EntryName in $EntryNames) {
    Assert-ArchiveEntryName ([string]$EntryName) $ExpectedRoot
  }
  $EntryDetails = @(& tar -tvzf $Path)
  if ($LASTEXITCODE -ne 0) { throw "Failed to inspect PolyGen archive entry types: $Path" }
  foreach ($EntryDetail in $EntryDetails) {
    $Detail = [string]$EntryDetail
    if ([string]::IsNullOrEmpty($Detail) -or $Detail[0] -notin @('-', 'd')) {
      throw "PolyGen archive contains a link or special entry: $Detail"
    }
  }
}

function Assert-TreeContainedAndLinkFree([string]$Root) {
  if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
    throw "PolyGen install directory is missing: $Root"
  }
  $RootItem = Get-Item -LiteralPath $Root -Force
  if (Test-ItemIsLink $RootItem) {
    throw "PolyGen install root must not be a link: $Root"
  }
  foreach ($Item in @(Get-ChildItem -LiteralPath $Root -Force -Recurse)) {
    Assert-ContainedPath $Item.FullName $Root 'PolyGen install entry'
    if (Test-ItemIsLink $Item) {
      throw "PolyGen install contains a link: $($Item.FullName)"
    }
  }
}

function Get-DirectoryState([string]$Path, [string]$Name) {
  if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
    throw "PolyGen $Name directory is missing: $Path"
  }
  $Files = @(Get-ChildItem -LiteralPath $Path -File -Force -Recurse | Sort-Object FullName)
  if ($Files.Count -eq 0) {
    throw "PolyGen $Name directory is empty: $Path"
  }
  $Lines = foreach ($File in $Files) {
    Assert-ContainedPath $File.FullName $Path "PolyGen $Name file"
    $RelativePath = [IO.Path]::GetRelativePath($Path, $File.FullName).Replace('\', '/')
    $FileHash = (Get-FileHash -LiteralPath $File.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    "$RelativePath`0$FileHash"
  }
  $Bytes = [Text.Encoding]::UTF8.GetBytes(($Lines -join "`n"))
  $Hasher = [Security.Cryptography.SHA256]::Create()
  try {
    $Digest = [BitConverter]::ToString($Hasher.ComputeHash($Bytes)).Replace('-', '').ToLowerInvariant()
  } finally {
    $Hasher.Dispose()
  }
  return [pscustomobject]@{ Hash = $Digest; Count = $Files.Count }
}

function Get-InstallationState {
  Assert-TreeContainedAndLinkFree $InstallRoot
  if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
    throw "PolyGen executable is missing: $Executable"
  }
  $TemplatesRoot = Join-Path $InstallRoot 'templates'
  $StaticRoot = Join-Path $InstallRoot 'static'
  foreach ($RequiredDirectory in @(
    (Join-Path $TemplatesRoot 'typescript'),
    (Join-Path $StaticRoot 'typescript')
  )) {
    if (-not (Test-Path -LiteralPath $RequiredDirectory -PathType Container)) {
      throw "PolyGen required directory is missing: $RequiredDirectory"
    }
  }
  return [pscustomobject]@{
    ExecutableSha256 = (Get-FileHash -LiteralPath $Executable -Algorithm SHA256).Hash.ToLowerInvariant()
    Templates = Get-DirectoryState $TemplatesRoot 'templates'
    Static = Get-DirectoryState $StaticRoot 'static'
  }
}

function Test-MarkerMatches([object]$Marker, [object]$State) {
  if ($null -eq $Marker -or $null -eq $State) { return $false }
  $Expected = [ordered]@{
    schemaVersion = 1
    distribution = $Distribution
    version = $Version
    releaseTag = $ReleaseTag
    sourceCommit = $SourceCommit
    repository = $Repository
    platform = $PlatformKey
    asset = $Asset
    sha256 = $ExpectedHash
    archiveRoot = $ArchiveRoot
    executable = $ExecutableName
    executableSha256 = $State.ExecutableSha256
    templatesSha256 = $State.Templates.Hash
    templatesFileCount = $State.Templates.Count
    staticSha256 = $State.Static.Hash
    staticFileCount = $State.Static.Count
  }
  foreach ($Name in $Expected.Keys) {
    $Property = $Marker.PSObject.Properties[$Name]
    if ($null -eq $Property -or $Property.Value -cne $Expected[$Name]) {
      return $false
    }
  }
  return $true
}

foreach ($CachePath in @($VersionRoot, $InstallRoot, $Executable, $MarkerPath, $ArchivePath, $InstallLockPath)) {
  Assert-CachePath $CachePath
}
New-Item -ItemType Directory -Path $VersionRoot -Force | Out-Null

$InstallLock = Enter-ExclusiveInstallLock $InstallLockPath
try {
  $ArchiveWasCorrupt = $false
  $ArchiveIsValid = $false
  if (Test-Path -LiteralPath $ArchivePath -PathType Leaf) {
    $ArchiveItem = Get-Item -LiteralPath $ArchivePath -Force
    if (Test-ItemIsLink $ArchiveItem) {
      Remove-Item -LiteralPath $ArchivePath -Force
      $ArchiveWasCorrupt = $true
    } else {
      $ActualHash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
      $ArchiveIsValid = $ActualHash -ceq $ExpectedHash
      if (-not $ArchiveIsValid) {
        Remove-Item -LiteralPath $ArchivePath -Force
        $ArchiveWasCorrupt = $true
      }
    }
  }

  if (-not $ArchiveIsValid) {
    $DownloadPath = "$ArchivePath.download-$([guid]::NewGuid().ToString('N'))"
    Assert-CachePath $DownloadPath
    $EncodedReleaseTag = [Uri]::EscapeDataString($ReleaseTag)
    $EncodedAsset = [Uri]::EscapeDataString($Asset)
    $DownloadUrl = "$Repository/releases/download/$EncodedReleaseTag/$EncodedAsset"
    Write-Host "[PolyGen] Downloading $DownloadUrl"
    try {
      Invoke-WebRequest -Uri $DownloadUrl -OutFile $DownloadPath
      $ActualHash = (Get-FileHash -LiteralPath $DownloadPath -Algorithm SHA256).Hash.ToLowerInvariant()
      if ($ActualHash -cne $ExpectedHash) {
        throw "PolyGen archive checksum mismatch. Expected $ExpectedHash, got $ActualHash"
      }
      Assert-ArchiveIsSafe $DownloadPath $ArchiveRoot $Asset
      Move-Item -LiteralPath $DownloadPath -Destination $ArchivePath -Force
      $ArchiveIsValid = $true
    } finally {
      if (Test-Path -LiteralPath $DownloadPath) {
        Remove-Item -LiteralPath $DownloadPath -Force
      }
    }
  } else {
    Assert-ArchiveIsSafe $ArchivePath $ArchiveRoot $Asset
  }

  if (-not $Force -and -not $ArchiveWasCorrupt -and
      (Test-Path -LiteralPath $MarkerPath -PathType Leaf)) {
    $CachedState = $null
    $Marker = $null
    try {
      $CachedState = Get-InstallationState
      $Marker = Get-Content -LiteralPath $MarkerPath -Raw | ConvertFrom-Json
    } catch {
      Write-Verbose "PolyGen cache validation failed; reinstalling: $($_.Exception.Message)"
    }
    if (Test-MarkerMatches $Marker $CachedState) {
      (Resolve-Path -LiteralPath $Executable).Path
      return
    }
  }

  $ExtractRoot = Join-Path $VersionRoot ('.extract-' + [guid]::NewGuid().ToString('N'))
  Assert-CachePath $ExtractRoot
  New-Item -ItemType Directory -Path $ExtractRoot -Force | Out-Null
  try {
    if ($Asset.EndsWith('.zip', [StringComparison]::OrdinalIgnoreCase)) {
      Expand-Archive -LiteralPath $ArchivePath -DestinationPath $ExtractRoot -Force
    } else {
      & tar -xzf $ArchivePath -C $ExtractRoot
      if ($LASTEXITCODE -ne 0) { throw "Failed to extract PolyGen archive: $ArchivePath" }
    }
    Assert-TreeContainedAndLinkFree $ExtractRoot

    $ExtractedInstall = Join-Path $ExtractRoot $ArchiveRoot
    if (-not (Test-Path -LiteralPath $ExtractedInstall -PathType Container)) {
      throw "PolyGen archive did not contain the expected root: $ArchiveRoot"
    }
    if (Test-Path -LiteralPath $InstallRoot) {
      Remove-CacheTree $InstallRoot
    }
    Move-Item -LiteralPath $ExtractedInstall -Destination $InstallRoot
  } finally {
    if (Test-Path -LiteralPath $ExtractRoot) {
      Remove-CacheTree $ExtractRoot
    }
  }

  if (-not $OnWindows) {
    & chmod +x $Executable
    if ($LASTEXITCODE -ne 0) { throw "Failed to mark PolyGen executable: $Executable" }
  }

  $InstalledState = Get-InstallationState
  $Marker = [ordered]@{
    schemaVersion = 1
    distribution = $Distribution
    version = $Version
    releaseTag = $ReleaseTag
    sourceCommit = $SourceCommit
    repository = $Repository
    platform = $PlatformKey
    asset = $Asset
    sha256 = $ExpectedHash
    archiveRoot = $ArchiveRoot
    executable = $ExecutableName
    executableSha256 = $InstalledState.ExecutableSha256
    templatesSha256 = $InstalledState.Templates.Hash
    templatesFileCount = $InstalledState.Templates.Count
    staticSha256 = $InstalledState.Static.Hash
    staticFileCount = $InstalledState.Static.Count
  }
  $MarkerTemp = Join-Path $InstallRoot ('.polygen-release.json.tmp-' + [guid]::NewGuid().ToString('N'))
  Assert-CachePath $MarkerTemp
  try {
    $Marker | ConvertTo-Json | Set-Content -LiteralPath $MarkerTemp -Encoding utf8
    Move-Item -LiteralPath $MarkerTemp -Destination $MarkerPath -Force
  } finally {
    if (Test-Path -LiteralPath $MarkerTemp) {
      Remove-Item -LiteralPath $MarkerTemp -Force
    }
  }

  (Resolve-Path -LiteralPath $Executable).Path
} finally {
  if ($null -ne $InstallLock) {
    $InstallLock.Dispose()
  }
}
