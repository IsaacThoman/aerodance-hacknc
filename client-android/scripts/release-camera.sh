#!/usr/bin/env bash
# Inspect current camera owners; --stop kills their processes using existing su.
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: release-camera.sh [--serial DEVICE] [--dry-run | --stop]

Lists active camera-owning packages by default. --stop resolves their process
IDs and uses su 0 kill -9, then checks ownership. Requires working su on the
device. Packages are not uninstalled or disabled; processes may restart.
Defaults to 192.168.43.1:5555. Use --serial to target a different device.
EOF
}

camera_serial="192.168.43.1:5555"
camera_stop=false
while (($#)); do
    case "$1" in
        --serial)
            if (($# < 2)) || [[ -z "$2" || "$2" == --* ]]; then
                printf '%s\n' '--serial requires a device serial.' >&2
                exit 2
            fi
            camera_serial="$2"
            shift 2
            ;;
        --stop) camera_stop=true; shift ;;
        --dry-run) camera_stop=false; shift ;;
        --help|-h) usage; exit 0 ;;
        *) printf 'Unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
    esac
done

command -v adb >/dev/null || { printf '%s\n' 'adb is required.' >&2; exit 1; }
camera_adb=(adb -s "$camera_serial")

read_owners() {
    local camera_dump
    camera_dump=$("${camera_adb[@]}" shell dumpsys media.camera) || return
    if [[ "$camera_dump" != *'Active Camera Clients:'* ]]; then
        printf '%s\n' 'Unsupported camera dump or unavailable service; refusing to stop apps.' >&2
        return 1
    fi
    # Match current-client entries only, never historical CONNECT events.
    printf '%s\n' "$camera_dump" | awk '
        /Active Camera Clients:/ {active = 1; next}
        active && /^[[:space:]]*\]/ {active = 0}
        active && /Client Package Name:/ {
            sub(/^.*Client Package Name:[[:space:]]*/, "")
            sub(/[,)].*$/, "")
            gsub(/[[:space:]\r]/, "")
            if ($0 ~ /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$/) print
        }
    ' | sort -u
}

camera_owners=$(read_owners)
if [[ -z "$camera_owners" ]]; then
    printf 'No active camera owners on %s.\n' "$camera_serial"
    exit 0
fi
printf 'Active camera owners on %s:\n%s\n' "$camera_serial" "$camera_owners"
if [[ "$camera_stop" != true ]]; then
    printf '%s\n' 'Dry run: use --stop to kill these packages using su 0 kill -9.'
    exit 0
fi

while IFS= read -r camera_package; do
    camera_pids=$("${camera_adb[@]}" shell pidof "$camera_package") || {
        printf 'Could not resolve process IDs for %s; refusing to kill.\n' "$camera_package" >&2
        exit 1
    }
    camera_pids=${camera_pids//$'\r'/}
    if [[ ! "$camera_pids" =~ ^[0-9]+([[:blank:]][0-9]+)*$ ]]; then
        printf 'Invalid process IDs for %s; refusing to kill.\n' "$camera_package" >&2
        exit 1
    fi
    read -r -a camera_pid_list <<< "$camera_pids"
    for camera_pid in "${camera_pid_list[@]}"; do
        if [[ ! "$camera_pid" =~ ^[1-9][0-9]*$ ]] || ((camera_pid <= 1)); then
            printf 'Unsafe process ID for %s; refusing to kill.\n' "$camera_package" >&2
            exit 1
        fi
    done
    printf 'Killing %s (PIDs: %s) using su\n' "$camera_package" "$camera_pids"
    camera_output=$("${camera_adb[@]}" shell su 0 kill -9 "${camera_pid_list[@]}" 2>&1) || {
        printf '%s\n' "$camera_output" >&2
        exit 1
    }
    if [[ -n "$camera_output" ]]; then
        printf '%s\n' "$camera_output" >&2
        printf '%s\n' 'Unexpected kill output; check device su/permissions.' >&2
        exit 1
    fi
done <<< "$camera_owners"

camera_remaining=$(read_owners)
if [[ -n "$camera_remaining" ]]; then
    printf 'Camera still has active owners (release may be asynchronous or an app may have restarted):\n%s\n' "$camera_remaining" >&2
    exit 1
fi
printf '%s\n' 'Camera ownership released. Package installation and enablement were not changed.'
