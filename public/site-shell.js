const pageLinks = [
  ['home','Главная','/'], ['info','Информация','/info.html'], ['shop','Шоп','/shop.html'],
  ['commands','Команды','/commands.html'], ['events','События','/events.html'],
  ['company','Компания','/company.html'], ['gallery','Галерея','/gallery.html'],
  ['news','Новости','/news.html'], ['profile','Профиль','/profile.html'], ['team','Команда','/team.html'],
  ['raffles','Розыгрыши','/raffles.html'], ['chat','Чат','/chat.html'], ['leaderboard','Лидеры','/leaderboard.html']
];
const currentPage = document.body.dataset.page || 'home';
const linksMarkup = pageLinks.map(([key,label,url]) => `<a href="${url}"${key===currentPage?' aria-current="page"':''}>${label}</a>`).join('');
const headerLinks = pageLinks.filter(([key]) => ['home','info','shop','commands','raffles','chat','leaderboard'].includes(key));
const headerMarkup = headerLinks.map(([key,label,url]) => `<a href="${url}"${key===currentPage?' aria-current="page"':''}>${label}</a>`).join('');
document.querySelector('#siteHeader').innerHTML = `<header class="site-header"><a class="brand" href="/" aria-label="Miteria — главная"><span class="brand-lily" aria-hidden="true">❋</span><span class="brand-name">MITERIA<small>ミテリア</small></span></a><button class="menu-toggle" id="menuToggle" aria-label="Открыть меню" aria-expanded="false">☰</button><nav id="mainNav" class="main-nav">${headerMarkup}</nav><div class="header-actions"><a class="button button-outline" id="adminShortcut" href="/admin.html" hidden>Админ-панель</a><a class="button button-light discord-button" id="discordLogin" href="/auth/discord">Войти через Discord <span>→</span></a><a class="account-chip" id="headerAccount" href="/profile.html" hidden><span class="account-chip-avatar" id="headerAccountAvatar">✿</span><span class="account-chip-copy"><small>АККАУНТ</small><strong id="headerAccountName">Участник</strong></span></a></div></header>`;
document.querySelector('#siteFooter').innerHTML = `<footer class="site-footer section-wrap"><a class="brand" href="/"><span class="brand-lily" aria-hidden="true">❋</span><span class="brand-name">MITERIA<small>ミテリア</small></span></a><nav aria-label="Разделы сайта">${linksMarkup}</nav><span>© <span id="year"></span> Miteria</span><a href="/support.html">Поддержка</a><a href="/admin.html">Администрирование</a></footer>`;
