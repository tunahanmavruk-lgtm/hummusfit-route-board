# NETUM Q900 warehouse handoff

This is the known-good configuration for Hummus Fit Order Picking, direct
barcode delivery, and Zebra crate-label printing. Use it for every new Q900.

## Required device configuration

- Connect the Q900 to **Hummis Wifi**.
- Install the Order Picking PWA from:
  `https://hummusfit-route-board-production.up.railway.app/picking`
- Install the current `android-print-bridge/build/hf-auto-print.apk`.
- Open **HF Auto Print** once and save Zebra IP `10.0.75.254`.
- Keep the HF Auto Print foreground service running.
- Lock the device in portrait.

## Scanner configuration

Open the NETUM **Scan Configuration** app and set:

| Setting | Value |
| --- | --- |
| Scan Switch | ON |
| Focus Input | OFF |
| Send Broadcast | ON |
| BroadcastTransmission | `com.android.hs.action.BARCODE_SEND` |
| BroadcastBarcodeString | `scanner_result` |
| BroadcastBarcodeByte | `scanner_result_byte` |

After saving the three broadcast fields, return to the main Scan
Configuration screen. Cycle **Send Broadcast** off and back on, then cycle
**Scan Switch** off and back on. This reloads the scanner service with the new
values. Reopen Order Picking afterward.

Do not use Focus Input for production picking. On the Q900 it can beep and
decode correctly while Chrome drops the barcode or Enter key. Broadcast mode
delivers the decoded barcode directly to HF Auto Print, which exposes it to the
picking page on `127.0.0.1:8877`.

## Portrait lock through ADB

```sh
adb -s DEVICE_SERIAL shell settings put system accelerometer_rotation 0
adb -s DEVICE_SERIAL shell settings put system user_rotation 0
```

Apply the portrait lock after leaving Scan Configuration because that system
app may temporarily rotate the Q900 to landscape.

## Handoff verification

1. Confirm HF Auto Print reports `HF Auto Print ready` and printer IP
   `10.0.75.254` at `GET http://127.0.0.1:8877/status`.
2. Open Order Picking and confirm **Auto Print ready** is visible.
3. From the pick-list screen, scan a test barcode while observing Android logs.
   One physical scan must produce exactly one `HFAutoPrint: Scanner event
   received` entry and advance the bridge's `latestId` by one.
4. Send a clearly marked, non-order 4 x 3 handoff label through `POST /print`.
   Confirm it prints once, fully framed, without a following blank label.
5. If testing against a live order, record the before/after quantity and confirm
   exactly one unit was added. Otherwise remain on the pick-list screen so no
   order state changes.
6. Confirm the screen remains portrait after closing and reopening the PWA.

## Known-good units

- `NT000026032100389`
- `NT000026011300177`

Both use Zebra `10.0.75.254` and the broadcast settings above.
