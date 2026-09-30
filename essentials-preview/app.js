let shadowCards = [];
let activeFilter = 'all';
let mutationsEnabled = false;
const stageNames = ['new', 'picking', 'labeled', 'ready'];
const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const displayStore = value => String(value || '').replace(/\b\w/g, letter => letter.toUpperCase());
const visibleItemsFor = entry => activeFilter === 'all' ? entry.items : entry.items.filter(item => item.type === activeFilter);

function card(entry){
  const visibleItems = visibleItemsFor(entry);
  const displayedQuantity = visibleItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const orderNames = String(entry.regularOrderName || '').split(',').map(value => value.trim()).filter(Boolean);
  const orderLabel = orderNames.length > 1 ? orderNames[orderNames.length - 1] + ' + ' + (orderNames.length - 1) + ' more' : (orderNames[0] || '');
  const hasRetail = visibleItems.some(item => item.type === 'retail');
  const hasOther = visibleItems.some(item => item.type === 'other');
  const typeName = hasRetail && hasOther ? 'Retail + Other Essentials' : hasRetail ? 'Retail Essentials' : 'Other Essentials';
  const items = visibleItems.map(item => '<li><b>' + escapeHtml(item.quantity) + '</b><span>' + escapeHtml(item.title) + '</span><small>' + (item.type === 'retail' ? 'Retail' : 'Other') + '</small></li>').join('');
  const workflowAction = mutationsEnabled
    ? '<button class="primary" data-pick="' + escapeHtml(entry.stopKey) + '">Open Essentials picking</button>'
    : '<button class="primary shadow-action" disabled>Actions locked · Shadow mode</button>';
  const previewAction = mutationsEnabled ? '' : '<button class="secondary" data-label="' + escapeHtml(entry.id) + '">Preview 3×1 Label</button>';
  return '<article class="order-card' + (entry.hasException ? ' exception' : '') + '">' +
    '<div class="card-top"><span class="type-pill ' + (!hasRetail ? 'other' : '') + '">' + typeName + '</span><span class="order-id">' + escapeHtml(orderLabel) + '</span></div>' +
    '<h3>' + escapeHtml(displayStore(entry.store)) + '</h3><p class="route-line">' + escapeHtml(entry.routeName || 'Regular route') + '</p>' +
    '<div class="case-count"><strong>' + escapeHtml(displayedQuantity) + '</strong><span>' + (mutationsEnabled ? 'total cases' : (activeFilter === 'all' ? 'combined ordered qty' : 'filtered ordered qty')) + '</span></div><ul class="item-list">' + items + '</ul>' +
    (entry.progress ? '<div class="progress" aria-label="' + entry.progress + '% reflected from regular picking"><i style="width:' + entry.progress + '%"></i></div>' : '') +
    (entry.hasException ? '<p class="exception-note"><span>!</span><span>Missing or partial on the regular order. Resolve it in Order Picking.</span></p>' : '') +
    '<div class="card-actions">' + previewAction + workflowAction + '</div></article>';
}

function updateSummary(){
  const retail = shadowCards.filter(card => card.items.some(item => item.type === 'retail')).length;
  const other = shadowCards.filter(card => card.items.some(item => item.type === 'other')).length;
  const filteredCards = activeFilter === 'all' ? shadowCards : shadowCards.filter(card => card.items.some(item => item.type === activeFilter));
  const filteredQuantity = filteredCards.reduce((sum, card) => sum + visibleItemsFor(card).reduce((itemSum, item) => itemSum + Number(item.quantity || 0), 0), 0);
  document.getElementById('allCount').textContent = shadowCards.length;
  document.getElementById('retailCount').textContent = retail;
  document.getElementById('otherCount').textContent = other;
  document.getElementById('groupCount').textContent = filteredCards.length;
  document.getElementById('caseCount').textContent = filteredQuantity;
  document.getElementById('readyCount').textContent = filteredCards.filter(card => card.stage === 'ready').reduce((sum, card) => sum + visibleItemsFor(card).reduce((itemSum, item) => itemSum + Number(item.quantity || 0), 0), 0);
  document.getElementById('exceptionCount').textContent = filteredCards.filter(card => card.hasException).length;
}

function render(){
  const query = document.getElementById('searchInput').value.trim().toLowerCase();
  const visible = shadowCards.filter(card => (activeFilter === 'all' || card.items.some(item => item.type === activeFilter)) && (!query || (card.store + ' ' + card.regularOrderName).toLowerCase().includes(query)));
  stageNames.forEach(stage => {
    const entries = visible.filter(card => card.stage === stage);
    document.getElementById('stage-' + stage).innerHTML = entries.length ? entries.map(card).join('') : '<div class="empty-state">No matching Essentials lines</div>';
    document.querySelector('[data-stage="' + stage + '"] header>b').textContent = entries.length;
  });
  document.querySelectorAll('[data-label]').forEach(button => button.addEventListener('click', () => openLabel(button.dataset.label)));
  document.querySelectorAll('[data-pick]').forEach(button => button.addEventListener('click', () => {
    location.href = '/picking?workflow=essentials&stop=' + encodeURIComponent(button.dataset.pick);
  }));
}

function openLabel(id){
  const entry = shadowCards.find(card => card.id === id);
  if(!entry) return;
  const visibleItems = visibleItemsFor(entry);
  const displayedQuantity = visibleItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  document.getElementById('labelStore').textContent = displayStore(entry.store).toUpperCase();
  document.getElementById('labelOrder').textContent = entry.regularOrderName || 'REGULAR ORDER';
  document.getElementById('labelCases').textContent = displayedQuantity + ' ORDERED';
  document.getElementById('labelTitle').textContent = activeFilter === 'retail' ? 'Retail Essentials' : activeFilter === 'other' ? 'Other Essentials' : 'Combined Essentials';
  document.getElementById('labelModal').hidden = false;
}

function showError(message){
  const loading = document.getElementById('loadingState');
  loading.classList.add('error'); loading.textContent = message;
}

async function loadShadowQueue(){
  try{
    const response = await fetch('/api/essentials-shadow', { cache:'no-store', credentials:'same-origin' });
    const result = await response.json();
    if(!response.ok || result.error) throw new Error(result.error || 'Could not load Essentials shadow view.');
    if(!['shadow', 'operational'].includes(result.mode)) throw new Error('Essentials mode safety check failed.');
    mutationsEnabled = result.mode === 'operational' && result.mutationsEnabled === true;
    shadowCards = Array.isArray(result.cards) ? result.cards : [];
    if(mutationsEnabled){
      document.body.classList.add('operational');
      document.title = 'Hummus Fit Essentials — Live Picking';
      document.getElementById('modePill').textContent = 'Live';
      document.getElementById('essentialsNavMode').textContent = 'Live';
      document.getElementById('operatingMode').textContent = 'Live picking';
      document.getElementById('groupSource').textContent = 'Active Shopify orders';
      document.getElementById('separationTitle').textContent = 'Essentials are separated from food picking.';
      document.getElementById('separationDetail').textContent = 'Shopify fulfillment waits until both Food Picking and Essentials Picking are complete.';
      document.getElementById('labelPreviewNote').textContent = 'This is a visual preview only. Use + Label One Case in Essentials Picking to print the real 3×1 case label.';
    }
    updateSummary(); render();
    document.getElementById('loadingState').hidden = true;
    document.getElementById('board').hidden = false;
    document.getElementById('lastUpdated').textContent = 'Updated ' + new Date(result.generatedAt).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' });
  }catch(error){
    console.warn('Essentials shadow view unavailable:', error.message);
    showError('Regular-order data is unavailable in this isolated local preview. No operational state was changed.');
  }
}

document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
  activeFilter = button.dataset.filter;
  document.querySelectorAll('.filter').forEach(item => item.classList.toggle('active', item === button)); render();
  updateSummary();
}));
document.getElementById('searchInput').addEventListener('input', render);
document.getElementById('closeModal').addEventListener('click', () => { document.getElementById('labelModal').hidden = true; });
document.getElementById('confirmPreview').addEventListener('click', () => { document.getElementById('labelModal').hidden = true; });
document.getElementById('labelModal').addEventListener('click', event => { if(event.target.id === 'labelModal') event.currentTarget.hidden = true; });
loadShadowQueue();
