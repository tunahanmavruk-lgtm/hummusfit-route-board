const PDFDocument = require("pdfkit");
const buildCrateLabelPages = require("./public/crate-label-layout.js");

const LABEL_WIDTH_IN = 4;
const LABEL_HEIGHT_IN = 3;
const LABEL_WIDTH_PT = 288;
const LABEL_HEIGHT_PT = 216;
const dot = (n) => n * 72 / 203;
const firstNameOf = (value) => String(value || "").split(",")[0].trim().split(/\s+/)[0] || "";

function fitted(doc, value, x, y, width, size, minSize = 5) {
  let actual = size;
  doc.font("Helvetica-Bold");
  while (actual > minSize && doc.fontSize(actual).widthOfString(value) > width) actual -= 0.5;
  doc.fontSize(actual).fillColor("#111111").text(value, dot(x), dot(y), {
    width: dot(width), height: actual + 2, lineBreak: false,
  });
}

function drawPattern(doc, kind) {
  doc.save().strokeColor("#111111").fillColor("#111111");
  for (let y = 94; y <= 242; y += 24) {
    if (kind === "dots") {
      doc.circle(dot(33), dot(y + 2), dot(2.5)).fill();
      doc.circle(dot(47), dot(y + 12), dot(2.5)).fill();
    } else if (kind === "chevron") {
      doc.moveTo(dot(30), dot(y)).lineTo(dot(40), dot(y + 11))
        .lineTo(dot(51), dot(y)).lineWidth(dot(3)).stroke();
    } else if (kind === "vertical") {
      doc.rect(dot(32), dot(y), dot(4), dot(14)).fill();
      doc.rect(dot(45), dot(y), dot(4), dot(14)).fill();
    } else if (kind === "horizontal") {
      doc.rect(dot(30), dot(y), dot(21), dot(4)).fill();
    } else if (kind === "crosshatch") {
      doc.rect(dot(30), dot(y), dot(21), dot(3)).fill();
      doc.rect(dot(40), dot(y), dot(3), dot(14)).fill();
    } else if (kind === "brick" || kind === "waves") {
      doc.rect(dot(30), dot(y), dot(12), dot(3)).fill();
      doc.rect(dot(42), dot(y + 9), dot(9), dot(3)).fill();
    } else {
      doc.moveTo(dot(30), dot(y + 13)).lineTo(dot(51), dot(y))
        .lineWidth(dot(3)).stroke();
    }
  }
  doc.restore();
}

function drawPage(doc, data, crateNumber, page, options) {
  const name = String(data.stopNameUpper || data.stopName || "STORE").toUpperCase();
  const route = String(data.routeName || "HUMMUS FIT").toUpperCase();
  const code = String(data.identity?.monogram || name.replace(/[^A-Z]/g, "").slice(0, 3));
  doc.rect(dot(12), dot(12), dot(788), dot(593)).lineWidth(dot(2)).strokeColor("#111111").stroke();
  doc.rect(dot(14), dot(14), dot(784), dot(62)).fill("#111111");
  doc.font("Helvetica-Bold").fillColor("#FFFFFF").fontSize(dot(route.length > 26 ? 20 : 28))
    .text(route, dot(30), dot(26), { width: dot(600), height: dot(35), lineBreak: false });
  doc.fontSize(dot(29)).text(code, dot(667), dot(26), {
    width: dot(110), align: "right", lineBreak: false,
  });
  doc.fillColor("#111111").rect(dot(59), dot(93), dot(2), dot(157)).fill();
  drawPattern(doc, data.identity?.pattern || "diagonal");

  const storeLines = buildCrateLabelPages.wrap(name, 18);
  if (storeLines.length === 1 && name.length <= 10) {
    fitted(doc, name, 73, 121, 490, dot(85), dot(40));
  } else if (storeLines.length === 1) {
    fitted(doc, name, 73, 137, 490, dot(name.length > 15 ? 45 : 56), dot(27));
  } else {
    const size = storeLines.length > 2 ? 32 : 45;
    const start = storeLines.length > 2 ? 99 : 109;
    storeLines.forEach((line, i) => fitted(doc, line, 73, start + i * (size + 7), 490, dot(size), dot(20)));
  }

  doc.rect(dot(585), dot(91), dot(196), dot(161)).lineWidth(dot(4)).stroke();
  fitted(doc, "CRATE", 628, 101, 145, dot(28));
  fitted(doc, String(crateNumber), String(crateNumber).length > 1 ? 623 : 649,
    150, 125, dot(String(crateNumber).length > 1 ? 78 : 90));

  doc.rect(dot(29), dot(263), dot(753), dot(3)).fill();
  fitted(doc, "ORDER  " + (data.orderName || ""), 30, 275, 510, dot(24), dot(15));
  if (data.pickedBy) fitted(doc, "PICKED BY " + firstNameOf(data.pickedBy).toUpperCase(),
    565, 279, 210, dot(17), dot(11));
  doc.rect(dot(29), dot(319), dot(753), dot(2)).fill();
  fitted(doc, options.testLabel ? "4 x 3 TEST / CONTENTS" : "CONTENTS", 30, 328, 400, dot(19));
  if (page.total > 1) fitted(doc, `LABEL ${page.number}/${page.total}`, 654, 329, 122, dot(16));
  if (page.columns === 2) doc.rect(dot(405), dot(358), dot(1), dot(232)).fill();

  page.entries.forEach((entry) => {
    const x = entry.column ? 416 : 30;
    const titleX = x + (page.columns === 2 ? 40 : 61);
    if (entry.quantity) fitted(doc, entry.quantity, x, entry.y + 1,
      page.columns === 2 ? 36 : 55, dot(page.columns === 2 ? 18 : 32));
    entry.lines.forEach((line, i) => fitted(doc, line, titleX,
      entry.y + i * (page.columns === 2 ? 23 : page.font + 5),
      page.columns === 2 ? 314 : 685, dot(page.font), dot(page.columns === 2 ? 12 : 17)));
  });
}

function renderCrateLabelPdf(stream, data, crateNumber, options = {}) {
  const pages = buildCrateLabelPages(data);
  const doc = new PDFDocument({ size: [LABEL_WIDTH_PT, LABEL_HEIGHT_PT], margin: 0, autoFirstPage: false });
  doc.pipe(stream);
  pages.forEach((page) => {
    doc.addPage();
    drawPage(doc, data, crateNumber, page, options);
  });
  doc.end();
  return doc;
}

module.exports = {
  LABEL_HEIGHT_IN, LABEL_HEIGHT_PT, LABEL_WIDTH_IN, LABEL_WIDTH_PT, renderCrateLabelPdf,
};
