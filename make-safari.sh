#!/bin/bash
# Generates a Safari-wrapped Xcode project from ./extension for personal use.
# Prerequisite: full Xcode installed and selected (see the checks below).
set -euo pipefail
cd "$(dirname "$0")"

OUT="$HOME/Desktop/ListenToPageSafari"
BUNDLE_ID="${1:-com.$(whoami).ListenToPage}"

if ! xcode-select -p 2>/dev/null | grep -q "Xcode.*\.app"; then
  echo "Xcode is not the active developer directory. Run:"
  echo "  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
  echo "  sudo xcodebuild -license accept && sudo xcodebuild -runFirstLaunch"
  exit 1
fi
if ! xcrun --find safari-web-extension-converter >/dev/null 2>&1; then
  echo "safari-web-extension-converter not found. Open Xcode once so it finishes installing components."
  exit 1
fi

xcrun safari-web-extension-converter "$PWD/extension" \
  --project-location "$OUT" \
  --app-name "Listen to Page" \
  --bundle-identifier "$BUNDLE_ID" \
  --macos-only \
  --no-prompt

echo
echo "Done. Next in Xcode: pick the macOS scheme, set a Team under Signing & Capabilities"
echo "for BOTH targets, press Cmd+R. Then in Safari: Develop > Allow Unsigned Extensions,"
echo "and enable the extension under Settings > Extensions (website access: Always Allow)."
