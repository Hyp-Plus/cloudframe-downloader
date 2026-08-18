#!/bin/zsh
set -euo pipefail

project_root="${0:A:h:h}"
app_bundle="$project_root/release/云帧下载器.app"
resources="$app_bundle/Contents/Resources"

cd "$project_root"
npm run build
mkdir -p "$project_root/release"
ditto "$project_root/node_modules/electron/dist/Electron.app" "$app_bundle"
rm "$resources/default_app.asar"
mkdir -p "$resources/app"
cp "$project_root/package.json" "$resources/app/package.json"
ditto "$project_root/dist" "$resources/app/dist"
ditto "$project_root/dist-electron" "$resources/app/dist-electron"
ditto "$project_root/assets" "$resources/app/assets"
cp "$project_root/assets/cloudframe.icns" "$resources/cloudframe.icns"
/usr/libexec/PlistBuddy -c 'Set :CFBundleDisplayName 云帧下载器' "$app_bundle/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleName 云帧下载器' "$app_bundle/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleIdentifier com.yunframe.downloader' "$app_bundle/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleShortVersionString 0.2.0' "$app_bundle/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleVersion 0.2.0' "$app_bundle/Contents/Info.plist"
/usr/libexec/PlistBuddy -c 'Set :CFBundleIconFile cloudframe.icns' "$app_bundle/Contents/Info.plist"
codesign --force --deep --sign - "$app_bundle"
