#!/usr/bin/env bash
# Pre-downloads everything electron-builder needs, through GitHub's API (the `gh` command) with retries,
# and puts it where electron-builder looks first.
#
# Why: GitHub's normal release-download addresses (github.com/.../releases/download/...) sometimes get stuck
# answering "504 Gateway Time-out" for a while, which broke releases. The API route kept working.
# If anything here fails, the build simply falls back to electron-builder's own downloads.
set -u

EV=$(node -p "require('electron/package.json').version")
ECACHE="$RUNNER_TEMP/electron-cache"
BCACHE="$RUNNER_TEMP/electron-builder-cache"
# Tell later steps (electron-builder) to use these cache folders.
echo "ELECTRON_CACHE=$ECACHE" >> "$GITHUB_ENV"
echo "ELECTRON_BUILDER_CACHE=$BCACHE" >> "$GITHUB_ENV"

# Git Bash on Windows needs /d/a/... style paths for its own commands.
p() { if command -v cygpath > /dev/null 2>&1; then cygpath -u "$1"; else echo "$1"; fi; }
mkdir -p "$(p "$ECACHE")" "$(p "$BCACHE")" "$(p "$RUNNER_TEMP")/prefetch"

# fetch <repo> <release tag> <file> <folder>
fetch() {
  for try in 1 2 3 4 5; do
    if gh release download "$2" -R "$1" -p "$3" -D "$(p "$4")" --clobber; then
      echo "pre-downloaded $3"
      return 0
    fi
    echo "::warning::pre-download of $3 failed (try $try); retrying in 20 seconds"
    sleep 20
  done
  echo "::warning::could not pre-download $3; electron-builder will try to download it itself"
  return 1
}

# tool <name-version> <group>: electron-builder's helper tools, unpacked into <cache>/<group>/<name-version>/
tool() {
  local tmp
  tmp="$(p "$RUNNER_TEMP")/prefetch"
  fetch electron-userland/electron-builder-binaries "$1" "$1.7z" "$RUNNER_TEMP/prefetch" || return 0
  mkdir -p "$(p "$BCACHE")/$2"
  # (winCodeSign contains a few macOS symlinks Windows can't create; those don't matter for a Windows build)
  # (7z is a Windows program: give it the Windows-style output path, which Git Bash won't convert inside "-o…")
  7z x -y -snld "$tmp/$1.7z" -o"$BCACHE/$2/$1" > /dev/null || echo "::warning::unpacking $1 reported problems (usually harmless)"
  ls "$(p "$BCACHE")/$2/$1" > /dev/null 2>&1 && echo "unpacked $1" || echo "::warning::$1 did not unpack"
}

if [ "$RUNNER_OS" = "Windows" ]; then
  fetch electron/electron "v$EV" "electron-v$EV-win32-x64.zip" "$ECACHE" || true
  tool winCodeSign-2.6.0 winCodeSign
  tool nsis-3.0.4.1 nsis
  tool nsis-resources-3.4.1 nsis
else
  # Mac builds are "universal" (Intel + Apple silicon), so both Electron downloads are needed.
  fetch electron/electron "v$EV" "electron-v$EV-darwin-x64.zip" "$ECACHE" || true
  fetch electron/electron "v$EV" "electron-v$EV-darwin-arm64.zip" "$ECACHE" || true
fi

echo "--- prefetched files:"
ls -la "$(p "$ECACHE")" "$(p "$BCACHE")" 2> /dev/null || true
exit 0
