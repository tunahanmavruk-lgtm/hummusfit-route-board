let shadowCards = [];
let activeFilter = 'all';
const stageNames = ['new', 'picking', 'labeled', 'ready'];
const escapeHtml = value => String(value == null ? '' : value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const displayStore = value => String(value || '').replace(/\b\w/g, letter => letter.toUpperCase());

function card(entry){
  const typeName = entry.type === 'retail' ? 'Retail Essentials' : 'Other Essentials';
  const items = entry.items.map(item => '<li><b>' + escapeHtml(item.quantity) + '</b><span>' + escapeHtml(item.title) + '</span></li>').join('');
  return '<article class="order-card' + (entry.hasException ? ' exception' : '') + '">' +
    '<div class="card-top"><span class="type-pill ' + (entry.type === 'other' ? 'other' : '') + '">' + typeName + '</span><span class="order-id">' + escapeHtml(entry.regularOrderName) + '</span></div>' +
    '<h3>' + escapeHtml(displayStore(entry.store)) + '</h3><p class="route-line">' + escapeHtml(entry.routeName || 'Regular route') + '</p>' +
    '<div class="case-count"><strong>' + escapeHtml(entry.caseCount) + '</strong><span>ordered qty</span></div><ul class="item-list">' + items + '</ul>' +
    (entry.progress ? '<div class="progress" aria-label="' + entry.progress + '% reflected from regular picking"><i style="width:' + entry.progress + '%"></i></div>' : '') +
    (entry.hasException ? '<p class="exception-note"><span>!</span><span>Missing or partial on the regular order. Resolve it in Order Picking.</span></p>' : '') +
    '<div class="card-actions"><button class="secondary" data-label="' + escapeHtml(entry.id) + '">Preview 3×1 Label</button><button class="primary shadow-action" disabled>Actions locked · Shadow mode</button></div></article>';
}

function updateSummary(){
  const retail = shadowCards.filter(card => card.type === 'retail').length;
  const other = shadowCards.filter(card => card.type === 'other').length;
  document.getElementById('allCount').textContent = shadowCards.length;
  document.getElementById('retailCount').textContent = retail;
  document.getElementById('otherCount').textContent = other;
  document.getElementById('groupCount').textContent = shadowCards.length;
  document.getElementById('caseCount').textContent = shadowCards.reduce((sum, card) => sum + Number(card.caseCount || 0), 0);
  document.getElementById('readyCount').textContent = shadowCards.filter(card => card.stage === 'ready').reduce((sum, card) => sum + Number(card.caseCount || 0), 0);
  document.getElementById('exceptionCount').textContent = shadowCards.filter(card => card.hasException).length;
}

function render(){
  const query = document.getElementById('searchInput').value.trim().toLowerCase();
  const visible = shadowCards.filter(card => (activeFilter === 'all' || card.type === activeFilter) && (!query || (card.store + ' ' + card.regularOrderName).toLowerCase().includes(query)));
  stageNames.forEach(stage => {
    const entries = visible.filter(card => card.stage === stage);
    document.getElementById('stage-' + stage).innerHTML = entries.length ? entries.map(card).join('') : '<div class="empty-state">No matching Essentials lines</div>';
    document.querySelector('[data-stage="' + stage + '"] header>b').textContent = entries.length;
  });
  document.querySelectorAll('[data-label]').forEach(button => button.addEventListener('click', () => openLabel(button.dataset.label)));
}

function openLabel(id){
  const entry = shadowCards.find(card => card.id === id);
  if(!entry) return;
  document.getElementById('labelStore').textContent = displayStore(entry.store).toUpperCase();
  document.getElementById('labelOrder').textContent = entry.regularOrderName || 'REGULAR ORDER';
  document.getElementById('labelCases').textContent = entry.caseCount + ' ORDERED';
  document.getElementById('labelTitle').textContent = entry.type === 'retail' ? 'Retail Essentials' : 'Other Essentials';
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
    if(result.mode !== 'shadow' || result.mutationsEnabled !== false) throw new Error('Shadow-mode safety check failed.');
    shadowCards = Array.isArray(result.cards) ? result.cards : [];
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
}));
document.getElementById('searchInput').addEventListener('input', render);
document.getElementById('closeModal').addEventListener('click', () => { document.getElementById('labelModal').hidden = true; });
document.getElementById('confirmPreview').addEventListener('click', () => { document.getElementById('labelModal').hidden = true; });
document.getElementById('labelModal').addEventListener('click', event => { if(event.target.id === 'labelModal') event.currentTarget.hidden = true; });
loadShadowQueue();
