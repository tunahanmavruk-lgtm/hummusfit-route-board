(function(root, factory){
  var create = factory();
  if(typeof module === 'object' && module.exports) module.exports = create;
  else root.createCrateLabelZpl = create;
})(typeof window !== 'undefined' ? window : globalThis, function(){
  function safe(value){
    return String(value == null ? '' : value)
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7e]/g, ' ').replace(/[\^~]/g, '')
      .replace(/\s+/g, ' ').trim();
  }

  function field(x, y, height, text, max){
    var value = safe(text);
    if(max && value.length > max) value = value.slice(0, max - 1) + '.';
    return '^FO' + x + ',' + y + '^A0N,' + height + ',' + height + '^FD' + value + '^FS';
  }

  return function createCrateLabelZpl(data, crateNumber){
    var source = Array.isArray(data.crateItems) ? data.crateItems : [];
    if(!source.length) throw new Error('Cannot print an empty crate.');
    var stop = safe(data.stopNameUpper).toUpperCase();
    var storeSize = stop.length > 28 ? 29 : stop.length > 18 ? 35 : 49;
    var twoColumns = source.length > 9;
    var rows = twoColumns ? 11 : 9;
    var capacity = rows * (twoColumns ? 2 : 1);
    var items = source.slice(0, capacity);
    if(source.length > capacity){
      items = items.slice(0, -1).concat([{ quantity: '+', title: (source.length - capacity + 1) + ' more - packing slip' }]);
    }

    var zpl = [
      '^XA', '^CI0', '^PW812', '^LL617', '^LH0,0', '^LS0',
      '^FO12,12^GB788,593,2^FS',
      field(30, 26, 19, (data.routeName || 'HUMMUS FIT').toUpperCase(), 40),
      field(30, 68, storeSize, stop, storeSize < 35 ? 29 : storeSize < 49 ? 23 : 17),
      field(575, 69, 43, 'CRATE ' + crateNumber, 9),
      field(30, 137, 18, 'Order: ' + (data.orderName || ''), 28),
      field(530, 137, 18, data.pickedBy ? 'Picked by ' + safe(data.pickedBy).split(/[ ,]/)[0] : '', 24),
      '^FO30,170^GB752,1,2^FS',
      field(30, 183, 17, 'CONTENTS', 18),
    ];

    var rowHeight = twoColumns ? 31 : 39;
    var font = twoColumns ? 20 : 25;
    items.forEach(function(item, index){
      var column = twoColumns ? Math.floor(index / rows) : 0;
      var row = index % rows;
      var x = column ? 416 : 30;
      var y = 218 + row * rowHeight;
      var qty = safe(item.quantity);
      zpl.push(field(x, y, font, qty, 3));
      zpl.push(field(x + (twoColumns ? 40 : 52), y, font, item.title, twoColumns ? 22 : 37));
      if(row < rows - 1) zpl.push('^FO' + x + ',' + (y + rowHeight - 5) + '^GB' + (twoColumns ? 360 : 748) + ',1,1^FS');
    });

    zpl.push('^PQ1', '^XZ');
    return zpl.join('\n') + '\n';
  };
});
