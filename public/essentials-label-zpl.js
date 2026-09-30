(function(root, factory){
  var api = factory();
  if(typeof module === 'object' && module.exports) module.exports = api;
  root.createEssentialsLabelZpl = api.createEssentialsLabelZpl;
  root.createEssentialsCaseLabelZpl = api.createEssentialsCaseLabelZpl;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(){
  function safe(value){
    return String(value == null ? '' : value)
      .replace(/[\^~]/g, ' ')
      .replace(/[^\x20-\x7e]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function fit(value, max){
    var text = safe(value).toUpperCase();
    return text.length > max ? text.slice(0, Math.max(0, max - 1)) + '.' : text;
  }

  function compactOrder(value){
    var names = safe(value).toUpperCase().split(',').map(function(name){ return name.trim(); }).filter(Boolean);
    if(!names.length) return 'ORDER';
    var newest = names[names.length - 1];
    return fit(names.length > 1 ? newest + ' +' + (names.length - 1) : newest, 17);
  }

  function createEssentialsLabelZpl(data, crateNumber){
    var store = fit(data && data.stopNameUpper, 28) || 'STORE';
    var order = fit(data && data.orderName, 24) || 'ORDER';
    var items = Array.isArray(data && data.crateItems) ? data.crateItems : [];
    var quantity = items.reduce(function(sum, item){ return sum + (Number(item.quantity) || 0); }, 0);
    var crate = Math.max(1, Number(crateNumber) || 1);
    return [
      '^XA', '^CI28', '^PW609', '^LL203', '^LH0,0', '^PON', '^PQ1,0,1,N',
      '^FO6,6^GB597,191,4^FS',
      '^CF0,34', '^FO24,20^FD' + store + '^FS',
      '^CF0,25', '^FO24,69^FD' + order + '^FS',
      '^CF0,24', '^FO24,111^FDESSENTIALS^FS',
      '^CF0,22', '^FO24,151^FDQTY ' + quantity + '^FS',
      '^CF0,30', '^FO420,112^FDCRATE ' + crate + '^FS',
      '^XZ'
    ].join('\n');
  }

  function createEssentialsCaseLabelZpl(data){
    var store = fit(data && data.stopNameUpper, 19) || 'STORE';
    var order = compactOrder(data && data.orderName);
    var item = fit(data && data.itemTitle, 60) || 'ESSENTIALS CASE';
    var caseNumber = Math.max(1, Number(data && data.caseNumber) || 1);
    var totalCases = Math.max(caseNumber, Number(data && data.totalCases) || 1);
    return [
      '^XA', '^CI28', '^PW609', '^LL203', '^LH0,0', '^PON', '^PQ1,0,1,N',
      '^FO6,6^GB597,191,4^FS',
      '^CF0,36', '^FO20,14^FB400,1,0,L,0^FD' + store + '^FS',
      '^CF0,20', '^FO412,21^FB175,1,0,R,0^FD' + order + '^FS',
      '^FO20,55^GB569,3,3^FS',
      '^CF0,29', '^FO20,67^FB565,2,3,L,0^FD' + item + '^FS',
      '^FO20,148^GB185,40,40^FS',
      '^CF0,20', '^FR', '^FO35,158^FDESSENTIALS^FS',
      '^CF0,34', '^FO225,151^FB362,1,0,R,0^FDCASE ' + caseNumber + ' OF ' + totalCases + '^FS',
      '^XZ'
    ].join('\n');
  }

  return {
    createEssentialsLabelZpl: createEssentialsLabelZpl,
    createEssentialsCaseLabelZpl: createEssentialsCaseLabelZpl
  };
});
