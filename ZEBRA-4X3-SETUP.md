# HF Logistics Zebra printer setup

## Assigned printers

The warehouse uses two separate network printer profiles from the same NETUM:

- **Orders / crate labels:** Zebra at `10.0.75.254`, using 4×3 direct-thermal labels.
- **Essentials:** Zebra ZD620 at `192.168.6.41`, using 3×1 direct-thermal gap labels.

Do not swap these profiles in HF Auto Print. The app routes each label job to
the appropriate printer automatically.

## Wireless requirement

Both printers must be reachable from the NETUM warehouse Wi-Fi by their reserved IP addresses. The connection can be built-in Wi-Fi or wired Ethernet to the same LAN; no cable is required between the NETUM and either printer.

Use **Wi-Fi as the primary connection**. It lets multiple authorized picking devices share the printer, reconnects without pairing each session, and is easier to support. Keep Bluetooth Classic as the fallback for one nearby Android device. Bluetooth Low Energy is for setup and discovery and is not supported for Zebra Print label jobs.

## One-time wireless setup

1. Load the assigned direct-thermal gap stock: 4×3 in the Orders printer or 3×1 in the Essentials ZD620. The printable face should point upward as it passes over the platen. Keep the gap sensor aligned with the label gap.
2. Close the printer and wait for a solid green Status light.
3. Hold **Pause + Cancel** together for two seconds, then release. The printer will feed several labels and return to solid green when SmartCal finishes.
4. Put the printer on the same LAN as the picking devices and reserve its IP address in the router.
5. Configure the printer for its assigned stock:
   - Orders: **4 inches across × 3 inches in the feed direction**
   - Essentials ZD620: **3 inches across × 1 inch in the feed direction**
   - Zebra Print rotation: **0°**
   - Zebra Print Fit To Page: **off**
   - Media type: **Labels with gaps / web sensing**
   - Print method: **Direct thermal**
   - Resolution: **203 dpi**
6. Configure each picking device:
   - **NETUM Q900 for automatic labels:** install `android-print-bridge/build/hf-auto-print.apk`, open **HF Auto Print**, save Orders IP `10.0.75.254` and Essentials IP `192.168.6.41`, then keep its ongoing notification enabled. The companion listens only on the NETUM's loopback address and sends each job to its named printer profile.
   - **Other Android devices:** install Zebra Print, add the printer using **Wi-Fi and Ethernet Network**, select the discovered ZD421 or enter its reserved IP address, then finish setup. These devices use Android's normal print dialog.
   - **Windows/macOS:** install the Zebra driver and add the ZD421 as a network printer using its reserved IP address. The Logistics app continues to use the normal browser print dialog.
   - **Bluetooth fallback on Android:** pair through Zebra Print using **Bluetooth Classic**. Do not select a BLE-only connection.
7. In HF Logistics, test **Order Picking** against the Orders printer, then open **Essentials Picking** and test the ZD620.
8. Each test must print exactly one label automatically with no dialog. The ZD620's known-good calibrated values are 609-dot print width and approximately 210-dot label pitch at 203 dpi.

## Acceptance check

The calibration label passes when:

- all four border edges are visible and no edge is clipped;
- one label feeds for one print job;
- the store name and crate number are sharp and centered within the border;
- the smallest contents line can be read at arm's length;
- the next blank label stops exactly at the tear edge.

If the printer skips labels or the starting position moves, rerun SmartCal. If the label is uniformly enlarged or clipped, correct the operating-system paper size and disable Fit or Scale to page.

## Daily operation

Leave both printers powered on and connected to the warehouse LAN. On a configured NETUM, regular food/order picking keeps its existing crate workflow: **New Crate** and **Confirm & Finish** send 4×3 crate labels to the Orders printer. Essentials never use crates. Each successful Essentials case scan immediately sends one 3×1 label to the ZD620, marked with the store, product, and `CASE n OF total`. The catalog-validation page is scan-only and intentionally does not print labels. If the companion cannot reach the selected printer, the page shows an error so the case can be held aside and retried. When loading another roll with the same stock, press Feed once or twice; a full SmartCal is normally unnecessary.

Order labels emphasize the store name, destination code/pattern, and a large crate number. A crowded food crate prints numbered continuation labels. Essentials case labels instead identify the store, Shopify order, product, and case sequence; attach each 3×1 label directly to the physical product case that was just scanned.

## Wireless troubleshooting

- **Printer is missing:** confirm the picking device and printer are on the same Wi-Fi network and that guest/client isolation is disabled. In Zebra Print, add it directly by the reserved IP address.
- **Printer IP keeps changing:** create a DHCP reservation for the printer in the router and re-add it once using that address.
- **Auto Print not ready on the NETUM:** open HF Auto Print, check its ongoing notification, verify both printer IP fields, and keep the NETUM on the warehouse network. Run both in-app test labels before using a live order.
- **Bluetooth print fails:** confirm the device uses Bluetooth Classic, exit Zebra Print's Printer Settings screen, and retry from the picking page's print dialog.
- **Job is clipped or scaled:** select 4 × 3-inch media, Rotation 0°, and disable Fit To Page in Zebra Print.
- **Labels skip or drift:** rerun SmartCal by holding Pause + Cancel for two seconds.
