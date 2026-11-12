const $ = (s, root=document) => root.querySelector(s);
const esc = (value='') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateLabel = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? 'Дата уточняется' : d.toLocaleDateString('ru-RU',{day:'2-digit',month:'short',year:'numeric'}); };

$('#year').textContent = new Date().getFullYear();
const menuToggle = $('#menuToggle'), nav = $('#mainNav');
menuToggle?.addEventListener('click', () => { const open = nav.classList.toggle('open'); menuToggle.setAttribute('aria-expanded', String(open)); });
nav?.querySelectorAll('a').forEach(a => a.addEventListener('click', () => { nav.classList.remove('open'); menuToggle?.setAttribute('aria-expanded','false'); }));

if ('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const revealObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      entry.target.classList.add('is-visible');
      revealObserver.unobserve(entry.target);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -28px 0px' });
  document.querySelectorAll('main > section:not(.hero), .promise-strip, .team-section').forEach(element => {
    element.classList.add('reveal-on-scroll');
    revealObserver.observe(element);
  });
}

async function loadPublic() {
  try {
    const res = await fetch('/api/public');
    if (!res.ok) throw new Error('API unavailable');
    const data = await res.json();
    if (data.inviteUrl) $('#joinButton').href = data.inviteUrl;
    if (data.discord?.guild) $('#guildName').textContent = data.discord.guild;
    if (data.discord?.members !== null && data.discord?.members !== undefined) $('#memberCount').textContent = Number(data.discord.members).toLocaleString('ru-RU');
    if (data.discord?.online !== null && data.discord?.online !== undefined) $('#onlineCount').textContent = Number(data.discord.online).toLocaleString('ru-RU');
    const eventList = $('#eventList');
    if (!data.events?.length) eventList.innerHTML = '<div class="empty-state">Пока нет запланированных событий. Следи за новостями!</div>';
    else eventList.innerHTML = data.events.map(e => { const date=new Date(e.event_date), past=date.getTime()<Date.now(), attending=Boolean(e.attending); return `<article class="content-row fade-in"><div class="content-date"><strong>${esc(date.toLocaleDateString('ru-RU',{day:'2-digit'}))}</strong>${esc(date.toLocaleDateString('ru-RU',{month:'short'}))}</div><div><h3>${esc(e.title)}</h3><p>${esc(e.description)}</p><small class="muted">${Number(e.attendees||0)} записались</small></div><div class="event-actions"><span class="content-tag">${esc(e.location || 'Discord')}</span><button class="small-button rsvp-button" data-rsvp="${e.id}" data-attending="${attending}" ${past?'disabled':''}>${past?'Завершено':attending?'Отменить запись':'Записаться'}</button></div></article>`; }).join('');
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
function discordAvatarUrl(user,size=160){if(!user?.avatar)return '';const format=String(user.avatar).startsWith('a_')?'gif':'png';return `https://cdn.discordapp.com/avatars/${encodeURIComponent(user.id)}/${encodeURIComponent(user.avatar)}.${format}?size=${size}`;}
function renderAccountState(user){const signedIn=Boolean(user);const login=$('#discordLogin'),profileLogin=$('#profileLogin'),headerAccount=$('#headerAccount'),adminShortcut=$('#adminShortcut');if(login)login.hidden=signedIn;if(profileLogin)profileLogin.hidden=signedIn;if(headerAccount)headerAccount.hidden=!signedIn;if(adminShortcut)adminShortcut.hidden=!user?.isAdmin;const intro=$('#profileIntro');if(intro)intro.textContent=signedIn?`Рады видеть тебя, ${user.username}. Здесь твой профиль и достижения Miteria.`:'Войди через Discord, чтобы настроить профиль и увидеть достижения.';if(!signedIn)return;const name=$('#headerAccountName');if(name)name.textContent=user.username||'Участник';const avatar=$('#headerAccountAvatar');if(avatar){avatar.textContent=(user.username||'✿').trim().charAt(0).toUpperCase()||'✿';const url=discordAvatarUrl(user,96);if(url){const img=document.createElement('img');img.src=url;img.alt='';img.loading='lazy';avatar.replaceChildren(img);}}}
let galleryItems=[];
function renderGallery(items=galleryItems){
  galleryItems=items;
  const box=$('#galleryList');if(!box)return;
  const category=$('#galleryCategoryFilter')?.value||'',query=($('#gallerySearch')?.value||'').trim().toLocaleLowerCase('ru-RU');
  const visible=galleryItems.filter(item=>(!category||item.category===category)&&(!query||`${item.title} ${item.username} ${item.description}`.toLocaleLowerCase('ru-RU').includes(query)));
  box.innerHTML=visible.length?visible.map(x=>`<article class="gallery-card fade-in"><button class="gallery-open" type="button" data-gallery-open="${x.id}" aria-label="Открыть работу: ${esc(x.title)}"><img src="${esc(x.image_url)}" alt="${esc(x.title)}" loading="lazy" referrerpolicy="no-referrer"></button><div class="gallery-card-copy"><span class="gallery-category-chip">${esc(x.category||'Другое')}</span><h3>${esc(x.title)}</h3><p>${esc(x.description||'')}</p><small>${esc(x.username)} · ${esc(dateLabel(x.created_at))}</small></div></article>`).join(''):'<div class="empty-state">По этому фильтру работ нет.</div>';
}
$('#galleryCategoryFilter')?.addEventListener('change',()=>renderGallery());
$('#gallerySearch')?.addEventListener('input',()=>renderGallery());
const galleryDialog=$('#galleryDialog');
$('#galleryList')?.addEventListener('click',event=>{
  const button=event.target.closest('[data-gallery-open]');if(!button)return;
  const item=galleryItems.find(entry=>String(entry.id)===button.dataset.galleryOpen);if(!item)return;
  $('#galleryDialogImage').src=item.image_url;$('#galleryDialogImage').alt=item.title;
  $('#galleryDialogTitle').textContent=item.title;$('#galleryDialogMeta').textContent=`${item.category||'Другое'} · ${item.username} · ${dateLabel(item.created_at)}`;
  $('#galleryDialogDescription').textContent=item.description||'';galleryDialog.showModal();
});
galleryDialog?.querySelector('.gallery-dialog-close')?.addEventListener('click',()=>galleryDialog.close());
galleryDialog?.addEventListener('click',event=>{if(event.target===galleryDialog)galleryDialog.close();});
async function loadProfile(){
  const box=$('#profileArea');if(!box)return;
  const user=await getSession();renderAccountState(user);
  if(!user){box.innerHTML='<div class="profile-welcome"><span class="profile-welcome-mark">❋</span><div><strong>Твоё пространство в Miteria</strong><p>Войди через Discord, чтобы настроить профиль и открыть достижения.</p></div></div>';return;}
  try{
    const response=await fetch('/api/profile');if(!response.ok)throw new Error();
    const data=await response.json(),membership=data.guildMembership||{status:'not_configured',roles:[]};
    const avatarUrl=discordAvatarUrl(user,256);
    const avatarMarkup=avatarUrl?`<img src="${esc(avatarUrl)}" alt="Аватар Discord пользователя ${esc(user.username)}" loading="lazy">`:`<span>${esc((user.username||'✿').trim().charAt(0).toUpperCase()||'✿')}</span>`;
    const rolesMarkup=membership.status==='ok'?(membership.roles.length?membership.roles.map(role=>`<span class="discord-role-chip">${esc(role.name)}</span>`).join(''):'<p class="discord-role-message">На сервере пока нет дополнительных ролей.</p>'):membership.status==='not_member'?'<p class="discord-role-message">Этот аккаунт не найден на сервере Miteria. Присоединись к серверу и обнови страницу.</p>':membership.status==='not_configured'?'<p class="discord-role-message">Проверка ролей ещё не настроена на сайте.</p>':'<p class="discord-role-message">Не удалось получить роли. Проверь, что бот Miteria добавлен на сервер.</p>';
    const joinedMarkup=membership.joinedAt?`<p class="profile-joined">На сервере с ${esc(dateLabel(membership.joinedAt))}</p>`:'';
    const achievements=data.achievements||[];
    box.innerHTML=`<div class="profile-card"><div class="profile-avatar">${avatarMarkup}</div><div class="profile-main"><div class="profile-title-row"><div><p class="eyebrow">УЧАСТНИК MITERIA</p><h3>${esc(data.profile.username)}</h3></div><span class="profile-connected"><i>✓</i> Discord подключён</span></div><p class="profile-bio">${esc(data.profile.bio||'Расскажи немного о себе — добавь описание профиля.')}</p><div class="discord-roles"><div class="discord-roles-heading"><strong>Твои роли на сервере</strong><button class="small-button" id="refreshProfileRoles" type="button">Обновить</button><span class="discord-role-status ${membership.status==='ok'?'is-checked':''}">${membership.status==='ok'?'ПРОВЕРЕНО DISCORD':'СТАТУС РОЛЕЙ'}</span></div><div class="discord-role-list">${rolesMarkup}</div>${joinedMarkup}</div><form id="profileForm" class="profile-form"><label>О себе<textarea name="bio" maxlength="240" rows="3" placeholder="До 240 символов">${esc(data.profile.bio)}</textarea></label><div class="profile-form-footer"><button class="button button-light" type="submit">Сохранить описание</button><span id="profileMessage" class="form-message" role="status"></span></div></form><div class="achievement-launch"><span>Твои достижения в сообществе</span><button class="button button-outline" type="button" id="achievementsOpen">✦ Открыть достижения (${achievements.length}) ↗</button></div></div></div><dialog class="achievements-dialog" id="achievementsDialog" aria-labelledby="achievementsTitle"><div class="achievements-dialog-head"><div><p class="eyebrow">— ТВОЯ ИСТОРИЯ</p><h3 id="achievementsTitle">Достижения</h3></div><button class="achievements-close" type="button" data-close-achievements aria-label="Закрыть">×</button></div><div class="achievement-modal-grid">${achievements.length?achievements.map(item=>`<article class="achievement"><span>${esc(item.icon)}</span><div><strong>${esc(item.title)}</strong><p>${esc(item.description)}</p></div></article>`).join(''):'<p class="muted">Достижения появятся по мере участия в жизни сообщества.</p>'}</div></dialog>`;
    const dialog=$('#achievementsDialog');
    $('#achievementsOpen')?.addEventListener('click',()=>dialog?.showModal());
    dialog?.querySelector('[data-close-achievements]')?.addEventListener('click',()=>dialog.close());
    dialog?.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
    $('#refreshProfileRoles')?.addEventListener('click',async event=>{event.currentTarget.disabled=true;event.currentTarget.textContent='Проверяю…';await loadProfile();});
    $('#profileForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,message=$('#profileMessage');try{const result=await fetch('/api/profile',{method:'PUT',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify(Object.fromEntries(new FormData(form)))});const body=await result.json();if(!result.ok)throw new Error(body.error||'Не удалось сохранить');message.textContent='Описание сохранено.';await loadProfile();}catch(error){message.textContent=error.message;}});
  }catch{box.innerHTML='<p class="muted">Не удалось загрузить профиль. Попробуй обновить страницу.</p>';}
}
loadProfile();
document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-rsvp]');if(!button)return;
  const user=await getSession();if(!user){location.href='/auth/discord';return;}
  button.disabled=true;
  try{
    const method=button.dataset.attending==='true'?'DELETE':'POST';
    const response=await fetch(`/api/events/${button.dataset.rsvp}/rsvp`,{method,headers:{'X-CSRF-Token':csrfToken}});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Не удалось обновить запись.');
    await loadPublic();
  }catch(error){button.textContent=error.message;button.disabled=false;}
});
$('#galleryForm')?.addEventListener('submit',async e=>{
  e.preventDefault();
  const f=e.currentTarget,msg=$('#galleryMessage'),button=f.querySelector('button[type=submit]'),file=f.elements.image.files[0];
  try{
    const user=await getSession();
    if(!user){location.href='/auth/discord';return;}
    if(!file)throw new Error('Сначала выбери картинку.');
    if(file.size>5*1024*1024)throw new Error('Картинка должна быть не больше 5 МБ.');
    const query=new URLSearchParams({title:f.elements.title.value,description:f.elements.description.value,category:f.elements.category.value});
    button.disabled=true;msg.textContent='Загружаем картинку…';
    const r=await fetch(`/api/gallery/upload?${query}`,{method:'POST',headers:{'Content-Type':file.type,'X-CSRF-Token':csrfToken},body:file});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'Не удалось загрузить картинку.');
    f.reset();msg.textContent=d.message||'Работа отправлена на модерацию.';
  }catch(err){msg.textContent=err.message||'Не удалось загрузить картинку.';}
  finally{button.disabled=false;}
});


let companyPosts=[];
function renderCompany(posts=companyPosts){
  companyPosts=posts;
  const box=$('#companyList');if(!box)return;
  const activity=$('#companyActivityFilter')?.value||'',query=($('#companySearch')?.value||'').trim().toLocaleLowerCase('ru-RU');
  const visible=companyPosts.filter(post=>(!activity||post.activity===activity)&&(!query||`${post.game} ${post.details} ${post.activity}`.toLocaleLowerCase('ru-RU').includes(query)));
  box.innerHTML=visible.length?visible.map(post=>{const available=post.available_at?new Date(post.available_at).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';return `<article class="company-card fade-in"><div class="company-card-top"><span class="company-status">● ОТКРЫТ</span><small>${esc(dateLabel(post.created_at))}</small></div><h3>${esc(post.activity)}</h3><p class="company-game">${esc(post.game||'Тема не указана')}</p><p>${esc(post.details||'Автор открыт к предложениям.')}</p>${available?`<p class="company-available">Свободен: ${esc(available)}</p>`:''}<div class="company-card-bottom"><small>${esc(post.username)} · ${Number(post.responses||0)} откликов</small><button class="small-button" data-company-respond="${post.id}" ${post.responded?'disabled':''}>${post.responded?'Отклик отправлен':'Откликнуться'}</button></div></article>`;}).join(''):'<div class="empty-state">По этим условиям запросов нет.</div>';
}
$('#companyActivityFilter')?.addEventListener('change',()=>renderCompany());
$('#companySearch')?.addEventListener('input',()=>renderCompany());
$('#companyForm')?.addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget,message=$('#companyMessage'),user=await getSession();if(!user){location.href='/auth/discord';return;}
  const button=form.querySelector('button[type=submit]'),payload=Object.fromEntries(new FormData(form));
  try{
    if(payload.available_at)payload.available_at=new Date(payload.available_at).toISOString();
    button.disabled=true;
    const response=await fetch('/api/company',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify(payload)});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Не удалось создать запрос');
    form.reset();message.textContent='Запрос опубликован на 12 часов.';await loadPublic();
  }catch(error){message.textContent=error.message;}finally{button.disabled=false;}
});
document.addEventListener('click',async e=>{const b=e.target.closest('[data-company-respond]');if(!b)return;const user=await getSession();if(!user){location.href='/auth/discord';return;}b.disabled=true;try{const r=await fetch(`/api/company/${b.dataset.companyRespond}/respond`,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify({message:''})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Не удалось откликнуться');b.textContent='Отклик отправлен';const msg=document.createElement('p');msg.className='muted';msg.textContent=d.message;b.closest('.company-card')?.append(msg);}catch(err){b.disabled=false;b.textContent=err.message;}});
