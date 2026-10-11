#!/usr/bin/env bash
# Build this checkout and prepare/install/launch the Open-Q camera client.
set -euo pipefail

project_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
deploy_apply=false
deploy_serial=192.168.43.1:5555
deploy_board=192.168.43.1
deploy_indoor=true
deploy_origin=
deploy_sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}

usage() {
    cat <<'EOF'
Usage: scripts/deploy.sh [--apply] [--serial DEVICE] [--board-host HOST]
                         [--sdk PATH] [--origin ORIGIN] [--outdoor]

Preview by default; --apply installs missing SDK packages, runs host tests,
builds the debug APK from this checkout, reconnects the board if needed,
releases camera owners using existing su, configures continuous indoor capture,
installs the APK, grants CAMERA, and launches the app.

Requires Bash, a Java runtime capable of launching the Gradle wrapper, and an
Android SDK. Missing SDK packages require sdkmanager (Android command-line
tools); license acceptance is interactive. Gradle provisions its pinned JDK 21.
ADB comes from the SDK's platform-tools. curl is needed for board reconnection.

--sdk PATH        SDK root (otherwise environment, local.properties, ~/Android/Sdk).
--serial DEVICE   ADB target (default 192.168.43.1:5555).
--board-host HOST Enable ADB via this board's HTTP API (default 192.168.43.1).
--origin ORIGIN   Exact website origin, e.g. https://game.example.com.
                  Omit to keep the saved origin; first use then needs UI setup.
--outdoor         Preserve the existing exposure ceiling instead of setting 30 ms.
--dry-run         Preview only (default). No host or device changes.

Latest means the current working tree, including local edits; no git pull.
EOF
}
die() { printf '%s\n' "$*" >&2; exit 1; }
while (($#)); do
    case "$1" in
        --apply) deploy_apply=true; shift ;;
        --dry-run) deploy_apply=false; shift ;;
        --outdoor) deploy_indoor=false; shift ;;
        --serial|--board-host|--sdk|--origin)
            (($# >= 2)) && [[ -n "$2" && "$2" != --* ]] || die "$1 requires a value."
            case "$1" in
                --serial) deploy_serial=$2 ;;
                --board-host) deploy_board=$2 ;;
                --sdk) deploy_sdk=$2 ;;
                --origin) deploy_origin=$2 ;;
            esac
            shift 2 ;;
        --help|-h) usage; exit 0 ;;
        *) usage >&2; die "Unknown argument: $1" ;;
    esac
done
[[ "$deploy_serial" =~ ^[a-zA-Z0-9._:-]+$ ]] || die 'Invalid ADB serial.'
[[ "$deploy_board" =~ ^[a-zA-Z0-9.-]+$ ]] || die 'Invalid board host.'
if [[ -n "$deploy_origin" ]]; then
    [[ "$deploy_origin" =~ ^https?://[a-zA-Z0-9.-]+(:[0-9]+)?$ ]] || die 'Use an exact HTTP(S) origin without a path or trailing slash.'
fi
if [[ -z "$deploy_sdk" && -f "$project_dir/local.properties" ]]; then
    deploy_sdk=$(sed -n 's/^sdk\.dir=//p' "$project_dir/local.properties" | tail -n 1)
    # Java properties escape separators and spaces on some hosts.
    deploy_sdk=${deploy_sdk//\\:/:}
    deploy_sdk=${deploy_sdk//\\ / }
    deploy_sdk=${deploy_sdk//\\\\/\\}
fi
deploy_sdk=${deploy_sdk:-$HOME/Android/Sdk}
[[ "$deploy_sdk" == /* && "$deploy_sdk" != *$'\n'* && "$deploy_sdk" != *$'\r'* ]] || die 'SDK path must be absolute and on one line.'

version() {
    local value
    value=$(sed -n "s/^$1 = \"\([^\"]*\)\"/\1/p" "$project_dir/gradle/libs.versions.toml")
    [[ -n "$value" ]] || die "Missing pinned version: $1"
    printf '%s' "$value"
}
deploy_compile=$(version android-compileSdk)
deploy_ndk=$(version android-ndk)
deploy_cmake=$(version android-cmake)
deploy_packages=(platform-tools "platforms;android-$deploy_compile" "ndk;$deploy_ndk" "cmake;$deploy_cmake")
deploy_paths=(platform-tools/adb "platforms/android-$deploy_compile/android.jar" "ndk/$deploy_ndk/source.properties" "cmake/$deploy_cmake/bin/cmake")
deploy_apk="$project_dir/androidApp/build/outputs/apk/debug/androidApp-debug.apk"
deploy_app=tech.aerodance.androidclient

printf 'Project: %s\nSDK: %s\nDevice: %s (ADB API host: %s)\n' "$project_dir" "$deploy_sdk" "$deploy_serial" "$deploy_board"
printf 'SDK packages: %s\n' "${deploy_packages[*]}"
printf 'Plan: SDK setup → host tests + debug build → ADB reconnect → camera release/setup → install + CAMERA grant → launch\n'
printf 'Indoor exposure: %s; origin: %s\n' "$deploy_indoor" "${deploy_origin:-saved origin (UI setup on first use)}"
if [[ "$deploy_apply" != true ]]; then
    printf 'Dry run: rerun with --apply to execute.\n'
    exit 0
fi

command -v java >/dev/null || [[ -x "${JAVA_HOME:-}/bin/java" ]] || die 'Install Java (JDK 21 recommended) or set JAVA_HOME first.'
[[ -d "$deploy_sdk" ]] || die "Install Android SDK command-line tools at $deploy_sdk, or use --sdk PATH."
export ANDROID_HOME="$deploy_sdk" ANDROID_SDK_ROOT="$deploy_sdk"
export PATH="$deploy_sdk/platform-tools:$PATH"
deploy_missing=()
for i in "${!deploy_packages[@]}"; do
    [[ -f "$deploy_sdk/${deploy_paths[$i]}" ]] || deploy_missing+=("${deploy_packages[$i]}")
done
if ((${#deploy_missing[@]})); then
    deploy_manager=
    if [[ -x "$deploy_sdk/cmdline-tools/latest/bin/sdkmanager" ]]; then
        deploy_manager="$deploy_sdk/cmdline-tools/latest/bin/sdkmanager"
    else
        for candidate in "$deploy_sdk"/cmdline-tools/*/bin/sdkmanager "$deploy_sdk/tools/bin/sdkmanager"; do
            [[ ! -x "$candidate" ]] || deploy_manager=$candidate
        done
    fi
    [[ -n "$deploy_manager" ]] || die 'Install Android SDK command-line tools first (sdkmanager is missing).'
    "$deploy_manager" --sdk_root="$deploy_sdk" --licenses
    "$deploy_manager" --sdk_root="$deploy_sdk" "${deploy_missing[@]}"
fi
command -v adb >/dev/null || die 'SDK platform-tools did not provide adb.'

# Keep local Gradle SDK discovery consistent with the selected SDK.
deploy_properties=$(mktemp "$project_dir/.deploy-properties.XXXXXX")
trap 'rm -f -- "$deploy_properties"' EXIT
if [[ -f "$project_dir/local.properties" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
        [[ "$line" =~ ^[[:space:]]*sdk\.dir[[:space:]]*[:=] ]] || printf '%s\n' "$line" >> "$deploy_properties"
    done < "$project_dir/local.properties"
fi
deploy_sdk_property=${deploy_sdk//\\/\\\\}
deploy_sdk_property=${deploy_sdk_property//:/\\:}
printf 'sdk.dir=%s\n' "$deploy_sdk_property" >> "$deploy_properties"
mv -- "$deploy_properties" "$project_dir/local.properties"
cd -- "$project_dir"
./gradlew :shared:testAndroidHostTest :androidApp:assembleDebug
[[ -f "$deploy_apk" ]] || die "Build produced no APK: $deploy_apk"

deploy_adb=(adb -s "$deploy_serial")
if [[ "$("${deploy_adb[@]}" get-state 2>/dev/null || true)" != device ]]; then
    [[ "$deploy_serial" == *:* ]] || die "Connect and authorize USB device $deploy_serial, then rerun."
    command -v curl >/dev/null || die 'curl is required to enable board ADB.'
    curl --fail --show-error --connect-timeout 5 --max-time 15 --request PUT \
        --url "http://$deploy_board:8080/api/v1/system/adb/enable"
    adb connect "$deploy_serial"
    [[ "$("${deploy_adb[@]}" get-state 2>/dev/null || true)" == device ]] || die 'Board is unavailable or unauthorized after reconnect.'
fi
"${deploy_adb[@]}" shell getprop ro.build.version.sdk
"${deploy_adb[@]}" shell getprop ro.product.cpu.abilist
# Stop our old foreground activity before preparing properties or replacing it.
"${deploy_adb[@]}" shell am force-stop "$deploy_app"
./scripts/release-camera.sh --serial "$deploy_serial" --stop
deploy_prepare=(./scripts/prepare-camera.sh --serial "$deploy_serial" --apply)
[[ "$deploy_indoor" != true ]] || deploy_prepare+=(--indoor)
"${deploy_prepare[@]}"
"${deploy_adb[@]}" install -r "$deploy_apk"
"${deploy_adb[@]}" shell pm grant "$deploy_app" android.permission.CAMERA
deploy_launch=(shell am start -W -n "$deploy_app/.MainActivity")
[[ -z "$deploy_origin" ]] || deploy_launch+=(--es testOrigin "$deploy_origin")
deploy_started=$("${deploy_adb[@]}" "${deploy_launch[@]}")
printf '%s\n' "$deploy_started"
[[ "$deploy_started" == *'Status: ok'* && "$deploy_started" != *'Error:'* ]] || die 'Activity launch failed.'
printf 'Deployed %s to %s.\n' "$deploy_apk" "$deploy_serial"
printf 'Open the app to confirm its origin; streaming starts once an origin is saved.\n'
