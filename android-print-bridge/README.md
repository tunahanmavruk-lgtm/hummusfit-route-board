# HF Auto Print for NETUM Q900

This small Android companion sends 4 × 3-inch crate labels from the HF Logistics picking page to the Zebra on the local Wi-Fi network. The picking page saves the crate first, obtains its crate-specific items, then posts one ZPL job to `127.0.0.1:8877` on that NETUM. The companion forwards the job to the configured private IPv4 printer address on TCP 9100. The browser uses the Android print dialog if the companion is absent.

The HTTP listener binds to loopback only and accepts browser requests only from `https://hummusfit-route-board-production.up.railway.app`. The `X-HF-Print` header forces an origin-checked preflight. A bounded in-memory job-ID cache rejects repeat submissions of the same job. A successful response means the job was sent to the Zebra socket; it does not prove that physical media exited the printer.

Build with `sh android-print-bridge/build.sh` from the route-board repository after installing Android SDK platform 34, build-tools 35.0.0, and Java. The signed APK is `android-print-bridge/build/hf-auto-print.apk`. The local `.signing/` directory is intentionally untracked; preserve its keystore to update installed devices without uninstalling them.

Install on each NETUM with `adb install -r android-print-bridge/build/hf-auto-print.apk`. Open **HF Auto Print** once, allow notifications, verify or save the Zebra IP, and tap **Open Order Picking**. The service uses an ongoing notification and requests a restart after device boot. The printer and NETUM must share a Wi-Fi network that allows TCP 9100.
