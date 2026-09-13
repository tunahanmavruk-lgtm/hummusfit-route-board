# HF Logistics Zebra 4×3 setup

## Recommended printer

Use the **Zebra ZD421, 203 dpi, direct-thermal configuration** as the primary crate-label printer.

The ZD421 is the current, supported model and is easier to keep in service. The ZD620 is faster and includes Ethernet on standard configurations, but Zebra discontinued North American sales in 2021 and ended standard service and support in 2024. Keep the ZD620 as a spare.

## Wireless requirement

Use the **ZD421 wireless model with the factory-installed Wi-Fi and Bluetooth Classic radio**. Wireless is an optional hardware configuration on the ZD421; software cannot add it to a USB-only unit. Print the printer/network configuration report and confirm that Wi-Fi or Bluetooth Classic is listed before rollout.

Use **Wi-Fi as the primary connection**. It lets multiple authorized picking devices share the printer, reconnects without pairing each session, and is easier to support. Keep Bluetooth Classic as the fallback for one nearby Android device. Bluetooth Low Energy is for setup and discovery and is not supported for Zebra Print label jobs.

## One-time wireless setup

1. Load **4-inch-wide × 3-inch-long direct-thermal gap labels**. The printable face should point upward as it passes over the platen. Keep the gap sensor in its normal centered web/gap position.
2. Close the printer and wait for a solid green Status light.
3. Hold **Pause + Cancel** together for two seconds, then release. The printer will feed several labels and return to solid green when SmartCal finishes.
4. Use Zebra Setup Utilities on Android, iOS, Windows, or macOS to join the ZD421 to the same Wi-Fi network used by the picking devices. Record the printer IP address and reserve it in the router so it does not change.
5. Configure the printer settings:
   - Paper size: **4 × 3 inches**
   - Orientation: **Landscape**
   - Scale: **Actual size / 100%**
   - Media type: **Labels with gaps / web sensing**
   - Print method: **Direct thermal**
   - Resolution: **203 dpi**
6. Configure each picking device:
   - **Android (recommended for tablets/phones):** install Zebra Print, add the printer using **Wi-Fi and Ethernet Network**, select the discovered ZD421 or enter its reserved IP address, then finish setup. The printer will appear in Android's normal print dialog.
   - **Windows/macOS:** install the Zebra driver and add the ZD421 as a network printer using its reserved IP address. The Logistics app continues to use the normal browser print dialog.
   - **Bluetooth fallback on Android:** pair through Zebra Print using **Bluetooth Classic**. Do not select a BLE-only connection.
7. In HF Logistics, open **Order Picking** and tap **Zebra 4×3 ready**.
8. Tap **Test 4×3 Label**, then Print. Select the wireless ZD421 and confirm 4 × 3, landscape, and 100% scale.

## Acceptance check

The calibration label passes when:

- all four border edges are visible and no edge is clipped;
- one label feeds for one print job;
- the store name and crate number are sharp and centered within the border;
- the smallest contents line can be read at arm's length;
- the next blank label stops exactly at the tear edge.

If the printer skips labels or the starting position moves, rerun SmartCal. If the label is uniformly enlarged or clipped, correct the operating-system paper size and disable Fit or Scale to page.

## Daily operation

Leave the ZD421 powered on and connected to the staff Wi-Fi network. Pickers use the existing crate workflow; every automatic or manual crate-label action opens the exact-size preview. They select the ZD421 and print. When loading another roll with the same stock, press Feed once or twice; a full SmartCal is normally unnecessary.

## Wireless troubleshooting

- **Printer is missing:** confirm the picking device and printer are on the same Wi-Fi network and that guest/client isolation is disabled. In Zebra Print, add it directly by the reserved IP address.
- **Printer IP keeps changing:** create a DHCP reservation for the printer in the router and re-add it once using that address.
- **Bluetooth print fails:** confirm the device uses Bluetooth Classic, exit Zebra Print's Printer Settings screen, and retry from the PDF print dialog.
- **Job is clipped or scaled:** select 4 × 3 inches, landscape, and Actual size / 100%; disable Fit to page.
- **Labels skip or drift:** rerun SmartCal by holding Pause + Cancel for two seconds.
