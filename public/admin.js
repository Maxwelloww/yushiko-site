const $ = (s, root=document) => root.querySelector(s);
const esc = (v='') => String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let csrfToken = '';
let currentTab = 'overview';
const notice = $('#notice');
function say(message, type='success') { notice.textContent = message; notice.className = `admin-notice ${type}`; }
async function api(url, options={}) {
  const headers = { ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.method && options.method !== 'GET' ? {'X-CSRF-Token':csrfToken} : {}), ...(options.headers||{}) };
  const res = await fetch(url, {...options, headers});
  const data = res.status === 204 ? {} : await res.json().catch(()=>({}));
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
  return data;
}
function table(rows, columns) {
  if (!rows.length) return '<div class="empty-admin">Записей пока нет.</div>';
  return `<table><thead><tr>${columns.map(c=>`<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${columns.map(c=>`<td>${esc(c.value(r) ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function showTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.side-link').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  ['overview','news','events','applications','tickets','logs','serverlogs','analytics','discord','gallery','security'].forEach(t => {
    const el = $(`#${t}Panel`);
    if (el) el.hidden = t !== tab;
  });
  const titles = {overview:'Обзор',news:'Новости',events:'События',applications:'Заявки',tickets:'Жалобы и тикеты',logs:'Журнал действий',serverlogs:'Логи сервера',security:'Безопасность',analytics:'Аналитика',discord:'Discord-бот',gallery:'Галерея сообщества'};
  $('#pageTitle').textContent = titles[tab] || 'Админ-панель';
  loadTab(tab).catch(e => say(e.message, 'error'));
}
async function loadSummary() {
  const d = await api('/api/admin/summary');
  $('#newsCount').textContent=d.news; $('#eventsCount').textContent=d.events; $('#newAppsCount').textContent=d.newApplications; $('#allAppsCount').textContent=d.totalApplications; $('#openTicketsCount').textContent=d.openTickets ?? 0;
  $('#recentLogs').innerHTML=table(d.logs.slice(0,8),[
    {label:'Время',value:r=>r.created_at},{label:'Пользователь',value:r=>r.actor_name},{label:'Действие',value:r=>r.action},{label:'Детали',value:r=>r.details}
  ]);
}
async function loadTab(tab) {
  if(tab==='overview') return loadSummary();
  if(tab==='news') return loadNews();
  if(tab==='events') return loadEvents();
  if(tab==='applications') return loadApplications();
  if(tab==='tickets') return loadTickets();
  if(tab==='serverlogs') return loadServerLogs();
  if(tab==='logs') return loadLogs();
  if(tab==='analytics') return loadAnalytics();
  if(tab==='discord') return loadDiscordStatus();
  if(tab==='gallery') return loadGallery();
}
async function loadNews() {
  const rows=await api('/api/admin/news');
  $('#newsAdminList').innerHTML=rows.length?rows.map(r=>`<article class="admin-item"><div><h3>${esc(r.title)}</h3><p>${esc(r.body)}</p><small>${esc(r.created_at)}</small></div><div class="item-actions"><button class="small-button" data-delete-news="${r.id}">Удалить</button></div></article>`).join(''):'<div class="empty-admin">Новостей пока нет.</div>';
}
async function loadEvents() {
  const rows=await api('/api/admin/events');
  $('#eventsAdminList').innerHTML=rows.length?rows.map(r=>`<article class="admin-item"><div><h3>${esc(r.title)} <span class="status-pill">${esc(r.status)}</span></h3><p>${esc(r.description)}</p><small>${esc(r.event_date)} · ${esc(r.location)}</small></div><div class="item-actions">${r.status!=='cancelled'?`<button class="small-button" data-cancel-event="${r.id}">Отменить</button>`:''}</div></article>`).join(''):'<div class="empty-admin">Событий пока нет.</div>';
}
async function loadApplications() {
  const rows=await api('/api/admin/applications');
  const statuses={new:'Новая',reviewing:'На рассмотрении',approved:'Одобрена',rejected:'Отклонена'};
  $('#applicationsList').innerHTML=rows.length?rows.map(r=>`<article class="admin-item"><div><h3>${esc(r.name)} · ${esc(r.role)}</h3><p>${esc(r.message)}</p><small>Discord: ${esc(r.discord_tag)} · ${esc(r.created_at)}</small><p style="margin-top:8px">Статус: ${esc(statuses[r.status]||r.status)}</p></div><div class="item-actions"><select aria-label="Статус заявки" data-app-status="${r.id}">${Object.entries(statuses).map(([v,l])=>`<option value="${v}" ${r.status===v?'selected':''}>${l}</option>`).join('')}</select><button class="small-button" data-save-app="${r.id}">Сохранить</button></div></article>`).join(''):'<div class="empty-admin">Новых заявок пока нет.</div>';
}
async function loadLogs() {
  const rows=await api('/api/admin/logs');
  $('#logsList').innerHTML=table(rows,[{label:'Время',value:r=>r.created_at},{label:'Пользователь',value:r=>r.actor_name},{label:'Действие',value:r=>r.action},{label:'Детали',value:r=>r.details},{label:'IP',value:r=>r.ip}]);
}
const ticketStatus={open:'Открыт',answered:'Есть ответ',closed:'Закрыт'};
const ticketCategory={support:'Поддержка',complaint:'Жалоба',report:'Сообщить о нарушении',other:'Другое'};
async function loadTickets(){
 const rows=await api('/api/admin/tickets');
 $('#ticketsList').innerHTML=rows.length?rows.map(r=>`<article class="admin-item ticket-admin-item"><div><h3>#${r.id} · ${esc(r.subject)} <span class="status-pill">${esc(ticketStatus[r.status]||r.status)}</span></h3><p>${esc(ticketCategory[r.category]||r.category)} · ${esc(r.username)} · ${esc(r.message_count)} сообщений</p><small>Создан: ${esc(r.created_at)} · Обновлён: ${esc(r.updated_at)} · Приоритет: ${esc(r.priority)}</small></div><div class="item-actions"><button class="small-button" data-open-ticket="${r.id}">Открыть чат</button></div></article>`).join(''):'<div class="empty-admin">Обращений пока нет.</div>';
}
async function openTicket(id){
 const d=await api(`/api/admin/tickets/${id}/messages`); const t=d.ticket; const box=$('#ticketConversation'); box.hidden=false;
 box.innerHTML=`<div class="panel-heading"><h3>#${t.id} · ${esc(t.subject)}</h3><button class="small-button" id="closeTicketView">Скрыть</button></div><div class="ticket-thread">${d.messages.map(m=>`<article class="ticket-message ${m.sender_role==='staff'?'staff':''}"><strong>${esc(m.sender_name)} · ${m.sender_role==='staff'?'Поддержка':'Пользователь'}</strong><p>${esc(m.body)}</p><small>${esc(m.created_at)}</small></article>`).join('')}</div><form id="ticketReplyForm" class="admin-form"><label>Ответ пользователю<textarea name="body" maxlength="3000" rows="3" required placeholder="Напишите ответ…"></textarea></label><div class="two-col ticket-controls"><label>Статус<select name="status"><option value="open" ${t.status==='open'?'selected':''}>Открыт</option><option value="answered" ${t.status==='answered'?'selected':''}>Есть ответ</option><option value="closed" ${t.status==='closed'?'selected':''}>Закрыт</option></select></label><label>Приоритет<select name="priority"><option value="low" ${t.priority==='low'?'selected':''}>Низкий</option><option value="normal" ${t.priority==='normal'?'selected':''}>Обычный</option><option value="high" ${t.priority==='high'?'selected':''}>Высокий</option></select></label></div><button class="button button-light">Отправить ответ</button><button type="button" class="small-button" id="saveTicketStatus">Сохранить статус</button></form>`;
 $('#closeTicketView').addEventListener('click',()=>{box.hidden=true});
 $('#ticketReplyForm').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;try{await api(`/api/admin/tickets/${id}/messages`,{method:'POST',body:JSON.stringify({body:f.elements.body.value})});await api(`/api/admin/tickets/${id}`,{method:'PATCH',body:JSON.stringify({status:f.elements.status.value,priority:f.elements.priority.value})});say('Ответ отправлен.');await openTicket(id);await loadTickets();await loadSummary()}catch(err){say(err.message,'error')}});
 $('#saveTicketStatus').addEventListener('click',async()=>{const f=$('#ticketReplyForm');try{await api(`/api/admin/tickets/${id}`,{method:'PATCH',body:JSON.stringify({status:f.elements.status.value,priority:f.elements.priority.value})});say('Статус тикета обновлён.');await loadTickets();await openTicket(id)}catch(err){say(err.message,'error')}});
}
async function loadAnalytics(){
 const d=await api('/api/admin/analytics');
 const total=a=>a.reduce((n,x)=>n+Number(x.count||0),0);
 $('#analyticsSummary').innerHTML=`<article class="stat-card"><span>Запросы за 14 дней</span><strong>${total(d.daily)}</strong></article><article class="stat-card"><span>Записи на события</span><strong>${d.eventRsvps}</strong></article><article class="stat-card"><span>Тикеты</span><strong>${total(d.tickets)}</strong></article><article class="stat-card"><span>Работы в галерее</span><strong>${total(d.gallery)}</strong></article>`;
 $('#analyticsList').innerHTML='<h3>Запросы по дням</h3>'+table(d.daily,[{label:'Дата',value:r=>r.day},{label:'Запросы',value:r=>r.count}])+'<h3>Статусы обращений</h3>'+table(d.tickets,[{label:'Статус',value:r=>r.status},{label:'Количество',value:r=>r.count}])+'<h3>Статусы заявок</h3>'+table(d.applications,[{label:'Статус',value:r=>r.status},{label:'Количество',value:r=>r.count}]);
}
async function loadDiscordStatus(){const d=await api('/api/admin/discord-status');$('#discordStatus').innerHTML=d.ok?`<p><strong>Статус:</strong> Подключено</p><p><strong>Сервер:</strong> ${esc(d.guild)}</p><p><strong>Участники:</strong> ${esc(d.members??'—')}</p><p><strong>Онлайн:</strong> ${esc(d.online??'—')}</p>`:`<p><strong>Статус:</strong> ${d.configured?'Ошибка подключения':'Не настроено'}</p><p>${esc(d.message)}</p>`;}
async function loadGallery(){const rows=await api('/api/admin/gallery');const status={pending:'На модерации',approved:'Опубликовано',rejected:'Отклонено'};$('#galleryAdminList').innerHTML=rows.length?rows.map(r=>`<article class="admin-item gallery-admin-item"><img src="${esc(r.image_url)}" alt="" loading="lazy"><div><h3>${esc(r.title)}</h3><p>${esc(r.description)}</p><small>${esc(r.username)} · ${esc(r.created_at)} · ${esc(status[r.status]||r.status)}</small></div><div class="item-actions"><button class="small-button" data-gallery-status="approved" data-gallery-id="${r.id}">Одобрить</button><button class="small-button" data-gallery-status="rejected" data-gallery-id="${r.id}">Отклонить</button></div></article>`).join(''):'<div class="empty-admin">Работ пока нет.</div>';}
async function loadServerLogs(){const rows=await api('/api/admin/system-logs');$('#serverLogsList').innerHTML=table(rows,[{label:'Время',value:r=>r.created_at},{label:'Уровень',value:r=>r.level},{label:'Запрос',value:r=>`${r.method} ${r.path}`},{label:'Код',value:r=>r.status},{label:'Время, мс',value:r=>r.duration_ms},{label:'IP',value:r=>r.ip},{label:'Пользователь',value:r=>r.user_id},{label:'Детали',value:r=>r.message}]);}
document.addEventListener('click',e=>{const b=e.target.closest('[data-open-ticket]');if(b)openTicket(Number(b.dataset.openTicket)).catch(err=>say(err.message,'error'))});
document.querySelectorAll('.side-link').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
document.querySelectorAll('[data-goto]').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.goto)));
$('#newsForm').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;try{await api('/api/admin/news',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(f)))});f.reset();say('Новость опубликована.');await loadNews();await loadSummary()}catch(err){say(err.message,'error')}});
$('#eventForm').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;const b=Object.fromEntries(new FormData(f));b.event_date=new Date(b.event_date).toISOString();try{await api('/api/admin/events',{method:'POST',body:JSON.stringify(b)});f.reset();f.elements.location.value='Discord';say('Событие создано.');await loadEvents();await loadSummary()}catch(err){say(err.message,'error')}});
document.addEventListener('click',async e=>{
 const del=e.target.closest('[data-delete-news]'); const cancel=e.target.closest('[data-cancel-event]'); const save=e.target.closest('[data-save-app]'); const gallery=e.target.closest('[data-gallery-status]');
 try {
  if(del){await api(`/api/admin/news/${del.dataset.deleteNews}`,{method:'DELETE'});say('Новость удалена.');await loadNews();await loadSummary()}
  if(cancel){await api(`/api/admin/events/${cancel.dataset.cancelEvent}`,{method:'DELETE'});say('Событие отменено.');await loadEvents();await loadSummary()}
  if(save){const id=save.dataset.saveApp;const status=$(`[data-app-status="${id}"]`).value;await api(`/api/admin/applications/${id}`,{method:'PATCH',body:JSON.stringify({status})});say('Статус заявки обновлён.');await loadApplications();await loadSummary()}
  if(gallery){await api(`/api/admin/gallery/${gallery.dataset.galleryId}`,{method:'PATCH',body:JSON.stringify({status:gallery.dataset.galleryStatus})});say('Статус работы обновлён.');await loadGallery();}
 } catch(err){say(err.message,'error')}
});
$('#backupButton').addEventListener('click',async()=>{
 try { const res=await fetch('/api/admin/backup',{method:'GET',headers:{'X-CSRF-Token':csrfToken}}); if(!res.ok){const d=await res.json().catch(()=>({}));throw new Error(d.error||'Не удалось создать копию')} const blob=await res.blob();const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`yushiko-backup-${new Date().toISOString().slice(0,10)}.sqlite`;a.click();URL.revokeObjectURL(a.href);say('Резервная копия скачана.'); }catch(err){say(err.message,'error')}
});
$('#refreshAnalytics')?.addEventListener('click',()=>loadAnalytics().catch(e=>say(e.message,'error')));
$('#logoutButton').addEventListener('click',async()=>{try{await api('/auth/logout',{method:'POST'});location.href='/'}catch(e){say(e.message,'error')}});
async function init(){
 try {
  const me=await fetch('/api/me').then(r=>r.json());csrfToken=me.csrfToken||'';
  if(!me.user){$('#loginPanel').hidden=false;$('#dashboard').hidden=true;$('#adminIdentity').textContent='Гость';return}
  if(!me.user.isAdmin){$('#loginPanel').hidden=false;$('#dashboard').hidden=true;$('#adminIdentity').textContent=me.user.username;$('#loginPanel h1').textContent='Нет доступа';$('#loginPanel p:not(.eyebrow)').textContent='Ты вошёл через Discord, но твой ID не добавлен в список администраторов.';return}
  $('#loginPanel').hidden=true;$('#dashboard').hidden=false;$('#logoutButton').hidden=false;$('#adminIdentity').textContent=`Администратор: ${me.user.username}`;await showTab('overview');
 } catch(e){$('#loginPanel').hidden=false;$('#dashboard').hidden=true;say('Не удалось проверить вход. Запусти сервер и обнови страницу.','error')}
}
init();
