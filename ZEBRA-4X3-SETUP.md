# HF Logistics Zebra 4×3 setup

## Recommended printer

Use the **Zebra ZD421, 203 dpi, direct-thermal configuration** as the primary crate-label printer.

The ZD421 is the current, supported model and is easier to keep in service. The ZD620 is faster and includes Ethernet on standard configurations, but Zebra discontinued North American sales in 2021 and ended standard service and support in 2024. Keep the ZD620 as a spare.

## One-time workstation setup

Use a dedicated Windows 11 or macOS workstation with Chrome. USB is the simplest and most predictable connection.

1. **Before connecting the USB cable**, install the current ZD421 printer driver from Zebra Support. On Windows, install Zebra Printer Driver v10 and Zebra Setup Utilities.
2. Connect the printer to power and the workstation by USB, then turn it on.
3. Load **4-inch-wide × 3-inch-long direct-thermal gap labels**. The printable face should point upward as it passes over the platen. Keep the gap sensor in its normal centered web/gap position.
4. Close the printer and wait for a solid green Status light.
5. Hold **Pause + Cancel** together for two seconds, then release. The printer will feed several labels and return to solid green when SmartCal finishes.
6. In the operating-system printer settings, set:
   - Paper size: **4 × 3 inches**
   - Orientation: **Landscape**
   - Scale: **Actual size / 100%**
   - Media type: **Labels with gaps / web sensing**
   - Print method: **Direct thermal**
   - Resolution: **203 dpi**
7. In HF Logistics, open **Order Picking** and tap **Zebra 4×3 ready**.
8. Tap **Test 4×3 Label**, then Print. Select the ZD421 and confirm 4 × 3, landscape, and 100% scale.

## Acceptance check

The calibration label passes when:

- all four border edges are visible and no edge is clipped;
- one label feeds for one print job;
- the store name and crate number are sharp and centered within the border;
- the smallest contents line can be read at arm's length;
- the next blank label stops exactly at the tear edge.

If the printer skips labels or the starting position moves, rerun SmartCal. If the label is uniformly enlarged or clipped, correct the operating-system paper size and disable Fit or Scale to page.

## Daily operation

Leave the ZD421 connected to the same workstation. Pickers use the existing crate workflow; every automatic or manual crate-label action opens the exact-size preview. They select the ZD421 and print. When loading another roll with the same stock, press Feed once or twice; a full SmartCal is normally unnecessary.
