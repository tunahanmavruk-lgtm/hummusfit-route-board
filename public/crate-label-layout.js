(function(root, factory){
  var build = factory();
  if(typeof module === 'object' && module.exports) module.exports = build;
  else root.buildCrateLabelPages = build;
})(typeof window !== 'undefined' ? window : globalThis, function(){
  function clean(value){ return String(value == null ? '' : value).replace(/\s+/g, ' ').trim(); }

  function wrap(value, limit){
    var words = clean(value).split(' ');
    var lines = [];
    var current = '';
    words.forEach(function(word){
      while(word.length > limit){
        if(current){ lines.push(current); current = ''; }
        lines.push(word.slice(0, limit));
        word = word.slice(limit);
      }
      if(!word) return;
      if(current && (current.length + 1 + word.length > limit)){
        lines.push(current);
        current = word;
      }else{
        current = current ? current + ' ' + word : word;
      }
    });
    if(current) lines.push(current);
    return lines.length ? lines : [''];
  }

  // Coordinates are native 203-dpi Zebra dots. The PDF and browser-print
  // fallbacks use the same page assignments, so no path silently drops items.
  function buildCrateLabelPages(data){
    var source = Array.isArray(data.crateItems) ? data.crateItems : [];
    if(!source.length) throw new Error('Cannot print an empty crate.');
    var oneFont = source.length <= 3 ? 31 : 24;
    var oneLimit = source.length <= 3 ? 38 : 44;
    var oneEntries = source.map(function(item){
      var lines = wrap(item.title, oneLimit);
      return { quantity:clean(item.quantity), lines:lines, height:Math.max(38, lines.length * (oneFont + 5) + 10) };
    });
    var single = source.length <= 7 && oneEntries.reduce(function(n, entry){ return n + entry.height; }, 0) <= 225;
    var columns = single ? 1 : 2;
    var font = single ? oneFont : 18;
    var lineHeight = single ? oneFont + 5 : 23;
    var limit = single ? oneLimit : 29;
    var pages = [{ columns:columns, font:font, entries:[] }];
    var column = 0;
    var y = 365;
    function nextColumn(){
      if(column === 0 && columns === 2){ column = 1; y = 365; }
      else { pages.push({ columns:columns, font:font, entries:[] }); column = 0; y = 365; }
    }
    source.forEach(function(item, sourceIndex){
      var lines = wrap(item.title, limit);
      var wholeHeight = Math.max(single ? 38 : 27, lines.length * lineHeight + (single ? 10 : 4));
      if(wholeHeight <= 225 && y + wholeHeight > 592) nextColumn();
      var first = true;
      while(lines.length){
        var available = Math.floor((592 - y - 5) / lineHeight);
        if(available < 1){
          nextColumn();
          available = Math.floor((592 - y - 5) / lineHeight);
        }
        var part = lines.splice(0, available);
        var height = Math.max(single ? 38 : 27, part.length * lineHeight + (single ? 10 : 4));
        pages[pages.length - 1].entries.push({
          quantity:first ? clean(item.quantity) : '>',
          lines:part, column:column, y:y, height:height, sourceIndex:sourceIndex,
        });
        y += height;
        first = false;
      }
    });
    pages.forEach(function(page, index){ page.number = index + 1; page.total = pages.length; });
    return pages;
  }
  buildCrateLabelPages.wrap = wrap;
  return buildCrateLabelPages;
});
