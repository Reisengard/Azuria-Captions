param(
  [string]$Ffmpeg = "ffmpeg"
)

$ErrorActionPreference = "Stop"
$fixtureRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$output = Join-Path $fixtureRoot "generated"
New-Item -ItemType Directory -Force -Path $output | Out-Null

if (-not (Get-Command $Ffmpeg -ErrorAction SilentlyContinue)) {
  throw "FFmpeg was not found. Install FFmpeg or pass its executable path with -Ffmpeg."
}

function New-AvFixture {
  param([string]$Name, [int]$Width, [int]$Height, [int]$Fps, [int]$Duration)
  $target = Join-Path $output $Name
  $video = "testsrc2=size=${Width}x${Height}:rate=${Fps}:duration=${Duration},drawtext=text='JIZURA %{pts\:hms}':x=(w-text_w)/2:y=h*0.08:fontsize=h/24:fontcolor=white:box=1:boxcolor=black@0.65"
  $audio = "sine=frequency=180:sample_rate=48000:duration=${Duration},tremolo=f=4:d=0.65,volume=0.16"
  & $Ffmpeg -hide_banner -loglevel error -y -f lavfi -i $video -f lavfi -i $audio -t $Duration -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p -r $Fps -c:a aac -b:a 96k -ar 48000 -movflags +faststart -shortest $target
  if ($LASTEXITCODE -ne 0) { throw "FFmpeg failed while creating $Name" }
}

New-AvFixture "portrait-15s-30fps-av.mp4" 1080 1920 30 15
New-AvFixture "landscape-10s-30fps-av.mp4" 1280 720 30 10
New-AvFixture "portrait-5s-24fps-av.mp4" 720 1280 24 5
New-AvFixture "portrait-5s-60fps-av.mp4" 720 1280 60 5
# Three minutes: file-backed export and long-run memory (export_chrome_check.js --long).
New-AvFixture "portrait-180s-30fps-av.mp4" 1080 1920 30 180

$silent = Join-Path $output "portrait-5s-30fps-silent.mp4"
$silentVideo = "testsrc2=size=720x1280:rate=30:duration=5,drawtext=text='JIZURA SILENT %{pts\:hms}':x=(w-text_w)/2:y=h*0.08:fontsize=h/24:fontcolor=white:box=1:boxcolor=black@0.65"
& $Ffmpeg -hide_banner -loglevel error -y -f lavfi -i $silentVideo -t 5 -an -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p -r 30 -movflags +faststart $silent
if ($LASTEXITCODE -ne 0) { throw "FFmpeg failed while creating the silent fixture" }

Write-Host "Generated media fixtures in $output"
