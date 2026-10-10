#!/usr/bin/env bash
# Configure the original Flock HAL for continuous capture; inspection by default.
set -euo pipefail
camera_serial=192.168.43.1:5555
camera_apply=false
camera_indoor=false
while (($#)); do
    case "$1" in
        --serial)
            (($# >= 2)) && [[ -n "$2" && "$2" != --* ]] || { echo '--serial requires a device serial.' >&2; exit 2; }
            camera_serial=$2; shift 2 ;;
        --apply) camera_apply=true; shift ;;
        --indoor) camera_indoor=true; shift ;;
        --dry-run) camera_apply=false; shift ;;
        --help|-h)
            echo 'Usage: prepare-camera.sh [--serial DEVICE] [--indoor] [--dry-run | --apply]'
            echo 'Inspects motion settings. --apply uses existing su to set continuous mode.'
            echo 'Release camera owners first. Motion properties persist across reboot; vendor apps may reset them.'
            echo 'The indoor exposure ceiling is runtime configuration; reapply it after reboot.'
            echo '--indoor also raises the vendor AEC exposure ceiling to 30 ms (for indoor pose capture).'
            exit 0 ;;
        *) echo "Unknown argument: $1" >&2; exit 2 ;;
    esac
done
camera_adb=(adb -s "$camera_serial")
camera_properties=(persist.sys.camera.motion.en persist.sys.camera.motion.timeout_ms)
for camera_property in "${camera_properties[@]}"; do
    camera_value=$("${camera_adb[@]}" shell getprop "$camera_property")
    printf '%s=%s (continuous target: 0)\n' "$camera_property" "${camera_value//$'\r'/}"
done
camera_exposure=$("${camera_adb[@]}" shell getprop vendor.flock.chromatix.max_exposure_time_ms)
printf 'vendor.flock.chromatix.max_exposure_time_ms=%s\n' "${camera_exposure//$'\r'/}"
if [[ "$camera_indoor" == true ]]; then
    echo 'Indoor target: AEC exposure ceiling 30 ms; vendor gain limit unchanged.'
fi
if [[ "$camera_apply" != true ]]; then
    echo 'Dry run: use --apply to configure continuous capture.'
    exit 0
fi
camera_dump=$("${camera_adb[@]}" shell dumpsys media.camera)
[[ "$camera_dump" == *'Active Camera Clients:'* ]] || { echo 'Camera service unavailable; refusing to change settings.' >&2; exit 1; }
camera_owners=$(printf '%s\n' "$camera_dump" | awk '
    /Active Camera Clients:/ {active = 1; next}
    active && /^[[:space:]]*\]/ {active = 0}
    active && /Client Package Name:/ {print}
')
[[ -z "$camera_owners" ]] || { echo 'Release active camera owners before changing settings.' >&2; exit 1; }
for camera_property in "${camera_properties[@]}"; do
    "${camera_adb[@]}" shell su 0 setprop "$camera_property" 0
    camera_value=$("${camera_adb[@]}" shell getprop "$camera_property")
    [[ "${camera_value//$'\r'/}" == 0 ]] || { echo "Failed to set $camera_property" >&2; exit 1; }
done
if [[ "$camera_indoor" == true ]]; then
    "${camera_adb[@]}" shell su 0 setprop vendor.flock.chromatix.max_exposure_time_ms 30
    "${camera_adb[@]}" shell su 0 setprop vendor.flock.chromatix.apply true
    camera_exposure=$("${camera_adb[@]}" shell getprop vendor.flock.chromatix.max_exposure_time_ms)
    [[ "${camera_exposure//$'\r'/}" == 30 ]] || { echo 'Failed to set indoor exposure ceiling.' >&2; exit 1; }
    camera_applied=$("${camera_adb[@]}" shell getprop vendor.flock.chromatix.apply)
    [[ "${camera_applied//$'\r'/}" == true ]] || { echo 'Failed to apply indoor exposure ceiling.' >&2; exit 1; }
fi
echo 'Continuous capture configured. Motion mode and timeout are both 0.'
