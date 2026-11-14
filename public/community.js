const chatBox=$('#chatMessages');
let chatIsAdmin=false;
let chatLoaded=false;
async function refreshChat(){
  if(!chatBox)return;
  const nearBottom=chatBox.scrollHeight-chatBox.scrollTop-chatBox.clientHeight<90||!chatLoaded;
  try{
    const response=await fetch('/api/chat/messages');if(!response.ok)throw new Error();
    const data=await response.json();chatIsAdmin=Boolean(data.isAdmin);
    chatBox.innerHTML=data.messages.length?data.messages.map(message=>`<article class="chat-message" data-chat-id="${message.id}"><div class="chat-message-head"><strong>${esc(message.username)}</strong><time>${esc(new Date(message.created_at.replace(' ','T')+'Z').toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}))}</time></div><p>${esc(message.body)}</p><div class="chat-message-actions">${!message.own?`<button class="text-button" type="button" data-report-kind="chat" data-report-id="${message.id}">Пожаловаться</button>`:''}${chatIsAdmin?`<button class="chat-message-delete" type="button" data-chat-delete="${message.id}">Удалить</button>`:''}</div></article>`).join(''):'<p class="muted">Пока сообщений нет. Начни разговор.</p>';
    if(nearBottom)chatBox.scrollTop=chatBox.scrollHeight;
    chatLoaded=true;
  }catch{if(!chatLoaded)chatBox.innerHTML='<p class="muted">Не удалось загрузить чат.</p>';}
}
if(chatBox){
  getSession().then(user=>{
    const form=$('#chatForm'),login=$('#chatLogin'),notice=$('#chatNotice');
    if(form)form.hidden=!user;
    if(login)login.hidden=Boolean(user);
    if(notice)notice.textContent=user?'Сообщения сохраняются и видны участникам сайта.':'Читать чат можно без входа.';
  });
  refreshChat();
  window.setInterval(()=>{if(!document.hidden)refreshChat();},8000);
}
$('#chatForm')?.addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget,input=form.elements.body,message=$('#chatMessage'),button=form.querySelector('button[type=submit]');
  button.disabled=true;message.textContent='Отправляем…';
  try{
    const response=await fetch('/api/chat/messages',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify({body:input.value})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Не удалось отправить сообщение.');
    input.value='';message.textContent='';await refreshChat();input.focus();
  }catch(error){message.textContent=error.message;}finally{button.disabled=false;}
});
chatBox?.addEventListener('click',async event=>{
  const button=event.target.closest('[data-chat-delete]');if(!button)return;
  button.disabled=true;
  try{const response=await fetch(`/api/chat/messages/${button.dataset.chatDelete}`,{method:'DELETE',headers:{'X-CSRF-Token':csrfToken}});const data=await response.json();if(!response.ok)throw new Error(data.error||'Не удалось удалить сообщение.');await refreshChat();}
  catch(error){button.disabled=false;button.textContent=error.message;}
});

const raffleBox=$('#raffleList');
let raffleIsAdmin=false;
async function loadRaffles(){
  if(!raffleBox)return;
  try{
    const [user,response]=await Promise.all([getSession(),fetch('/api/raffles')]);
    if(!response.ok)throw new Error();
    raffleIsAdmin=Boolean(user?.isAdmin);
    const adminPanel=$('#raffleAdminPanel');if(adminPanel)adminPanel.hidden=!raffleIsAdmin;
    const data=await response.json();
    raffleBox.innerHTML=data.raffles.length?data.raffles.map(raffle=>{
      const endAt=new Date(raffle.end_at),isEnded=raffle.status==='ended',timePassed=endAt.getTime()<=Date.now(),canEnter=!isEnded&&!timePassed;
      const state=isEnded?(raffle.winner_name?`Победитель: ${esc(raffle.winner_name)}`:'Завершён без участников'):timePassed?'Приём заявок закрыт':'До '+esc(endAt.toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}));
      const joinButton=canEnter?`<button class="button ${raffle.entered?'button-outline':'button-light'}" data-raffle-enter="${raffle.id}" data-entered="${Boolean(raffle.entered)}">${raffle.entered?'Отменить участие':'Участвовать'}</button>`:'';
      const drawButton=raffleIsAdmin&&!isEnded?`<button class="small-button" data-raffle-draw="${raffle.id}" ${timePassed?'':'disabled'}>${timePassed?'Выбрать победителя':'После завершения'}</button>`:'';
      return `<article class="raffle-card"><span class="raffle-status">${isEnded?'Завершён':timePassed?'Ждёт выбора':'Идёт'}</span><h2>${esc(raffle.title)}</h2><span class="raffle-prize">${esc(raffle.prize)}</span><p>${esc(raffle.description||'Подробности уточняй у команды сервера.')}</p><div class="raffle-meta"><span>${Number(raffle.entries)} участников</span><span>${state}</span></div><div class="raffle-actions">${joinButton}${drawButton}</div></article>`;
    }).join(''):'<div class="empty-state">Пока розыгрышей нет.</div>';
  }catch{raffleBox.innerHTML='<div class="empty-state">Не удалось загрузить розыгрыши.</div>';}
}
if(raffleBox)loadRaffles();
$('#raffleCreateForm')?.addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget,message=$('#raffleAdminMessage'),button=form.querySelector('button[type=submit]'),payload=Object.fromEntries(new FormData(form));
  try{
    payload.end_at=new Date(payload.end_at).toISOString();button.disabled=true;
    const response=await fetch('/api/admin/raffles',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify(payload)});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Не удалось создать розыгрыш.');
    form.reset();message.textContent='Розыгрыш опубликован.';await loadRaffles();
  }catch(error){message.textContent=error.message;}finally{button.disabled=false;}
});
raffleBox?.addEventListener('click',async event=>{
  const enter=event.target.closest('[data-raffle-enter]'),draw=event.target.closest('[data-raffle-draw]');if(!enter&&!draw)return;
  if(enter&&!await getSession()){location.href='/auth/discord';return;}
  const button=enter||draw,raffleId=enter?enter.dataset.raffleEnter:draw.dataset.raffleDraw;button.disabled=true;
  try{
    const url=enter?`/api/raffles/${raffleId}/enter`:`/api/admin/raffles/${raffleId}/draw`;
    const method=draw?'POST':enter.dataset.entered==='true'?'DELETE':'POST';
    const response=await fetch(url,{method,headers:{'X-CSRF-Token':csrfToken}}),data=await response.json();
    if(!response.ok)throw new Error(data.error||'Не удалось обновить розыгрыш.');
    await loadRaffles();
  }catch(error){button.disabled=false;button.textContent=error.message;}
});

const leaderboardBox=$('#leaderboardList');
if(leaderboardBox){
  fetch('/api/leaderboard').then(response=>{if(!response.ok)throw new Error();return response.json();}).then(data=>{
    leaderboardBox.innerHTML=data.leaders.length?data.leaders.map((leader,index)=>`<article class="leaderboard-row"><span class="leaderboard-rank">${index+1}</span><strong class="leaderboard-name">${esc(leader.username)}</strong><span class="leaderboard-score">✦ ${Number(leader.achievements)} / 100</span></article>`).join(''):'<div class="empty-state">Рейтинг появится, когда участники начнут открывать достижения.</div>';
  }).catch(()=>{leaderboardBox.innerHTML='<div class="empty-state">Не удалось загрузить рейтинг.</div>';});
}
