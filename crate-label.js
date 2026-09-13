const PDFDocument = require("pdfkit");

const LABEL_WIDTH_IN = 4;
const LABEL_HEIGHT_IN = 3;
const LABEL_WIDTH_PT = LABEL_WIDTH_IN * 72;
const LABEL_HEIGHT_PT = LABEL_HEIGHT_IN * 72;

function firstNameOf(value) {
  return String(value || "").split(",")[0].trim().split(/\s+/)[0] || "";
}

function fitText(doc, text, width, maxSize, minSize) {
  for (let size = maxSize; size > minSize; size -= 0.5) {
    doc.font("Helvetica-Bold").fontSize(size);
    if (doc.widthOfString(text) <= width) return size;
  }
  return minSize;
}

function singleLineText(doc, text, x, y, width, maxSize, minSize) {
  const size = fitText(doc, text, width, maxSize, minSize);
  doc.font("Helvetica-Bold").fontSize(size).fillColor("#111111")
    .text(text, x, y, { width, height: size + 2, lineBreak: false, ellipsis: true });
}

function renderCrateLabelPdf(stream, data, crateNumber, options = {}) {
  const doc = new PDFDocument({ size: [LABEL_WIDTH_PT, LABEL_HEIGHT_PT], margin: 0 });
  doc.pipe(stream);

  const margin = 11;
  const innerWidth = LABEL_WIDTH_PT - margin * 2;
  const crateWidth = 82;
  const storeWidth = innerWidth - crateWidth - 8;

  doc.rect(4, 4, LABEL_WIDTH_PT - 8, LABEL_HEIGHT_PT - 8)
    .lineWidth(1.2).strokeColor("#111111").stroke();

  doc.font("Helvetica-Bold").fontSize(7).fillColor("#666666")
    .text((data.routeName || "HUMMUS FIT").toUpperCase(), margin, 11, {
      width: storeWidth,
      characterSpacing: 0.6,
      lineBreak: false,
    });

  singleLineText(doc, data.stopNameUpper, margin, 24, storeWidth, 25, 13);
  singleLineText(doc, `CRATE ${crateNumber}`, LABEL_WIDTH_PT - margin - crateWidth, 22, crateWidth, 27, 17);

  doc.font("Helvetica").fontSize(7).fillColor("#555555")
    .text(`Order: ${data.orderName || "TEST"}`, margin, 52, {
      width: innerWidth / 2,
      lineBreak: false,
      ellipsis: true,
    });
  if (data.pickedBy) {
    doc.text(`Picked by ${firstNameOf(data.pickedBy)}`, margin + innerWidth / 2, 52, {
      width: innerWidth / 2,
      align: "right",
      lineBreak: false,
      ellipsis: true,
    });
  }

  doc.moveTo(margin, 65).lineTo(LABEL_WIDTH_PT - margin, 65)
    .strokeColor("#111111").lineWidth(0.8).stroke();
  doc.font("Helvetica-Bold").fontSize(7).fillColor("#777777")
    .text(options.testLabel ? "4 × 3 CALIBRATION / CONTENTS" : "CONTENTS", margin, 70, {
      width: innerWidth,
      characterSpacing: 0.5,
      lineBreak: false,
    });

  const startY = 78;
  const bottomY = LABEL_HEIGHT_PT - 10;
  const availableHeight = bottomY - startY;
  const sourceItems = Array.isArray(data.crateItems) ? data.crateItems : [];
  const tiers = [
    { fontSize: 10, rowHeight: 18 },
    { fontSize: 9, rowHeight: 16 },
    { fontSize: 8, rowHeight: 14 },
    { fontSize: 7, rowHeight: 12 },
  ];

  let tier = tiers[tiers.length - 1];
  const columns = sourceItems.length > 7 ? 2 : 1;
  for (const candidate of tiers) {
    const rowsAvailable = Math.floor(availableHeight / candidate.rowHeight);
    if (sourceItems.length <= rowsAvailable * columns) {
      tier = candidate;
      break;
    }
  }

  const gap = columns === 2 ? 12 : 0;
  const columnWidth = (innerWidth - gap) / columns;
  const maxRows = Math.floor(availableHeight / tier.rowHeight);
  const capacity = maxRows * columns;
  let items = sourceItems.slice(0, capacity);
  const hiddenCount = sourceItems.length - items.length;
  if (hiddenCount > 0 && items.length) {
    items = items.slice(0, -1).concat([{ quantity: "+", title: `${hiddenCount + 1} more — see packing slip`, overflow: true }]);
  }

  if (columns === 2) {
    const dividerX = margin + columnWidth + gap / 2;
    doc.moveTo(dividerX, startY).lineTo(dividerX, bottomY)
      .strokeColor("#DDDDDD").lineWidth(0.5).stroke();
  }

  items.forEach((item, index) => {
    const column = Math.floor(index / maxRows);
    const row = index % maxRows;
    const x = margin + column * (columnWidth + gap);
    const y = startY + row * tier.rowHeight;
    const qtyWidth = 19;

    doc.font(item.overflow ? "Helvetica-BoldOblique" : "Helvetica-Bold")
      .fontSize(tier.fontSize).fillColor(item.overflow ? "#777777" : "#111111")
      .text(String(item.quantity), x, y + 1, { width: qtyWidth, lineBreak: false });
    singleLineText(doc, String(item.title), x + qtyWidth, y + 1, columnWidth - qtyWidth,
      tier.fontSize, 5.5);

    if (row < maxRows - 1) {
      doc.moveTo(x, y + tier.rowHeight - 2).lineTo(x + columnWidth, y + tier.rowHeight - 2)
        .strokeColor("#E7E7E7").lineWidth(0.35).stroke();
    }
  });

  if (options.testLabel) {
    doc.font("Helvetica").fontSize(6).fillColor("#555555")
      .text("Edges should be fully visible. Print at Actual size / 100%.", margin, LABEL_HEIGHT_PT - 16, {
        width: innerWidth,
        align: "center",
        lineBreak: false,
      });
  }

  doc.end();
  return doc;
}

module.exports = {
  LABEL_HEIGHT_IN,
  LABEL_HEIGHT_PT,
  LABEL_WIDTH_IN,
  LABEL_WIDTH_PT,
  renderCrateLabelPdf,
};
