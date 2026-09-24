(function(root, factory){
  var layout = typeof module === 'object' && module.exports
    ? require('./crate-label-layout.js') : root.buildCrateLabelPages;
  var create = factory(layout);
  if(typeof module === 'object' && module.exports) module.exports = create;
  else root.createCrateLabelZpl = create;
})(typeof window !== 'undefined' ? window : globalThis, function(buildPages){
  function safe(value){
    return String(value == null ? '' : value)
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7e]/g, ' ').replace(/[\^~]/g, '')
      .replace(/\s+/g, ' ').trim();
  }
  function field(x, y, height, value, reversed){
    return '^FO' + x + ',' + y + '^A0N,' + height + ',' + height +
      (reversed ? '^FR' : '') + '^FD' + safe(value) + '^FS';
  }
  function pattern(kind){
    var result = [];
    for(var y = 94; y <= 242; y += 24){
      if(kind === 'dots'){
        result.push('^FO31,' + y + '^GB5,5,5^FS', '^FO44,' + (y + 10) + '^GB5,5,5^FS');
      }else if(kind === 'chevron'){
        result.push('^FO30,' + y + '^GD21,11,3,B,R^FS', '^FO30,' + y + '^GD21,11,3,B,L^FS');
      }else if(kind === 'vertical'){
        result.push('^FO32,' + y + '^GB4,14,4^FS', '^FO45,' + y + '^GB4,14,4^FS');
      }else if(kind === 'horizontal'){
        result.push('^FO30,' + y + '^GB21,4,4^FS');
      }else if(kind === 'crosshatch'){
        result.push('^FO30,' + y + '^GB21,3,3^FS', '^FO40,' + y + '^GB3,14,3^FS');
      }else if(kind === 'brick'){
        result.push('^FO30,' + y + '^GB21,3,3^FS', '^FO30,' + (y + 10) + '^GB10,3,3^FS');
      }else if(kind === 'waves'){
        result.push('^FO30,' + y + '^GB8,3,3^FS', '^FO43,' + (y + 7) + '^GB8,3,3^FS');
      }else{
        result.push('^FO30,' + y + '^GD21,13,3,B,R^FS');
      }
    }
    return result;
  }
  function storeFields(name){
    var words = buildPages.wrap(safe(name).toUpperCase(), 18);
    if(words.length === 1 && name.length <= 10) return [field(73, 121, 85, words[0])];
    if(words.length === 1) return [field(73, 137, name.length > 15 ? 45 : 56, words[0])];
    var size = words.length > 2 ? 32 : 45;
    var start = words.length > 2 ? 99 : 109;
    return words.map(function(line, i){ return field(73, start + i * (size + 7), size, line); });
  }
  function onePage(data, crateNumber, page){
    var name = safe(data.stopNameUpper || data.stopName || 'STORE').toUpperCase();
    var route = safe(data.routeName || 'HUMMUS FIT').toUpperCase();
    var code = safe(data.identity && data.identity.monogram || name.replace(/[^A-Z]/g, '').slice(0, 3)).toUpperCase();
    var crate = safe(crateNumber);
    var zpl = [
      // The production ZD421 measures this 4 x 3 gap stock at a 620-dot
      // pitch. Matching that pitch keeps each format on one physical label.
      // The 18-dot origin offset keeps the header inside the printable edge.
      '^XA', '^CI0', '^PW812', '^LL620', '^LH0,18', '^LS0',
      '^FO12,12^GB788,588,2^FS',
      '^FO14,14^GB784,62,62^FS',
      field(30, 26, route.length > 26 ? 20 : 28, route, true),
      field(667, 26, 29, code, true),
      '^FO59,93^GB2,157,2^FS',
    ];
    zpl.push.apply(zpl, pattern(data.identity && data.identity.pattern));
    zpl.push.apply(zpl, storeFields(name));
    zpl.push('^FO585,91^GB196,161,4^FS');
    zpl.push(field(628, 101, 28, 'CRATE'));
    zpl.push(field(crate.length > 1 ? 623 : 649, 150, crate.length > 1 ? 78 : 90, crate));
    zpl.push('^FO29,263^GB753,3,3^FS');
    zpl.push(field(30, 275, 24, 'ORDER  ' + (data.orderName || '')));
    if(data.pickedBy) zpl.push(field(565, 279, 17, 'PICKED BY ' + safe(data.pickedBy).split(/[ ,]/)[0].toUpperCase()));
    zpl.push('^FO29,319^GB753,2,2^FS');
    zpl.push(field(30, 328, 19, 'CONTENTS'));
    if(page.total > 1) zpl.push(field(654, 329, 16, 'LABEL ' + page.number + '/' + page.total));
    if(page.columns === 2) zpl.push('^FO405,358^GB1,232,1^FS');
    page.entries.forEach(function(entry){
      var x = entry.column ? 416 : 30;
      var titleX = x + (page.columns === 2 ? 40 : 61);
      if(entry.quantity) zpl.push(field(x, entry.y + 1, page.columns === 2 ? 18 : 32, entry.quantity));
      entry.lines.forEach(function(line, i){
        zpl.push(field(titleX, entry.y + i * (page.columns === 2 ? 23 : page.font + 5), page.font, line));
      });
    });
    zpl.push('^PQ1', '^XZ');
    return zpl.join('\n') + '\n';
  }
  function pages(data, crateNumber){
    return buildPages(data).map(function(page){ return onePage(data, crateNumber, page); });
  }
  function createCrateLabelZpl(data, crateNumber){ return pages(data, crateNumber).join(''); }
  createCrateLabelZpl.pages = pages;
  return createCrateLabelZpl;
});
