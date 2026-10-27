const fs=require('node:fs'),crypto=require('node:crypto');
function nextConversionKey(key){return crypto.createHash('sha256').update('after-invalid-diagnostic-20261027:'+key).digest('hex');}
function conversionRequestKey(key,file){
  let journal;
  try{journal=JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.code==='ENOENT')return key;throw new Error('Conversion recovery history cannot be read; posting held');}
  if(!journal||typeof journal!=='object'||Array.isArray(journal))throw new Error('Invalid conversion recovery history');
  const entry=journal[key];if(!entry)return key;
  if(entry.status!=='reversed_verified'||!/^gid:\/\/shopify\/InventoryAdjustmentGroup\/\d+$/.test(entry.reversalAdjustmentId||'')||
      !/^gid:\/\/shopify\/InventoryAdjustmentGroup\/\d+$/.test(entry.originalAdjustmentId||'')||entry.nextRequestKey!==nextConversionKey(key))throw new Error('Invalidated diagnostic conversion is held pending verified reversal');
  return entry.nextRequestKey;
}
module.exports={nextConversionKey,conversionRequestKey};
