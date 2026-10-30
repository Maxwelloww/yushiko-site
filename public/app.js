const $ = (s, root=document) => root.querySelector(s);
const esc = (value='') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateLabel = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? 'Дата уточняется' : d.toLocaleDateString('ru-RU',{day:'2-digit',month:'short',year:'numeric'}); };

$('#year').textContent = new Date().getFullYear();
const menuToggle = $('#menuToggle'), nav = $('#mainNav');
menuToggle?.addEventListener('click', () => { const open = nav.classList.toggle('open'); menuToggle.setAttribute('aria-expanded', String(open)); });
nav?.querySelectorAll('a').forEach(a => a.addEventListener('click', () => { nav.classList.remove('open'); menuToggle?.setAttribute('aria-expanded','false'); }));

async function loadPublic() {
  try {
    const res = await fetch('/api/public');
    if (!res.ok) throw new Error('API unavailable');
    const data = await res.json();
    if (data.inviteUrl) $('#joinButton').href = data.inviteUrl;
    if (data.discord?.online !== null && data.discord?.online !== undefined) $('#onlineCount').textContent = Number(data.discord.online).toLocaleString('ru-RU');
    const eventList = $('#eventList');
    if (!data.events?.length) eventList.innerHTML = '<div class="empty-state">Пока нет запланированных событий. Следи за новостями!</div>';
    else eventList.innerHTML = data.events.map(e => `<article class="content-row fade-in"><div class="content-date"><strong>${esc(new Date(e.event_date).toLocaleDateString('ru-RU',{day:'2-digit'}))}</strong>${esc(new Date(e.event_date).toLocaleDateString('ru-RU',{month:'short'}))}</div><div><h3>${esc(e.title)}</h3><p>${esc(e.description)}</p><small class="muted">${Number(e.attendees||0)} участников записались</small></div><div class="event-actions"><span class="content-tag">${esc(e.location || 'Discord')}</span><button class="small-button rsvp-button" data-rsvp="${e.id}">Записаться</button></div></article>`).join('');
    const newsList = $('#newsList');
    renderGallery(data.gallery || []);
    renderCompany(data.company || []);
    if (!data.news?.length) newsList.innerHTML = '<div class="empty-state">Новостей пока нет.</div>';
    else newsList.innerHTML = data.news.map(n => `<article class="news-card fade-in"><time>${esc(dateLabel(n.created_at))}</time><h3>${esc(n.title)}</h3><p>${esc(n.body)}</p></article>`).join('');
  } catch {
    $('#eventList').innerHTML = '<div class="empty-state">Не удалось загрузить события. Попробуй обновить страницу.</div>';
    $('#newsList').innerHTML = '<div class="empty-state">Не удалось загрузить новости.</div>';
  }
}
loadPublic();

$('#applicationForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget, message = $('#formMessage'), button = form.querySelector('button[type=submit]');
  button.disabled = true; message.textContent = 'Отправляем…';
  const payload = Object.fromEntries(new FormData(form).entries());
  try {
    const res = await fetch('/api/applications', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Не удалось отправить заявку.');
    form.reset(); message.textContent = data.message || 'Заявка отправлена!';
  } catch (e) { message.textContent = e.message || 'Ошибка сети. Попробуй ещё раз.'; }
  finally { button.disabled = false; }
});


let csrfToken='';
async function getSession(){try{const r=await fetch('/api/me');const d=await r.json();csrfToken=d.csrfToken||'';return d.user;}catch{return null;}}
function renderGallery(items){const box=$('#galleryList');if(!box)return;box.innerHTML=items.length?items.map(x=>`<article class="gallery-card fade-in"><img src="${esc(x.image_url)}" alt="${esc(x.title)}" loading="lazy" referrerpolicy="no-referrer"><div class="gallery-card-copy"><h3>${esc(x.title)}</h3><p>${esc(x.description||'Работа участника сообщества')}</p><small>${esc(x.username)} · ${esc(dateLabel(x.created_at))}</small></div></article>`).join(''):'<div class="empty-state">Галерея только начинает расцветать. Стань первым автором!</div>';}
async function loadProfile(){const box=$('#profileArea');if(!box)return;const user=await getSession();if(!user){box.innerHTML='<p class="muted">Войди через Discord, чтобы настроить свой профиль и увидеть достижения.</p>';return;}try{const r=await fetch('/api/profile');if(!r.ok)throw new Error();const d=await r.json();box.innerHTML=`<div class="profile-card"><div class="profile-avatar">✿</div><div class="profile-main"><p class="eyebrow">${esc(d.profile.title)}</p><h3>${esc(d.profile.username)}</h3><p>${esc(d.profile.bio||'История этого участника ещё не написана.')}</p><form id="profileForm" class="profile-form"><label>Твой титул<input name="title" maxlength="40" value="${esc(d.profile.title)}" required></label><label>О себе<textarea name="bio" maxlength="240" rows="3" placeholder="До 240 символов">${esc(d.profile.bio)}</textarea></label><button class="button button-light">Сохранить профиль</button><p id="profileMessage" class="form-message" role="status"></p></form></div></div><div class="achievement-list"><h3>Достижения</h3>${d.achievements.length?d.achievements.map(a=>`<article class="achievement"><span>${esc(a.icon)}</span><div><strong>${esc(a.title)}</strong><p>${esc(a.description)}</p></div></article>`).join(''):'<p class="muted">Достижения появятся по мере участия в жизни сообщества.</p>'}</div>`;$('#profileForm').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;const msg=$('#profileMessage');try{const res=await fetch('/api/profile',{method:'PUT',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify(Object.fromEntries(new FormData(f)))});const j=await res.json();if(!res.ok)throw new Error(j.error||'Не удалось сохранить');msg.textContent='Профиль сохранён.';await loadProfile();}catch(err){msg.textContent=err.message;}});}catch{box.innerHTML='<p class="muted">Не удалось загрузить профиль. Попробуй обновить страницу.</p>';}}
loadProfile();
document.addEventListener('click',async e=>{const b=e.target.closest('[data-rsvp]');if(!b)return;const user=await getSession();if(!user){location.href='/auth/discord';return;}b.disabled=true;try{const r=await fetch(`/api/events/${b.dataset.rsvp}/rsvp`,{method:'POST',headers:{'X-CSRF-Token':csrfToken}});const d=await r.json();if(!r.ok)throw new Error(d.error||'Не удалось записаться');b.textContent='Ты записан ✓';b.classList.add('is-done');}catch(err){b.textContent=err.message;}finally{b.disabled=false;}});
$('#galleryForm')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;const msg=$('#galleryMessage');try{const user=await getSession();if(!user){location.href='/auth/discord';return;}const r=await fetch('/api/gallery',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify(Object.fromEntries(new FormData(f)))});const d=await r.json();if(!r.ok)throw new Error(d.error||'Не удалось отправить работу');f.reset();msg.textContent=d.message||'Отправлено на модерацию.';}catch(err){msg.textContent=err.message;}});


function renderCompany(posts){const box=$('#companyList');if(!box)return;box.innerHTML=posts.length?posts.map(p=>`<article class="company-card"><div class="company-card-top"><span class="company-status">● ОТКРЫТ</span><small>${esc(dateLabel(p.created_at))}</small></div><h3>${esc(p.activity)}</h3><p class="company-game">${esc(p.game||'Тема не указана')}</p><p>${esc(p.details||'Автор открыт к предложениям.')}</p><div class="company-card-bottom"><small>${esc(p.username)} · ${Number(p.responses||0)} откликов</small><button class="small-button" data-company-respond="${p.id}" ${p.responded?'disabled':''}>${p.responded?'Отклик отправлен':'Откликнуться'}</button></div></article>`).join(''):'<div class="empty-state">Пока никто не ищет компанию. Создай первый запрос!</div>';}
$('#companyForm')?.addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,msg=$('#companyMessage');const user=await getSession();if(!user){location.href='/auth/discord';return;}const b=f.querySelector('button[type=submit]');b.disabled=true;try{const r=await fetch('/api/company',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify(Object.fromEntries(new FormData(f)))});const d=await r.json();if(!r.ok)throw new Error(d.error||'Не удалось создать запрос');f.reset();msg.textContent='Запрос опубликован на 12 часов.';await loadPublic();}catch(err){msg.textContent=err.message;}finally{b.disabled=false;}});
document.addEventListener('click',async e=>{const b=e.target.closest('[data-company-respond]');if(!b)return;const user=await getSession();if(!user){location.href='/auth/discord';return;}b.disabled=true;try{const r=await fetch(`/api/company/${b.dataset.companyRespond}/respond`,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify({message:''})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Не удалось откликнуться');b.textContent='Отклик отправлен';const msg=document.createElement('p');msg.className='muted';msg.textContent=d.message;b.closest('.company-card')?.append(msg);}catch(err){b.disabled=false;b.textContent=err.message;}});
