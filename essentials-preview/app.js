const previewOrders = [
  { id:'ES-1042', store:'Lynbrook', route:'Route #2 · Mon Oct 5', type:'retail', cases:4, stage:'new', progress:0, action:'Start Picking' },
  { id:'ES-1047', store:'Huntington', route:'Route #3 · Mon Oct 5', type:'other', cases:3, stage:'new', progress:0, action:'Start Picking' },
  { id:'ES-1038', store:'Farmingdale', route:'Route #3 · Mon Oct 5', type:'retail', cases:6, stage:'picking', progress:67, action:'Continue Picking' },
  { id:'ES-1040', store:'Brookfield', route:'Monday · Van 1', type:'retail', cases:5, stage:'picking', progress:80, action:'Resolve Exception', exception:'Expected 5 cases · only 4 scanned' },
  { id:'ES-1035', store:'Deer Park', route:'Route #1 · Mon Oct 5', type:'other', cases:2, stage:'labeled', progress:100, action:'Preview 3×1 Label' },
  { id:'ES-1032', store:'Lake Grove', route:'Route #5 · Mon Oct 5', type:'retail', cases:4, stage:'ready', progress:100, action:'View Route' },
  { id:'ES-1033', store:'Woodbury', route:'Route #3 · Mon Oct 5', type:'other', cases:2, stage:'ready', progress:100, action:'View Route' },
];

let activeFilter = 'all';
const stageNames = ['new','picking','labeled','ready'];
const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));

function card(order){
  const typeName = order.type === 'retail' ? 'Retail Essentials' : 'Other Essentials';
  const secondary = order.stage === 'labeled' ? '<button class="secondary" data-label="' + escapeHtml(order.id) + '">Reprint 3×1 Label</button>' : '';
  return '<article class="order-card' + (order.exception ? ' exception' : '') + '" data-order="' + escapeHtml(order.id) + '">' +
    '<div class="card-top"><span class="type-pill ' + (order.type === 'other' ? 'other' : '') + '">' + typeName + '</span><span class="order-id">' + escapeHtml(order.id) + '</span></div>' +
    '<h3>' + escapeHtml(order.store) + '</h3><p class="route-line">' + escapeHtml(order.route) + '</p>' +
    '<div class="case-count"><strong>' + order.cases + '</strong><span>cases</span></div>' +
    (order.progress ? '<div class="progress" aria-label="' + order.progress + '% complete"><i style="width:' + order.progress + '%"></i></div>' : '') +
    (order.exception ? '<p class="exception-note"><span>!</span><span>' + escapeHtml(order.exception) + '</span></p>' : '') +
    '<div class="card-actions"><button class="primary" data-action="' + escapeHtml(order.id) + '">' + escapeHtml(order.action) + '</button>' + secondary + '</div></article>';
}

function render(){
  const query = document.getElementById('searchInput').value.trim().toLowerCase();
  const visible = previewOrders.filter(order => (activeFilter === 'all' || order.type === activeFilter) && (!query || (order.store + ' ' + order.id).toLowerCase().includes(query)));
  stageNames.forEach(stage => {
    const orders = visible.filter(order => order.stage === stage);
    document.getElementById('stage-' + stage).innerHTML = orders.length ? orders.map(card).join('') : '<div class="empty-state">No matching Essentials orders</div>';
    document.querySelector('[data-stage="' + stage + '"] header>b').textContent = orders.length;
  });
  document.querySelectorAll('[data-label]').forEach(button => button.addEventListener('click', () => openLabel(button.dataset.label)));
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => handleAction(button.dataset.action)));
}

function openLabel(id){
  const order = previewOrders.find(item => item.id === id);
  if(!order) return;
  document.getElementById('labelStore').textContent = order.store.toUpperCase();
  document.getElementById('labelOrder').textContent = order.id;
  document.getElementById('labelCases').textContent = order.cases + ' CASES';
  document.getElementById('labelTitle').textContent = order.type === 'retail' ? 'Retail Essentials' : 'Other Essentials';
  document.getElementById('labelModal').hidden = false;
}

function handleAction(id){
  const order = previewOrders.find(item => item.id === id);
  if(!order) return;
  if(order.stage === 'labeled'){ openLabel(id); return; }
  showToast('Preview only — no order, route, scan, or printer state changed.');
}

function showToast(message){
  const toast = document.getElementById('toast');
  toast.textContent = message; toast.classList.add('show');
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 2800);
}

document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
  activeFilter = button.dataset.filter;
  document.querySelectorAll('.filter').forEach(item => item.classList.toggle('active', item === button));
  render();
}));
document.getElementById('searchInput').addEventListener('input', render);
document.getElementById('closeModal').addEventListener('click', () => { document.getElementById('labelModal').hidden = true; });
document.getElementById('confirmPreview').addEventListener('click', () => { document.getElementById('labelModal').hidden = true; showToast('3×1 label layout noted for review. Nothing was printed.'); });
document.getElementById('labelModal').addEventListener('click', event => { if(event.target.id === 'labelModal') event.currentTarget.hidden = true; });
render();
