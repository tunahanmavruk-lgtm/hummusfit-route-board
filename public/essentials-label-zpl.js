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
    var store = fit(data && data.stopNameUpper, 27) || 'STORE';
    var order = fit(data && data.orderName, 15) || 'ORDER';
    var item = fit(data && data.itemTitle, 46) || 'ESSENTIALS CASE';
    var caseNumber = Math.max(1, Number(data && data.caseNumber) || 1);
    var totalCases = Math.max(caseNumber, Number(data && data.totalCases) || 1);
    return [
      '^XA', '^CI28', '^PW609', '^LL203', '^LH0,0', '^PON', '^PQ1,0,1,N',
      '^FO6,6^GB597,191,4^FS',
      '^CF0,30', '^FO22,18^FD' + store + '^FS',
      '^CF0,20', '^FO438,23^FD' + order + '^FS',
      '^FO20,55^GB569,2,2^FS',
      '^CF0,27', '^FO22,69^FB565,2,3,L,0^FD' + item + '^FS',
      '^CF0,28', '^FO22,154^FDCASE ' + caseNumber + ' OF ' + totalCases + '^FS',
      '^CF0,18', '^FO408,161^FDESSENTIALS^FS',
      '^XZ'
    ].join('\n');
  }

  return {
    createEssentialsLabelZpl: createEssentialsLabelZpl,
    createEssentialsCaseLabelZpl: createEssentialsCaseLabelZpl
  };
});
