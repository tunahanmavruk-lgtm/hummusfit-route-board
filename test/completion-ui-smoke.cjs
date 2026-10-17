// Isolated browser fixtures. Every request is intercepted; no live services,
// printers, Shopify orders or inventory are touched by this test.
const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:390,height:844}});
    let finishes=0,retries=0;
    const completion={foodComplete:true,essentialsComplete:false,allComplete:false,shopifyStatus:'not_confirmed',shipment:null};
    const detail={stopName:'hummus fit huntington',orderName:'#TEST',orderId:'gid://shopify/Order/1',workflow:'essentials',pickedBy:'Staff',pickers:['Staff'],
      lineItems:[{title:'GHOST',sku:'GHOST',quantity:1}],itemStatus:{0:'not_picked'},itemScannedCount:{0:0},itemNotes:{},itemPickedQty:{},caseBackorders:{},completion};
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url()),body=route.request().postDataJSON();
      const reply=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      if(url.pathname==='/picking')return route.fulfill({contentType:'text/html',body:fs.readFileSync(path.join(__dirname,'../public/picking.html'),'utf8')});
      if(url.pathname.startsWith('/api/picking-order/'))return reply(detail);
      if(url.pathname==='/api/picking-case-backorder'){
        assert.equal(body.orderId,detail.orderId);assert.equal(body.scanned,0);assert.equal(body.confirmBackorder,true);
        detail.caseBackorders[0]={backordered:1};detail.itemStatus[0]='missing';detail.itemPickedQty[0]=0;return reply({ok:true});
      }
      if(url.pathname==='/api/picking-finish'){
        finishes++;assert.equal(body.orderId,detail.orderId);
        detail.completedAt='2026-10-17T14:00:00Z';detail.completedBy='Staff';completion.essentialsComplete=true;completion.allComplete=true;
        completion.shopifyStatus='needs_review';completion.shipment={status:'needs_review',error:'Shopify response uncertain. Retry checks proof only.'};
        await new Promise(resolve=>setTimeout(resolve,100));
        return reply({ok:true,completedAt:detail.completedAt,completedBy:'Staff',completion,fulfillment:[{ok:false}]});
      }
      if(url.pathname==='/api/picking-retry-completion'){
        retries++;assert.equal(body.orderId,detail.orderId);
        completion.shopifyStatus='fulfilled_with_backorder';completion.shipment={status:'fulfilled_with_backorder'};
        await new Promise(resolve=>setTimeout(resolve,100));return reply({ok:true,shipment:completion.shipment});
      }
      return reply({available:false});
    });
    page.on('dialog',d=>d.accept());
    await page.goto('http://completion.test/picking?workflow=essentials&stop=hummus%20fit%20huntington');
    await page.locator('[data-backorder-idx="0"]').waitFor();
    assert.equal(await page.locator('#finishBtn').isDisabled(),true);
    await page.locator('[data-backorder-idx="0"]').click();
    await page.getByText('Backordered — no cases ship',{exact:true}).waitFor();
    assert.equal(await page.locator('#finishBtn').isDisabled(),false);
    await page.locator('#finishBtn').click();await page.locator('#modalConfirmBtn').click();
    await page.locator('#retryCompletionBtn').waitFor();
    assert.equal(finishes,1);assert.equal(await page.locator('#restartOrderLink').count(),0);
    await page.reload();await page.locator('#retryCompletionBtn').waitFor();assert.equal(finishes,1);
    await page.locator('#retryCompletionBtn').click();
    await page.getByText('Delivered quantities fulfilled — backorder remains',{exact:true}).waitFor();
    assert.equal(retries,1);assert.equal(finishes,1);
    console.log('PASS: missing-case confirmation, finish, reload recovery, clear partial status, locked restart, proof-only retry. No live requests.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
