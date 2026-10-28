const crypto = require("crypto");
const { essentialsTypeFor } = require("./essentials-shadow");
const RESTORED_MAPPINGS = require("./verified-retail-case-mappings-2026-10-12.json");

// Only catalog pairs that have been reviewed against the actual Shopify
// variants may change store inventory. The SKU suffix alone is not proof of
// a physical pack count or of which POS product should receive the units.
const VERIFIED_CASE_MAPPINGS = Object.freeze({
  // 2026-10-17: wrapper-verified sticks; independently verified bar UPCs.
  // Manufacturer confirms 15ct. Evidence: phorm-mapping-evidence-2026-10-17.json.
  "MF-7170515-CS": Object.freeze({unitSku:"MF-7170515-EA",unitsPerCase:15,caseVariantId:"gid://shopify/ProductVariant/51226012811511",unitVariantId:"gid://shopify/ProductVariant/51226012844279",unitBarcode:"850075829255",lookupByVariantId:true}),
  "MF-7170514-CS": Object.freeze({unitSku:"MF-7170514-EA",unitsPerCase:15,caseVariantId:"gid://shopify/ProductVariant/51260314419447",unitVariantId:"gid://shopify/ProductVariant/51226013008119",unitBarcode:"850036648932",lookupByVariantId:true}),
  "MF-7171008-CS": Object.freeze({unitSku:"MF-7171008-EA",unitsPerCase:15,caseVariantId:"gid://shopify/ProductVariant/51226012549367",unitVariantId:"gid://shopify/ProductVariant/51226012582135",unitBarcode:"850036648581",lookupByVariantId:true}),
  "MF-7171000-CS": Object.freeze({unitSku:"MF-7171000-EA",unitsPerCase:15,caseVariantId:"gid://shopify/ProductVariant/51259630092535",unitVariantId:"gid://shopify/ProductVariant/51226012778743",unitBarcode:"850026196122",lookupByVariantId:true}),
  // Tony-confirmed wrapper and 12 bags per case; POS unit activated 2026-10-17.
  "POINTS-DARK-CS": Object.freeze({unitSku:"POINTS-DARK-EA",unitsPerCase:12,caseVariantId:"gid://shopify/ProductVariant/51233895842039",unitVariantId:"gid://shopify/ProductVariant/51233895612663",unitBarcode:"860008611826",lookupByVariantId:true}),
  // Tony-confirmed individual wrappers; manufacturer confirms 15 bars per box.
  "MF-7171013-CS": Object.freeze({unitSku:"MF-7171013-EA",unitsPerCase:15,caseVariantId:"gid://shopify/ProductVariant/51259630059767",unitVariantId:"gid://shopify/ProductVariant/51226012680439",unitBarcode:"850062928794",lookupByVariantId:true}),
  "MF-7171015-CS": Object.freeze({unitSku:"MF-7171015-EA",unitsPerCase:15,caseVariantId:"gid://shopify/ProductVariant/51259630125303",unitVariantId:"gid://shopify/ProductVariant/51226012942583",unitBarcode:"850062928510",lookupByVariantId:true}),
  // 2026-10-17 physical case/can photos: receipt-confirmed conversion only.
  "MF-7700008-CS": Object.freeze({
    unitSku: "MF-7700008-EA", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51260314616055",
    unitVariantId: "gid://shopify/ProductVariant/51226013434103",
    unitBarcode: "860014554520", lookupByVariantId: true,
  }),
  "MF-6310672-CS": Object.freeze({
    unitSku: "MF-6310672-EA", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51226013073655",
    unitVariantId: "gid://shopify/ProductVariant/51226013106423",
    unitBarcode: "810137322902", lookupByVariantId: true,
  }),
  // 2026-10-17: independently verified single-can UPCs and exact catalog
  // identities. Configuration only: no stock is added until a verified receipt.
  "MF-7700006-CS": Object.freeze({
      "unitSku": "MF-7700006-EA",
      "unitsPerCase": 12,
      "caseVariantId": "gid://shopify/ProductVariant/51226013270263",
      "unitVariantId": "gid://shopify/ProductVariant/51226013335799",
      "unitBarcode": "810193920500",
      "lookupByVariantId": true
  }),
  "MF-7700004-CS": Object.freeze({
      "unitSku": "MF-7700004-EA",
      "unitsPerCase": 12,
      "caseVariantId": "gid://shopify/ProductVariant/51260314648823",
      "unitVariantId": "gid://shopify/ProductVariant/51226013565175",
      "unitBarcode": "850069104801",
      "lookupByVariantId": true
  }),
  "MF-7700005-CS": Object.freeze({
      "unitSku": "MF-7700005-EA",
      "unitsPerCase": 12,
      "caseVariantId": "gid://shopify/ProductVariant/51260314681591",
      "unitVariantId": "gid://shopify/ProductVariant/51226013630711",
      "unitBarcode": "850069104993",
      "lookupByVariantId": true
  }),
  "MF-7320011-CS": Object.freeze({
      "unitSku": "MF-7320011-EA",
      "unitsPerCase": 12,
      "caseVariantId": "gid://shopify/ProductVariant/51226012418295",
      "unitVariantId": "gid://shopify/ProductVariant/51226012483831",
      "unitBarcode": "850063790383",
      "lookupByVariantId": true
  }),
  "MF-6310019-CS": Object.freeze({
      "unitSku": "MF-6310019-EA",
      "unitsPerCase": 12,
      "caseVariantId": "gid://shopify/ProductVariant/51259630158071",
      "unitVariantId": "gid://shopify/ProductVariant/51226013171959",
      "unitBarcode": "850041914749",
      "lookupByVariantId": true
  }),
  // Muscle Foods final invoice 9991193-1 bills ELEV8 as individual tubs.
  // Separate one-unit store packs let Flow credit the exact order line before
  // the verified receipt converts it to the corresponding POS unit.
  "MF-7760001-P1": Object.freeze({unitSku:"MF-7760001-EA",unitsPerCase:1,caseVariantId:"gid://shopify/ProductVariant/51510660563191",unitVariantId:"gid://shopify/ProductVariant/51510541877495",unitBarcode:"628942370793",lookupByVariantId:true}),
  "MF-7760004-P1": Object.freeze({unitSku:"MF-7760004-EA",unitsPerCase:1,caseVariantId:"gid://shopify/ProductVariant/51510660595959",unitVariantId:"gid://shopify/ProductVariant/51510541910263",unitBarcode:"628942370755",lookupByVariantId:true}),
  "MF-7760012-P1": Object.freeze({unitSku:"MF-7760012-EA",unitsPerCase:1,caseVariantId:"gid://shopify/ProductVariant/51510660628727",unitVariantId:"gid://shopify/ProductVariant/51510541943031",unitBarcode:"628942370830",lookupByVariantId:true}),
  "MF-7760014-P1": Object.freeze({unitSku:"MF-7760014-EA",unitsPerCase:1,caseVariantId:"gid://shopify/ProductVariant/51510660661495",unitVariantId:"gid://shopify/ProductVariant/51510541975799",unitBarcode:"628340660090",lookupByVariantId:true}),
  // The same invoice bills RP Protein Puffs as ten EA bags per flavor and
  // identifies the manufacturer case as six bags. Store ordering uses only
  // complete six-bag cases assembled from the verified loose-bag stock.
  "MF-7610061-CS6": Object.freeze({unitSku:"MF-7610061-EA",unitsPerCase:6,caseVariantId:"gid://shopify/ProductVariant/51510660825335",unitVariantId:"gid://shopify/ProductVariant/51510542041335",unitBarcode:"847644011449",lookupByVariantId:true}),
  "MF-7610062-CS6": Object.freeze({unitSku:"MF-7610062-EA",unitsPerCase:6,caseVariantId:"gid://shopify/ProductVariant/51510660858103",unitVariantId:"gid://shopify/ProductVariant/51510542074103",unitBarcode:"847644011432",lookupByVariantId:true}),
  // The invoice confirms one 12-can case. Keep the Celsius case unpublished
  // until its physical can barcode is checked against the sell-unit variant.
  "MF-8670041-CS": Object.freeze({unitSku:"MF-8670041-EA",unitsPerCase:12,caseVariantId:"gid://shopify/ProductVariant/51510542172407",unitVariantId:"gid://shopify/ProductVariant/51510742843639",unitBarcode:"889392003185",lookupByVariantId:true}),
  // Revalidated against exact live Shopify variants, SKUs and unit barcodes.
  // Explicit entries below retain newer physical-barcode corrections.
  ...Object.fromEntries(RESTORED_MAPPINGS.map(({caseSku, ...mapping}) => [caseSku, Object.freeze(mapping)])),
  // Bucked Up future 3-bag store packs use new case variants. Keep historical
  // C6 mappings in RESTORED_MAPPINGS unchanged. The draft product retains its
  // mapping-pending tag, so conversion stays blocked until catalog release.
  "HF-NYB-BUCKEDUP-700-P3": Object.freeze({
    unitSku: "810203842808", unitsPerCase: 3,
    caseVariantId: "gid://shopify/ProductVariant/51376821272823",
    unitVariantId: "gid://shopify/ProductVariant/51279797092599",
    unitBarcode: "810203842808", lookupByVariantId: true,
  }),
  "HF-NYB-BUCKEDUP-701-P3": Object.freeze({
    unitSku: "810203842815", unitsPerCase: 3,
    caseVariantId: "gid://shopify/ProductVariant/51376821305591",
    unitVariantId: "gid://shopify/ProductVariant/51279797125367",
    unitBarcode: "810203842815", lookupByVariantId: true,
  }),
  // New imported drinks: exact physical case/can barcodes and Shopify variants.
  // Mapping only. Dunkin's draft sell unit and case mapping-pending tag keep
  // conversion blocked until catalog release; all stock still requires a
  // verified store receipt, destination case credit, and idempotent ledger.
  "HF-DUNKIN-ZERO-PEAR-CS6": Object.freeze({
    unitSku: "HF-DUNKIN-ZERO-PEAR-EA", unitsPerCase: 6,
    caseVariantId: "gid://shopify/ProductVariant/51391867322615",
    unitVariantId: "gid://shopify/ProductVariant/51391867486455",
    unitBarcode: "8809288634936", lookupByVariantId: true,
  }),
  // Fanta Zero Orange: exact physical six-pack and individual-can variants.
  // The case remains draft and mapping-pending until its store release.
  "HF-FANTA-KR-ZERO-ORANGE-CS6": Object.freeze({
    unitSku: "HF-FANTA-KR-ZERO-ORANGE-EA", unitsPerCase: 6,
    caseVariantId: "gid://shopify/ProductVariant/51392031654135",
    unitVariantId: "gid://shopify/ProductVariant/51392032309495",
    unitBarcode: "8801094347208", lookupByVariantId: true,
  }),
  "HF-SUFFOLK-MON-KR-STRAWBERRY-C24": Object.freeze({
    unitSku: "HF-SUFFOLK-MON-KR-STRAWBERRY-U1", unitsPerCase: 24,
    caseVariantId: "gid://shopify/ProductVariant/51391900647671",
    unitVariantId: "gid://shopify/ProductVariant/51391900680439",
    unitBarcode: "4897036695203", lookupByVariantId: true,
  }),
  // The store-order listing contains only Blue and Strawberry Dreams. Keep
  // historical case mappings above/below for previously fulfilled orders.
  "HF-SUFFOLK-MON-JP-BLUE-C24-ORDER": Object.freeze({
    unitSku: "HF-SUFFOLK-MON-JP-BLUE-U1", unitsPerCase: 24,
    caseVariantId: "gid://shopify/ProductVariant/51432898101495",
    unitVariantId: "gid://shopify/ProductVariant/51322304135415",
    unitBarcode: "4897036690055", lookupByVariantId: true,
  }),
  "HF-SUFFOLK-MON-KR-STRAWBERRY-C24-ORDER": Object.freeze({
    unitSku: "HF-SUFFOLK-MON-KR-STRAWBERRY-U1", unitsPerCase: 24,
    caseVariantId: "gid://shopify/ProductVariant/51432898199799",
    unitVariantId: "gid://shopify/ProductVariant/51391900680439",
    unitBarcode: "4897036695203", lookupByVariantId: true,
  }),
  // Monster Japan: exact 24-can pairs. Configuration only; verified physical
  // receipt and existing destination case credit are required before posting.
  "HF-SUFFOLK-MON-JP-WHITE-C24": Object.freeze({
    "unitSku": "HF-SUFFOLK-MON-JP-WHITE-U1",
    "unitsPerCase": 24,
    "caseVariantId": "gid://shopify/ProductVariant/51322197999863",
    "unitVariantId": "gid://shopify/ProductVariant/51322304102647",
    "unitBarcode": "4897036690895",
    "lookupByVariantId": true
  }),
  "HF-SUFFOLK-MON-JP-BLUE-C24": Object.freeze({
    "unitSku": "HF-SUFFOLK-MON-JP-BLUE-U1",
    "unitsPerCase": 24,
    "caseVariantId": "gid://shopify/ProductVariant/51322198032631",
    "unitVariantId": "gid://shopify/ProductVariant/51322304135415",
    "unitBarcode": "4897036690055",
    "lookupByVariantId": true
  }),
  "HF-SUFFOLK-MON-JP-PEACH-C24": Object.freeze({
    "unitSku": "HF-SUFFOLK-MON-JP-PEACH-U1",
    "unitsPerCase": 24,
    "caseVariantId": "gid://shopify/ProductVariant/51322198065399",
    "unitVariantId": "gid://shopify/ProductVariant/51322304168183",
    "unitBarcode": "4897036694466",
    "lookupByVariantId": true
  }),
  "HF-SUFFOLK-MON-JP-PARADISE-C24": Object.freeze({
    "unitSku": "HF-SUFFOLK-MON-JP-PARADISE-U1",
    "unitsPerCase": 24,
    "caseVariantId": "gid://shopify/ProductVariant/51322198098167",
    "unitVariantId": "gid://shopify/ProductVariant/51322304200951",
    "unitBarcode": "4897036692707",
    "lookupByVariantId": true
  }),
  // NYB 2026-10-15: exact catalog pairs; configuration only, never an
  // incoming-stock credit. Existing verified receipt/ledger guards apply.
  // Barebells Protein Bars — 12 Bars — Soft Banana Caramel
  "HF-NYB-NOCCO-402-C12": Object.freeze({
    unitSku: "850064950021", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51322016727287",
    unitVariantId: "gid://shopify/ProductVariant/50622668964087",
    unitBarcode: "850064950021", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  // Barebells Protein Bars — 12 Bars — Banana Bread
  "HF-NYB-NOCCO-222-C12": Object.freeze({
    unitSku: "850075778454", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51322016760055",
    unitVariantId: "gid://shopify/ProductVariant/51085963100407",
    unitBarcode: "850075778454", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  // Barebells Protein Bars — 12 Bars — Brownie Batter
  "HF-NYB-NOCCO-219-C12": Object.freeze({
    unitSku: "850075778447", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51322016792823",
    unitVariantId: "gid://shopify/ProductVariant/50644958511351",
    unitBarcode: "850075778447", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  // Barebells Protein Bars — 12 Bars — Coconut Caramel Almond
  "HF-NYB-NOCCO-216-C12": Object.freeze({
    unitSku: "850064950700", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51322016825591",
    unitVariantId: "gid://shopify/ProductVariant/51085963034871",
    unitBarcode: "850064950700", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  // Barebells Protein Bars — 12 Bars — Peanut Butter & Jelly
  "HF-NYB-NOCCO-218-C12": Object.freeze({
    unitSku: "850075778270", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51322016858359",
    unitVariantId: "gid://shopify/ProductVariant/50622667620599",
    unitBarcode: "850075778270", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  // Core Power Elite 42g Protein Shakes — 12 × 14 oz Bottles — Chocolate
  "HF-NYB-FL-101-C12": Object.freeze({
    unitSku: "HF-NYB-FL-101-U1", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51322014105847",
    unitVariantId: "gid://shopify/ProductVariant/51322121683191",
    unitBarcode: "811620020633", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  // GHOST Energy — 12 × 16 oz Cans — Peach
  "HF-NYB-GHOST-118-C12": Object.freeze({
    unitSku: "HF-NYB-GHOST-118-U1", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51322014171383",
    unitVariantId: "gid://shopify/ProductVariant/51322123616503",
    unitBarcode: "810128529853", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  // Quest Tortilla Style Protein Chips — 8 Bags — Salsa Verde
  "HF-NYB-QUEST3106-C8": Object.freeze({
    unitSku: "888849016136", unitsPerCase: 8,
    caseVariantId: "gid://shopify/ProductVariant/51322014040311",
    unitVariantId: "gid://shopify/ProductVariant/50344585986295",
    unitBarcode: "888849016136", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  // Single-bar UPCs independently verified against distributor/retailer
  // catalogs; manufacturer and retailer distinguish the 12-bar display box.
  "HF-BUILT-SOURPUFF-GREENAPPLE-CS12": Object.freeze({
    unitSku: "840229306558", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51317893366007",
    unitVariantId: "gid://shopify/ProductVariant/51317895364855",
    unitBarcode: "840229306558", lookupByVariantId: true,
    requirePosSellUnitTag: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-BUILT-SOURPUFF-PINKLEMONADE-CS12": Object.freeze({
    // Preserve the existing internal SKU; it is NOT the scannable UPC.
    // 840229306800 is a four-pack code, not an individual wrapper barcode.
    unitSku: "840229306800", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51317893398775",
    unitVariantId: "gid://shopify/ProductVariant/51317895397623",
    unitBarcode: "840229306794", lookupByVariantId: true,
    requirePosSellUnitTag: true,
    allowSharedProductMappingPendingTag: true,
  }),
  // Exact single-bag variants and UPCs verified in the connected catalog and
  // manufacturer's listings. One display case contains 12 retail bags.
  "HF-SOURSTRIPS-LEMONBERRY-CS12": Object.freeze({
    unitSku: "860004712527", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51317893234935",
    unitVariantId: "gid://shopify/ProductVariant/51317895069943",
    unitBarcode: "860004712527", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-SOURSTRIPS-APPLEBERRY-CS12": Object.freeze({
    unitSku: "860001800593", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51317893267703",
    unitVariantId: "gid://shopify/ProductVariant/50348807389431",
    unitBarcode: "860001800593", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-SOURSTRIPS-GREENAPPLE-CS12": Object.freeze({
    unitSku: "860001800548", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51317893300471",
    unitVariantId: "gid://shopify/ProductVariant/50348807323895",
    unitBarcode: "860001800548", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-SOURSTRIPS-STRAWBERRY-CS12": Object.freeze({
    unitSku: "860001800517", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51317893333239",
    unitVariantId: "gid://shopify/ProductVariant/50348807422199",
    unitBarcode: "860001800517", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  // Exact catalog pairs verified 2026-10-16. Receipt-triggered only;
  // adding a mapping neither creates case credits nor replays old receipts.
  "GLOBAL GT628004-CS6": Object.freeze({
    unitSku: "SS-8801094063283", unitsPerCase: 6,
    caseVariantId: "gid://shopify/ProductVariant/51304197292279",
    unitVariantId: "gid://shopify/ProductVariant/51331378938103",
    unitBarcode: "8801094063283",
    requirePosSellUnitTag: true,
    lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "Global GT628008-CS24": Object.freeze({
    unitSku: "SS-8801056044503", unitsPerCase: 24,
    caseVariantId: "gid://shopify/ProductVariant/51317812330743",
    unitVariantId: "gid://shopify/ProductVariant/51331378708727",
    unitBarcode: "8801056044503",
    requirePosSellUnitTag: true,
    lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "GLOBAL GT628019-CS6": Object.freeze({
    unitSku: "SS-8801056911379", unitsPerCase: 6,
    caseVariantId: "gid://shopify/ProductVariant/51317812297975",
    unitVariantId: "gid://shopify/ProductVariant/51331378675959",
    unitBarcode: "8801056911379",
    requirePosSellUnitTag: true,
    lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "GLOBAL GT628021-CS24": Object.freeze({
    unitSku: "SS-8801056175900", unitsPerCase: 24,
    caseVariantId: "gid://shopify/ProductVariant/51304197914871",
    unitVariantId: "gid://shopify/ProductVariant/51331379036407",
    unitBarcode: "8801056175900",
    requirePosSellUnitTag: true,
    lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-DRIZZ-BC-4OZ-CS12": Object.freeze({
    unitSku: "857900005402", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51322371768567",
    unitVariantId: "gid://shopify/ProductVariant/51134469701879",
    unitBarcode: "857900005402",
    lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-DRIZZ-CIN-4OZ-CS12": Object.freeze({
    unitSku: "857900005167", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51322371801335",
    unitVariantId: "gid://shopify/ProductVariant/51322449330423",
    unitBarcode: "857900005167",
    lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-DRIZZ-VB-4OZ-CS12": Object.freeze({
    unitSku: "853762002900", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51322371834103",
    unitVariantId: "gid://shopify/ProductVariant/51322455228663",
    unitBarcode: "853762002900",
    lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "GLOBAL GT628007-CS6": Object.freeze({
    unitSku: "SS-8801094000455", unitsPerCase: 6,
    caseVariantId: "gid://shopify/ProductVariant/51304197357815",
    unitVariantId: "gid://shopify/ProductVariant/51259495874807",
    unitBarcode: "8801094000455",
    requirePosSellUnitTag: true,
    // Exact live pair verified 2026-10-14. Catalog availability stays unchanged.
    lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-NYB-CELSIUS-141-C12": Object.freeze({
    unitSku: "889392002379", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51259609678071",
    unitVariantId: "gid://shopify/ProductVariant/50500192633079",
    unitBarcode: "889392002379",
    // The six CELSIUS flavors share one case product and its product-level
    // mapping-pending tag. Approve only this exact variant; the other five
    // flavors still have no case mapping and remain blocked.
    allowSharedProductMappingPendingTag: true,
  }),
  "MOODZ-STRAWBERRY-CS10": Object.freeze({
    unitSku: "MOODZ-STRAWBERRY-EA", unitsPerCase: 10,
    caseVariantId: "gid://shopify/ProductVariant/51284140654839",
    unitVariantId: "gid://shopify/ProductVariant/51284140785911",
    unitBarcode: "850075436248",
    requirePosSellUnitTag: true,
  }),
  "HF-NYB-CELL-4909-C12": Object.freeze({
    unitSku: "842595141467", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51259609546999",
    unitVariantId: "gid://shopify/ProductVariant/51279794733303",
    unitBarcode: "842595141467",
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-NYB-CELSIUS-131-C12": Object.freeze({
    unitSku: "889392001563", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51259609809143",
    unitVariantId: "gid://shopify/ProductVariant/51279794667767",
    unitBarcode: "889392001563",
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-NYB-CELSIUS-1004-C12": Object.freeze({
    unitSku: "889392000320", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51259609841911",
    unitVariantId: "gid://shopify/ProductVariant/51279794700535",
    unitBarcode: "889392000320",
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-NYB-GHOST-1000-C12": Object.freeze({
    unitSku: "GHOST-YOOHOO-11OZ-EA", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51259609940215",
    unitVariantId: "gid://shopify/ProductVariant/51280871325943",
    // Verified against the physical Yoo-hoo can photographed at Ronkonkoma.
    unitBarcode: "810169606353",
    requirePosSellUnitTag: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "MOODZ-BERRY-CS10": Object.freeze({
    unitSku: "MOODZ-BERRY-EA", unitsPerCase: 10,
    caseVariantId: "gid://shopify/ProductVariant/51284140753143",
    unitVariantId: "gid://shopify/ProductVariant/51284140884215",
    unitBarcode: "850075436262",
    requirePosSellUnitTag: true,
  }),
  "PS-075720000814-CS48": Object.freeze({
    unitSku: "075720000814", unitsPerCase: 48,
    caseVariantId: "gid://shopify/ProductVariant/50514177261815",
    unitVariantId: "gid://shopify/ProductVariant/50301570744567",
    unitBarcode: "075720000814",
  }),
  "HF-NYB-QUEST3100-C8": Object.freeze({
    unitSku: "888849006649", unitsPerCase: 8,
    caseVariantId: "gid://shopify/ProductVariant/51259610235127",
    unitVariantId: "gid://shopify/ProductVariant/50344585953527",
    unitBarcode: "888849006649",
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-NYB-QUEST3104-C8": Object.freeze({
    unitSku: "888849011063", unitsPerCase: 8,
    caseVariantId: "gid://shopify/ProductVariant/51259610267895",
    unitVariantId: "gid://shopify/ProductVariant/50344586019063",
    unitBarcode: "888849011063",
    allowSharedProductMappingPendingTag: true,
  }),
  "SS-4890008101306-CS8": Object.freeze({
    unitSku: "4890008101306", unitsPerCase: 8,
    caseVariantId: "gid://shopify/ProductVariant/51242421289207",
    unitVariantId: "gid://shopify/ProductVariant/51028267499767",
    unitBarcode: "4890008101306",
  }),
  "SS-8806002023472-CS24": Object.freeze({
    unitSku: "SS-8806002023472", unitsPerCase: 24,
    caseVariantId: "gid://shopify/ProductVariant/51242424631543",
    unitVariantId: "gid://shopify/ProductVariant/51259498889463",
    requirePosSellUnitTag: true,
    // Staff will select the exact POS SKU manually until its can barcode is verified.
    allowMissingBarcode: true,
  }),
  "BUILT-PFB0374-CS12": Object.freeze({
    unitSku: "840229307418", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51242437738743",
    unitVariantId: "gid://shopify/ProductVariant/51259495022839",
    unitBarcode: "840229307418",
    requirePosSellUnitTag: true,
    lookupByVariantId: true,
  }),
  "SD-PEACH-60G-CS8": Object.freeze({
    unitSku: "860014183430", unitsPerCase: 8,
    caseVariantId: "gid://shopify/ProductVariant/51242444226807",
    unitVariantId: "gid://shopify/ProductVariant/51259503444215",
    unitBarcode: "860014183430",
    requirePosSellUnitTag: true,
  }),
  // 2026-10-22: exact Tea Supreme case/sell-unit variants, live unit UPCs,
  // unique SKUs, costs and prices verified. Conversion remains receipt-gated.
  // Glass Zero Sugar Lemon uses the published Diet Lemon bottle UPC now saved
  // on its exact POS variant; a physical bottle scan is still required before
  // treating checkout scanning as field-verified.
  "HF-SNAP-GLASS-DIET-PEACH-CS12": Object.freeze({
    unitSku: "HF-SNAP-GLASS-DIET-PEACH-EA", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51375699460343",
    unitVariantId: "gid://shopify/ProductVariant/51385414942967",
    unitBarcode: "076183163573", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-SNAP-GLASS-DIET-LEMON-CS12": Object.freeze({
    unitSku: "HF-SNAP-GLASS-DIET-LEMON-EA", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51375699493111",
    unitVariantId: "gid://shopify/ProductVariant/51385414975735",
    unitBarcode: "076183163764", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-SNAP-GLASS-APPLE-CS12": Object.freeze({
    unitSku: "HF-SNAP-GLASS-APPLE-EA", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51375699525879",
    unitVariantId: "gid://shopify/ProductVariant/51385415008503",
    unitBarcode: "076183168509", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-SNAP-PET-DIET-PEACH-CS24": Object.freeze({
    unitSku: "HF-SNAP-PET-DIET-PEACH-EA", unitsPerCase: 24,
    caseVariantId: "gid://shopify/ProductVariant/51375700214007",
    unitVariantId: "gid://shopify/ProductVariant/51385415401719",
    unitBarcode: "076183003145", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-SNAP-PET-DIET-LEMON-CS24": Object.freeze({
    unitSku: "HF-SNAP-PET-DIET-LEMON-EA", unitsPerCase: 24,
    caseVariantId: "gid://shopify/ProductVariant/51375700246775",
    unitVariantId: "gid://shopify/ProductVariant/51385415434487",
    unitBarcode: "076183003206", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-SNAP-PET-RASPBERRY-CS24": Object.freeze({
    unitSku: "HF-SNAP-PET-RASPBERRY-EA", unitsPerCase: 24,
    caseVariantId: "gid://shopify/ProductVariant/51375700279543",
    unitVariantId: "gid://shopify/ProductVariant/51385415467255",
    unitBarcode: "076183003190", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-SNAP-PET-DIET-RASPBERRY-CS24": Object.freeze({
    unitSku: "HF-SNAP-PET-DIET-RASPBERRY-EA", unitsPerCase: 24,
    caseVariantId: "gid://shopify/ProductVariant/51375700312311",
    unitVariantId: "gid://shopify/ProductVariant/51385415500023",
    unitBarcode: "076183003213", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-SNAP-PET-LEMON-CS24": Object.freeze({
    unitSku: "HF-SNAP-PET-LEMON-EA", unitsPerCase: 24,
    caseVariantId: "gid://shopify/ProductVariant/51375700345079",
    unitVariantId: "gid://shopify/ProductVariant/51385415532791",
    unitBarcode: "076183003152", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-SNAP-PET-PEACH-CS24": Object.freeze({
    unitSku: "HF-SNAP-PET-PEACH-EA", unitsPerCase: 24,
    caseVariantId: "gid://shopify/ProductVariant/51375700377847",
    unitVariantId: "gid://shopify/ProductVariant/51385415565559",
    unitBarcode: "076183003114", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-BAI-CLEMENTINE-CS12": Object.freeze({
    unitSku: "HF-BAI-CLEMENTINE-EA", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51375686713591",
    unitVariantId: "gid://shopify/ProductVariant/51385415663863",
    unitBarcode: "813694026887", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-BAI-WATERMELON-CS12": Object.freeze({
    unitSku: "HF-BAI-WATERMELON-EA", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51375686746359",
    unitVariantId: "gid://shopify/ProductVariant/51385415696631",
    unitBarcode: "813694026696", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-BAI-CHERRY-CS12": Object.freeze({
    unitSku: "HF-BAI-CHERRY-EA", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51375686779127",
    unitVariantId: "gid://shopify/ProductVariant/51385415729399",
    unitBarcode: "813694026672", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-BAI-COCONUT-CS12": Object.freeze({
    unitSku: "HF-BAI-COCONUT-EA", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51375686811895",
    unitVariantId: "gid://shopify/ProductVariant/51385415762167",
    unitBarcode: "813694026719", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
  "HF-VITACOCO-ORIGINAL-CARTON-CS12": Object.freeze({
    unitSku: "HF-VITACOCO-ORIGINAL-CARTON-EA", unitsPerCase: 12,
    caseVariantId: "gid://shopify/ProductVariant/51375700443383",
    unitVariantId: "gid://shopify/ProductVariant/51385415827703",
    unitBarcode: "898999010007", lookupByVariantId: true,
    allowSharedProductMappingPendingTag: true,
  }),
});

// The 14 active Hummus Fit POS stores. Route Board calls East Islip "Islip";
// Shopify uses the full location name. The kitchen and shipping warehouse
// are intentionally absent, as are non-store/B2B stops.
const POS_STORE_LOCATIONS = Object.freeze({
  Bellmore: "Hummus Fit Bellmore",
  "Deer Park": "Hummus Fit Deer Park",
  Islip: "Hummus Fit East Islip",
  Farmingdale: "Hummus Fit Farmingdale",
  Holbrook: "Hummus Fit Holbrook",
  Huntington: "Hummus Fit Huntington",
  "Island Park": "Hummus Fit Island Park",
  "Lake Grove": "Hummus Fit Lake Grove",
  Lindenhurst: "Hummus Fit Lindenhurst",
  Lynbrook: "Hummus Fit Lynbrook",
  "Miller Place": "Hummus Fit Miller Place",
  Ronkonkoma: "Hummus Fit Ronkonkoma",
  Selden: "Hummus Fit Selden",
  Woodbury: "Hummus Fit Woodbury",
});

// Never infer a pack size or POS variant from a merchandising title or SKU.
function caseMapping(item) {
  if (essentialsTypeFor(item) !== "retail") return null;
  const caseSku = String(item.sku || "").trim();
  if (!caseSku) return {
    caseSku: String(item.title || "").trim(),
    error: "Retail Essentials case is missing a Shopify SKU and approved POS mapping",
  };
  const mapping = VERIFIED_CASE_MAPPINGS[caseSku];
  if (!mapping) return { caseSku, error: "Case SKU needs an approved case-to-POS-unit mapping" };
  return { caseSku, ...mapping };
}

function receiptLines(order, essentialsRecord, receivedCounts, readItemState) {
  const retail = (order.lineItems || []).filter((item) => essentialsTypeFor(item) === "retail");
  if (!retail.length) return [];
  if (!essentialsRecord || !essentialsRecord.completedAt || essentialsRecord.orderId !== order.orderId) {
    throw new Error("Essentials picking has not been completed for this exact order");
  }
  if (!receivedCounts || typeof receivedCounts !== "object" || Array.isArray(receivedCounts)) {
    throw new Error("Verified received case counts are required");
  }
  // The receiving UI keys manual entries for SKU-less products by title.
  // Preserve that key so one unmapped case cannot invalidate an otherwise
  // approved case conversion in the same verified store receipt.
  const receiptCountKey = (item) => String(item.sku || "").trim() || String(item.title || "").trim();
  const allowed = new Set(retail.map(receiptCountKey));
  for (const sku of Object.keys(receivedCounts)) {
    if (!allowed.has(sku)) throw new Error(`Unexpected receipt SKU: ${sku}`);
  }
  return retail.map((item, index) => {
    const workflowIndex = (order.lineItems || []).filter((entry) => essentialsTypeFor(entry)).indexOf(item);
    const status = readItemState(essentialsRecord.itemStatus, item, workflowIndex);
    const scanned = Number(readItemState(essentialsRecord.itemScannedCount, item, workflowIndex)) || 0;
    const receivedCases = Number(receivedCounts[receiptCountKey(item)]);
    if(status==='missing' && scanned===0 && receivedCases===0) {
      return {...caseMapping(item),title:item.title,pickedCases:0,receivedCases:0,index};
    }
    if (status !== "picked" || scanned !== item.quantity) {
      throw new Error(`Essentials picking is not fully verified: ${item.sku || item.title}`);
    }
    if (!Number.isSafeInteger(receivedCases) || receivedCases < 0 || receivedCases > scanned) {
      throw new Error(`Invalid received case count: ${item.sku || item.title}`);
    }
    return { ...caseMapping(item), title: item.title, pickedCases: scanned, receivedCases, index };
  });
}

function receiptKey(store, orderId, caseSku) {
  return crypto.createHash("sha256").update(JSON.stringify([store, orderId, caseSku])).digest("hex");
}

function validateCaseAndUnit(line, caseItem, unitItem) {
  if (caseItem.mappingPending && !line.allowSharedProductMappingPendingTag) {
    throw new Error("Case-to-unit mapping is still pending catalog verification");
  }
  if (!(caseItem.unitCost > 0) || !(unitItem.price > 0)) {
    throw new Error("Case cost and POS sell-unit price must be verified before conversion");
  }
  if (unitItem.price <= caseItem.unitCost / line.unitsPerCase) {
    throw new Error("POS sell-unit price does not exceed the case-derived unit cost; verify case count and cost");
  }
  if (caseItem.available < line.receivedCases) throw new Error("Case stock has not arrived at this Shopify location");
}

function adjustmentPlan(line, caseItem, unitItem, locationId, key) {
  validateCaseAndUnit(line, caseItem, unitItem);
  if (!Number.isSafeInteger(unitItem.available)) {
    throw new Error("POS sell-unit inventory is not active at this Shopify location");
  }
  const units = line.receivedCases * line.unitsPerCase;
  if (!Number.isSafeInteger(units) || units > 100000) throw new Error("Invalid sell-unit quantity");
  return {
    receivedCases: line.receivedCases,
    units,
    input: {
      name: "available", reason: "correction",
      referenceDocumentUri: `gid://hummusfit-receiving/CaseConversion/${key}`,
      changes: [
        { inventoryItemId: caseItem.id, locationId, delta: -line.receivedCases, changeFromQuantity: caseItem.available },
        { inventoryItemId: unitItem.id, locationId, delta: units, changeFromQuantity: unitItem.available },
      ],
    },
  };
}

module.exports = { caseMapping, receiptLines, receiptKey, validateCaseAndUnit, adjustmentPlan, POS_STORE_LOCATIONS, VERIFIED_CASE_MAPPINGS };
