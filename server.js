import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import SQLiteStoreFactory from 'connect-sqlite3';
import Database from 'better-sqlite3';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';
const SITE_URL = (process.env.SITE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
// Railway volume can be mounted at /app/data and selected with DATA_DIR.
const DB_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
fs.mkdirSync(DB_DIR, { recursive: true });
const GALLERY_DIR = path.join(DB_DIR, 'gallery');
fs.mkdirSync(GALLERY_DIR, { recursive: true });
const GALLERY_IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
let discordStatsCache = { expiresAt: 0, value: null };

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error('SESSION_SECRET must be set to a random value of at least 32 characters. See .env.example.');
  process.exit(1);
}

const db = new Database(path.join(DB_DIR, 'yushiko.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL,
  event_date TEXT NOT NULL, location TEXT DEFAULT 'Discord', status TEXT NOT NULL DEFAULT 'upcoming',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, discord_tag TEXT NOT NULL,
  role TEXT NOT NULL, message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL,
  action TEXT NOT NULL, details TEXT NOT NULL, ip TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY, username TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT 'Гость', updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS achievements (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
  description TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '✦'
);
CREATE TABLE IF NOT EXISTS user_achievements (
  user_id TEXT NOT NULL, achievement_id INTEGER NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  earned_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(user_id, achievement_id)
);
CREATE TABLE IF NOT EXISTS gallery_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, username TEXT NOT NULL,
  title TEXT NOT NULL, image_url TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'Другое',
  status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS company_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, username TEXT NOT NULL,
  activity TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', game TEXT NOT NULL DEFAULT '', available_at TEXT,
  status TEXT NOT NULL DEFAULT 'open', expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS company_responses (
  post_id INTEGER NOT NULL REFERENCES company_posts(id) ON DELETE CASCADE, user_id TEXT NOT NULL,
  username TEXT NOT NULL, message TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(post_id,user_id)
);
CREATE TABLE IF NOT EXISTS event_rsvps (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE, user_id TEXT NOT NULL,
  username TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(event_id,user_id)
);
CREATE TABLE IF NOT EXISTS support_tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL, username TEXT NOT NULL,
  subject TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'support',
  status TEXT NOT NULL DEFAULT 'open', priority TEXT NOT NULL DEFAULT 'normal',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ticket_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL, sender_name TEXT NOT NULL,
  sender_role TEXT NOT NULL DEFAULT 'user', body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS system_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT NOT NULL,
  method TEXT NOT NULL, path TEXT NOT NULL, status INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL, ip TEXT NOT NULL, user_id TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, username TEXT NOT NULL,
  body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS raffles (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  prize TEXT NOT NULL, end_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
  winner_user_id TEXT, winner_name TEXT, created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS raffle_entries (
  raffle_id INTEGER NOT NULL REFERENCES raffles(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, username TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY(raffle_id,user_id)
);
CREATE TABLE IF NOT EXISTS gallery_likes (
  item_id INTEGER NOT NULL REFERENCES gallery_items(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(item_id,user_id)
);
CREATE TABLE IF NOT EXISTS gallery_saves (
  item_id INTEGER NOT NULL REFERENCES gallery_items(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(item_id,user_id)
);
CREATE TABLE IF NOT EXISTS gallery_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, item_id INTEGER NOT NULL REFERENCES gallery_items(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, username TEXT NOT NULL, body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, kind TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL, href TEXT NOT NULL,
  unique_key TEXT NOT NULL UNIQUE, read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS content_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, target_id INTEGER NOT NULL,
  target_user_id TEXT NOT NULL, target_name TEXT NOT NULL, content TEXT NOT NULL,
  reporter_id TEXT NOT NULL, reporter_name TEXT NOT NULL, reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(kind,target_id,reporter_id)
);
CREATE TABLE IF NOT EXISTS chat_mutes (
  user_id TEXT PRIMARY KEY, username TEXT NOT NULL, reason TEXT NOT NULL,
  expires_at TEXT NOT NULL, set_by TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(id DESC);
CREATE INDEX IF NOT EXISTS idx_gallery_comments_item ON gallery_comments(item_id,id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id,id DESC);
`);
for (const [table, column, definition] of [
  ['gallery_items', 'category', "TEXT NOT NULL DEFAULT 'Другое'"],
  ['company_posts', 'available_at', 'TEXT'],
  ['profiles', 'avatar_url', "TEXT NOT NULL DEFAULT ''"],
  ['profiles', 'favorite_games', "TEXT NOT NULL DEFAULT ''"],
  ['profiles', 'status_text', "TEXT NOT NULL DEFAULT ''"],
  ['profiles', 'achievements_public', 'INTEGER NOT NULL DEFAULT 1'],
  ['raffles', 'ended_at', 'TEXT']
]) {
  const columns = db.pragma(`table_info(${table})`);
  if (!columns.some(item => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
const seedNews = db.prepare('SELECT COUNT(*) AS n FROM news').get().n;
if (!seedNews) {
  db.prepare('INSERT INTO news (title, body) VALUES (?, ?)').run('Добро пожаловать в Miteria!', 'Мы рады видеть тебя в нашем сообществе. Знакомься, общайся и участвуй в событиях.');
  db.prepare('INSERT INTO news (title, body) VALUES (?, ?)').run('Сайт обновлён', 'Теперь новости, мероприятия и заявки можно управлять через панель администратора.');
}
const seedEvents = db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
if (!seedEvents) {
  db.prepare('INSERT INTO events (title, description, event_date, location) VALUES (?, ?, ?, ?)').run('Вечер сообщества', 'Знакомимся, общаемся и играем вместе.', new Date(Date.now() + 7*86400000).toISOString(), 'Discord');
}

const seedAchievements = [
  ['first_step','Первый шаг','Присоединился к пространству Miteria','✿'],
  ['community_voice','Голос сообщества','Заполнил профиль участника','☾'],
  ['gallery_artist','Творец','Работа опубликована в галерее','✦'],
  ['event_guest','Гость события','Записался на мероприятие','❋']
];
const achievementMilestones = {
  chat: { title: 'Сообщений в чате', icon: '☾', thresholds: [1,5,10,25,50,100,200,350,500,750,1000,1500,2000,3000,4000,5000,7500,10000,15000,20000,30000,50000,75000,100000] },
  events: { title: 'Записей на события', icon: '✧', thresholds: [1,2,3,5,7,10,15,20,30,40,50,75,100,150,200,300,400,500,700,1000,1500,2000,3000,5000] },
  gallery: { title: 'Опубликованных работ', icon: '✿', thresholds: [1,2,3,5,7,10,15,20,30,40,50,75,100,150,200,300,400,500,700,1000,1500,2000,3000,5000] },
  company: { title: 'Запросов на поиск компании', icon: '♧', thresholds: [1,2,3,5,7,10,15,20,30,40,50,75,100,150,200,300,400,500,700,1000,1500,2000,3000,5000] }
};
for (const [group, milestone] of Object.entries(achievementMilestones)) {
  for (const threshold of milestone.thresholds) {
    seedAchievements.push([
      `${group}_${threshold}`,
      `${milestone.title} · ${threshold}`,
      `Рубеж: ${threshold} — ${milestone.title.toLocaleLowerCase('ru-RU')}.`,
      milestone.icon
    ]);
  }
}
const insertAchievement = db.prepare('INSERT OR IGNORE INTO achievements (code,title,description,icon) VALUES (?,?,?,?)');
for (const item of seedAchievements) insertAchievement.run(...item);

function syncUserAchievements(userId, username = 'Участник') {
  db.prepare('INSERT OR IGNORE INTO profiles(user_id,username) VALUES(?,?)').run(String(userId), safeText(username,100));
  db.prepare("INSERT OR IGNORE INTO user_achievements(user_id,achievement_id) SELECT ?,id FROM achievements WHERE code='first_step'").run(String(userId));
  const counts = {
    chat: db.prepare('SELECT COUNT(*) AS count FROM chat_messages WHERE user_id=?').get(userId).count,
    events: db.prepare('SELECT COUNT(*) AS count FROM event_rsvps WHERE user_id=?').get(userId).count,
    gallery: db.prepare("SELECT COUNT(*) AS count FROM gallery_items WHERE user_id=? AND status='approved'").get(userId).count,
    company: db.prepare('SELECT COUNT(*) AS count FROM company_posts WHERE user_id=?').get(userId).count
  };
  const grant = db.prepare('INSERT OR IGNORE INTO user_achievements(user_id,achievement_id) SELECT ?,id FROM achievements WHERE code=?');
  for (const [group, milestone] of Object.entries(achievementMilestones)) {
    for (const threshold of milestone.thresholds) {
      if (counts[group] >= threshold) grant.run(userId, `${group}_${threshold}`);
    }
  }
}

const SQLiteStore = SQLiteStoreFactory(session);
if (isProduction) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'https:'],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", 'https://discord.com', 'https://discordapp.com'],
      objectSrc: ["'none'"], frameAncestors: ["'none'"], upgradeInsecureRequests: isProduction ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '30kb' }));
app.use(express.urlencoded({ extended: false, limit: '30kb' }));
app.use(session({
  name: 'yushiko.sid',
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: DB_DIR, concurrentDB: true }),
  secret: process.env.SESSION_SECRET,
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, secure: isProduction, sameSite: 'lax', maxAge: 1000*60*60*8 }
}));

const apiLimiter = rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: 'draft-7', legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15*60_000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false });
app.use('/api', apiLimiter);
app.use('/auth', authLimiter);

// Server-side request log for operational diagnostics (sensitive payloads are never recorded).
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    const p = String(req.path || '').slice(0, 300);
    if (p.startsWith('/public/') || p.endsWith('.css') || p.endsWith('.js') || p.endsWith('.webp') || p.endsWith('.png') || p.endsWith('.ico')) return;
    const status = res.statusCode;
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    try {
      db.prepare('INSERT INTO system_logs (level, method, path, status, duration_ms, ip, user_id, message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(level, req.method, p, status, Date.now() - started, safeText(req.ip || '', 100), String(req.session?.user?.id || ''), status >= 400 ? `HTTP ${status}` : '');
    } catch (e) { console.error('Unable to write request log:', e.message); }
  });
  next();
});

const adminIds = new Set((process.env.DISCORD_ADMIN_IDS || '').split(',').map(x => x.trim()).filter(Boolean));
const adminRoleIds = new Set((process.env.DISCORD_ADMIN_ROLE_IDS || '').split(',').map(x => x.trim()).filter(Boolean));
const adminRoleCache = new Map();
const inviteUrl = process.env.DISCORD_INVITE_URL || 'https://discord.gg/xJfXk8kX5';

function safeText(value, max = 2000) {
  return String(value ?? '').trim().slice(0, max);
}
function userView(req) {
  const u = req.session.user;
  if (!u) return null;
  return { id: u.id, username: u.username, avatar: u.avatar, isAdmin: adminIds.has(u.id) };
}
function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Сначала войдите через Discord.' });
  next();
}
async function hasAdminRole(userId) {
  if (!adminRoleIds.size || !process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_GUILD_ID) return false;
  const cached = adminRoleCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.allowed;
  try {
    const response = await fetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(process.env.DISCORD_GUILD_ID)}/members/${encodeURIComponent(userId)}`, {
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` }, signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return false;
    const member = await response.json();
    const allowed = Array.isArray(member.roles) && member.roles.some(roleId => adminRoleIds.has(roleId));
    adminRoleCache.set(userId, { allowed, expiresAt: Date.now() + 30000 });
    return allowed;
  } catch {
    return false;
  }
}
async function isAdminUser(userId) {
  const id = String(userId);
  return adminIds.has(id) || hasAdminRole(id);
}
async function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Требуется вход через Discord.' });
  if (!(await isAdminUser(req.session.user.id))) return res.status(403).json({ error: 'Для доступа нужна разрешённая роль администратора на сервере Miteria.' });
  next();
}
function ensureCsrf(req, res, next) {
  const supplied = req.get('x-csrf-token') || req.body?._csrf;
  const expected = Buffer.from(String(req.session.csrf || ''));
  const actual = Buffer.from(String(supplied || ''));
  if (!expected.length || !actual.length || expected.length !== actual.length || !crypto.timingSafeEqual(actual, expected)) {
    return res.status(403).json({ error: 'Проверка запроса не пройдена. Обновите страницу и попробуйте снова.' });
  }
  next();
}
function logAction(req, action, details = '') {
  const u = req.session.user || {};
  db.prepare('INSERT INTO audit_logs (actor_id, actor_name, action, details, ip) VALUES (?, ?, ?, ?, ?)')
    .run(String(u.id || 'system'), safeText(u.username || 'system', 100), action, safeText(details, 1000), safeText(req.ip || '', 100));
}
function createNotification(userId, kind, title, body, href, uniqueKey) {
  if (!userId) return;
  db.prepare('INSERT OR IGNORE INTO notifications(user_id,kind,title,body,href,unique_key) VALUES(?,?,?,?,?,?)')
    .run(String(userId), safeText(kind,40), safeText(title,120), safeText(body,300), safeText(href,300), safeText(uniqueKey,180));
}
function createEventReminders() {
  const reminders = db.prepare(`SELECT e.id,e.title,e.event_date,r.user_id FROM events e
    JOIN event_rsvps r ON r.event_id=e.id
    WHERE e.status!='cancelled' AND datetime(e.event_date)>=datetime('now')
      AND datetime(e.event_date)<=datetime('now','+24 hours')`).all();
  for (const event of reminders) createNotification(event.user_id, 'event', 'Скоро начнётся событие',
    `${event.title} — ${new Date(event.event_date).toLocaleString('ru-RU')}`, '/events.html', `event:${event.id}:reminder`);
}
const eventReminderTimer=setInterval(()=>{try{createEventReminders();}catch(error){console.error('Event reminder job failed:',error.message);}},5*60_000);
eventReminderTimer.unref();
function validateRequired(body, fields) {
  return fields.every(f => typeof body[f] === 'string' && body[f].trim().length > 0);
}
async function notifyDiscord(content) {
  if (!process.env.DISCORD_WEBHOOK_URL) return;
  const url = new URL(process.env.DISCORD_WEBHOOK_URL); if (url.protocol !== 'https:') return;
  await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({content:String(content).slice(0,1800)}), signal:AbortSignal.timeout(3500) });
}

app.get('/api/me', async (req, res) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(32).toString('hex');
  const user = userView(req);
  if (user && !user.isAdmin) user.isAdmin = await hasAdminRole(user.id);
  res.json({ user, csrfToken: req.session.csrf });
});
app.get('/api/notifications', requireLogin, (req,res) => {
  createEventReminders();
  const userId=String(req.session.user.id);
  const rows=db.prepare('SELECT id,kind,title,body,href,read_at,created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 30').all(userId);
  res.json({notifications:rows,unread:rows.filter(row=>!row.read_at).length});
});
app.post('/api/notifications/:id/read', requireLogin, ensureCsrf, (req,res) => {
  const result=db.prepare("UPDATE notifications SET read_at=datetime('now') WHERE id=? AND user_id=? AND read_at IS NULL").run(Number(req.params.id),String(req.session.user.id));
  res.json({ok:true,changed:Boolean(result.changes)});
});
app.post('/api/notifications/read-all', requireLogin, ensureCsrf, (req,res) => {
  db.prepare("UPDATE notifications SET read_at=datetime('now') WHERE user_id=? AND read_at IS NULL").run(String(req.session.user.id));
  res.json({ok:true});
});
app.get('/api/search', (req,res) => {
  const query=safeText(req.query.q,80).replace(/[%_]/g,' ').trim();
  if(query.length<2) return res.json({results:[]});
  const like=`%${query}%`;
  const results=[];
  for(const row of db.prepare("SELECT title AS name,body AS excerpt,'Новость' AS type,'/news.html' AS href,created_at FROM news WHERE title LIKE ? OR body LIKE ? ORDER BY id DESC LIMIT 5").all(like,like)) results.push(row);
  for(const row of db.prepare("SELECT title AS name,description AS excerpt,'Событие' AS type,'/events.html' AS href,event_date AS created_at FROM events WHERE status!='cancelled' AND (title LIKE ? OR description LIKE ? OR location LIKE ?) ORDER BY event_date LIMIT 5").all(like,like,like)) results.push(row);
  for(const row of db.prepare("SELECT title AS name,description AS excerpt,'Галерея' AS type,'/gallery.html' AS href,created_at FROM gallery_items WHERE status='approved' AND (title LIKE ? OR description LIKE ? OR username LIKE ? OR category LIKE ?) ORDER BY id DESC LIMIT 5").all(like,like,like,like)) results.push(row);
  for(const row of db.prepare("SELECT activity AS name,details AS excerpt,'Компания' AS type,'/company.html' AS href,created_at FROM company_posts WHERE status='open' AND expires_at>datetime('now') AND (activity LIKE ? OR details LIKE ? OR game LIKE ? OR username LIKE ?) ORDER BY id DESC LIMIT 5").all(like,like,like,like)) results.push(row);
  const commands=[['/profile','Профиль участника'],['/balance','Баланс и монеты'],['/marry','Брак с участником'],['/duel','Дуэль'],['/shop','Магазин ролей'],['/timely','Награда каждые 12 часов'],['/inventory','Инвентарь'],['/transfer','Передача валюты'],['/create_role','Создание личной роли'],['/role_manager','Управление личной ролью']];
  for(const [name,excerpt] of commands) if(`${name} ${excerpt}`.toLocaleLowerCase('ru-RU').includes(query.toLocaleLowerCase('ru-RU'))) results.push({name,excerpt,type:'Команда',href:'/commands.html',created_at:null});
  res.json({results:results.slice(0,20)});
});
app.get('/api/activity', (req,res) => {
  const rows=db.prepare(`SELECT * FROM (
    SELECT 'news' AS kind,title AS title,body AS detail,created_at AS happened_at,'/news.html' AS href FROM news
    UNION ALL SELECT 'event',title,description,created_at,'/events.html' FROM events WHERE status!='cancelled'
    UNION ALL SELECT 'gallery',title,description,created_at,'/gallery.html' FROM gallery_items WHERE status='approved'
    UNION ALL SELECT 'raffle',title,COALESCE('Победитель: '||winner_name,'Розыгрыш завершён без участников'),COALESCE(ended_at,created_at),'/raffles.html' FROM raffles WHERE status='ended'
  ) ORDER BY datetime(happened_at) DESC LIMIT 10`).all();
  res.json({items:rows});
});
async function getDiscordServerStats() {
  if (discordStatsCache.value && discordStatsCache.expiresAt > Date.now()) return discordStatsCache.value;
  const { DISCORD_BOT_TOKEN: botToken, DISCORD_GUILD_ID: guildId } = process.env;
  if (botToken && guildId) {
    try {
      const response = await fetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}?with_counts=true`, {
        headers: { Authorization: `Bot ${botToken}` }, signal: AbortSignal.timeout(4000)
      });
      if (response.ok) {
        const guild = await response.json();
        const value = { guild: guild.name || null, members: guild.approximate_member_count ?? null, online: guild.approximate_presence_count ?? null, source: 'bot' };
        discordStatsCache = { expiresAt: Date.now() + 60_000, value };
        return value;
      }
    } catch { /* Use the public widget as a fallback below. */ }
  }
  if (process.env.DISCORD_WIDGET_ENABLED === 'true' && guildId) {
    try {
      const response = await fetch(`https://discord.com/api/guilds/${encodeURIComponent(guildId)}/widget.json`, { signal: AbortSignal.timeout(3500) });
      if (response.ok) {
        const widget = await response.json();
        const value = { guild: widget.name || null, members: null, online: widget.presence_count ?? null, source: 'widget' };
        discordStatsCache = { expiresAt: Date.now() + 60_000, value };
        return value;
      }
    } catch { /* The public page stays available without live Discord stats. */ }
  }
  return { guild: null, members: null, online: null, source: 'unavailable' };
}
app.get('/api/public', async (req, res) => {
  const discord = await getDiscordServerStats();
  const userId=String(req.session.user?.id||'');
  res.json({
    inviteUrl,
    discord,
    news: db.prepare('SELECT id, title, body, created_at FROM news ORDER BY id DESC LIMIT 6').all(),
    company: db.prepare("SELECT p.id,p.username,p.activity,p.details,p.game,p.available_at,p.created_at,p.expires_at,(SELECT COUNT(*) FROM company_responses r WHERE r.post_id=p.id) AS responses,EXISTS(SELECT 1 FROM company_responses r WHERE r.post_id=p.id AND r.user_id=?) AS responded FROM company_posts p WHERE p.status='open' AND p.expires_at>datetime('now') ORDER BY p.id DESC LIMIT 40").all(String(req.session.user?.id || '')),
    events: db.prepare("SELECT e.id,e.title,e.description,e.event_date,e.location,e.status,(SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id=e.id) AS attendees,EXISTS(SELECT 1 FROM event_rsvps r WHERE r.event_id=e.id AND r.user_id=?) AS attending FROM events e WHERE e.status!='cancelled' ORDER BY e.event_date ASC LIMIT 24").all(String(req.session.user?.id || '')),
    gallery: db.prepare(`SELECT g.id,g.username,g.title,g.image_url,g.description,g.category,g.created_at,
      (SELECT COUNT(*) FROM gallery_likes l WHERE l.item_id=g.id) AS likes,
      EXISTS(SELECT 1 FROM gallery_likes l WHERE l.item_id=g.id AND l.user_id=?) AS liked,
      EXISTS(SELECT 1 FROM gallery_saves s WHERE s.item_id=g.id AND s.user_id=?) AS saved,
      (SELECT COUNT(*) FROM gallery_comments c WHERE c.item_id=g.id) AS comments
      FROM gallery_items g WHERE g.status='approved' ORDER BY g.id DESC LIMIT 48`).all(userId,userId),
    achievements: db.prepare('SELECT code,title,description,icon FROM achievements ORDER BY id').all()
  });
});
app.get('/api/chat/messages', async (req,res) => {
  const userId=String(req.session.user?.id||'');
  const messages=db.prepare('SELECT id,user_id,username,body,created_at FROM chat_messages ORDER BY id DESC LIMIT 100').all().reverse().map(({user_id,...message})=>({...message,own:Boolean(userId&&user_id===userId)}));
  const isAdmin=req.session.user?await isAdminUser(req.session.user.id):false;
  res.json({messages,isAdmin});
});
app.post('/api/chat/messages', requireLogin, ensureCsrf, (req,res) => {
  const body=safeText(req.body?.body,500), user=req.session.user;
  if(!body) return res.status(400).json({error:'Напиши сообщение до 500 символов.'});
  const mute=db.prepare("SELECT reason,expires_at FROM chat_mutes WHERE user_id=? AND datetime(expires_at)>datetime('now')").get(String(user.id));
  if(mute) return res.status(403).json({error:`Отправка сообщений ограничена до ${new Date(mute.expires_at).toLocaleString('ru-RU')}. ${mute.reason}`});
  const recent=db.prepare("SELECT COUNT(*) AS count FROM chat_messages WHERE user_id=? AND created_at>datetime('now','-1 minute')").get(String(user.id)).count;
  if(recent>=6) return res.status(429).json({error:'Подожди минуту перед новыми сообщениями.'});
  const result=db.prepare('INSERT INTO chat_messages(user_id,username,body) VALUES(?,?,?)').run(String(user.id),safeText(user.username,100),body);
  syncUserAchievements(String(user.id), user.username);
  const mentionedNames=[...body.matchAll(/@([\p{L}\p{N}_.-]{2,32})/gu)].map(match=>match[1].toLocaleLowerCase('ru-RU'));
  if(mentionedNames.length){for(const profile of db.prepare('SELECT user_id,username FROM profiles').all()){if(String(profile.user_id)!==String(user.id)&&mentionedNames.includes(profile.username.toLocaleLowerCase('ru-RU')))createNotification(profile.user_id,'chat','Тебя упомянули в чате',`${safeText(user.username,100)}: ${body}`,'/chat.html',`chat:${result.lastInsertRowid}:mention:${profile.user_id}`);}}
  res.status(201).json({ok:true,id:result.lastInsertRowid});
});
app.delete('/api/chat/messages/:id', requireAdmin, ensureCsrf, (req,res) => {
  const result=db.prepare('DELETE FROM chat_messages WHERE id=?').run(Number(req.params.id));
  if(!result.changes) return res.status(404).json({error:'Сообщение не найдено.'});
  logAction(req,'chat.delete',`message=${req.params.id}`);
  res.json({ok:true});
});
app.get('/api/leaderboard', (req,res) => {
  const leaders=db.prepare(`SELECT p.username,COUNT(ua.achievement_id) AS achievements
    FROM profiles p JOIN user_achievements ua ON ua.user_id=p.user_id WHERE p.achievements_public=1
    GROUP BY p.user_id,p.username ORDER BY achievements DESC,MAX(ua.earned_at) ASC,p.username COLLATE NOCASE ASC LIMIT 50`).all();
  res.json({leaders});
});
app.get('/api/raffles', (req,res) => {
  const userId=String(req.session.user?.id||'');
  const raffles=db.prepare(`SELECT r.id,r.title,r.description,r.prize,r.end_at,r.status,r.winner_name,r.created_at,
    (SELECT COUNT(*) FROM raffle_entries e WHERE e.raffle_id=r.id) AS entries,
    EXISTS(SELECT 1 FROM raffle_entries e WHERE e.raffle_id=r.id AND e.user_id=?) AS entered
    FROM raffles r ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END,r.end_at DESC LIMIT 50`).all(userId);
  res.json({raffles});
});
app.post('/api/admin/raffles', requireAdmin, ensureCsrf, (req,res) => {
  const b=req.body||{}, title=safeText(b.title,100), description=safeText(b.description,500), prize=safeText(b.prize,150), endAt=new Date(b.end_at);
  if(!title||!prize||Number.isNaN(endAt.getTime())||endAt.getTime()<=Date.now()) return res.status(400).json({error:'Укажи приз, название и будущую дату завершения.'});
  const result=db.prepare('INSERT INTO raffles(title,description,prize,end_at,created_by) VALUES(?,?,?,?,?)').run(title,description,prize,endAt.toISOString(),String(req.session.user.id));
  logAction(req,'raffle.create',`raffle=${result.lastInsertRowid}`);
  res.status(201).json({ok:true,id:result.lastInsertRowid});
});
app.post('/api/raffles/:id/enter', requireLogin, ensureCsrf, (req,res) => {
  const raffle=db.prepare('SELECT id,status,end_at FROM raffles WHERE id=?').get(Number(req.params.id));
  if(!raffle||raffle.status!=='open'||new Date(raffle.end_at).getTime()<=Date.now()) return res.status(400).json({error:'Этот розыгрыш уже завершён.'});
  const user=req.session.user;
  const result=db.prepare('INSERT OR IGNORE INTO raffle_entries(raffle_id,user_id,username) VALUES(?,?,?)').run(raffle.id,String(user.id),safeText(user.username,100));
  res.status(result.changes?201:200).json({ok:true,entered:true});
});
app.delete('/api/raffles/:id/enter', requireLogin, ensureCsrf, (req,res) => {
  const raffle=db.prepare('SELECT id,status,end_at FROM raffles WHERE id=?').get(Number(req.params.id));
  if(!raffle||raffle.status!=='open'||new Date(raffle.end_at).getTime()<=Date.now()) return res.status(400).json({error:'Уже нельзя отменить участие в завершённом розыгрыше.'});
  db.prepare('DELETE FROM raffle_entries WHERE raffle_id=? AND user_id=?').run(raffle.id,String(req.session.user.id));
  res.json({ok:true,entered:false});
});
app.post('/api/admin/raffles/:id/draw', requireAdmin, ensureCsrf, (req,res) => {
  const raffle=db.prepare("SELECT id,status,end_at,title FROM raffles WHERE id=?").get(Number(req.params.id));
  if(!raffle) return res.status(404).json({error:'Розыгрыш не найден.'});
  if(raffle.status!=='open') return res.status(400).json({error:'Для этого розыгрыша победитель уже выбран.'});
  if(new Date(raffle.end_at).getTime()>Date.now()) return res.status(400).json({error:'Розыгрыш ещё не завершился.'});
  const entries=db.prepare('SELECT user_id,username FROM raffle_entries WHERE raffle_id=?').all(raffle.id);
  const winner=entries.length?entries[crypto.randomInt(entries.length)]:null;
  db.transaction(()=>db.prepare("UPDATE raffles SET status='ended',winner_user_id=?,winner_name=?,ended_at=datetime('now') WHERE id=? AND status='open'").run(winner?.user_id||null,winner?.username||null,raffle.id))();
  if(winner) createNotification(winner.user_id,'raffle','Ты выиграл розыгрыш',`${raffle.title}: ${winner.username} получил приз.`,'/raffles.html',`raffle:${raffle.id}:winner`);
  logAction(req,'raffle.draw',`raffle=${raffle.id}; entries=${entries.length}`);
  res.json({ok:true,winner:winner?.username||null,entries:entries.length});
});
app.post('/api/applications', (req, res) => {
  const body = req.body || {};
  if (!validateRequired(body, ['name', 'discord_tag', 'role', 'message'])) return res.status(400).json({ error: 'Заполните все поля.' });
  if (String(body.message).length > 1500) return res.status(400).json({ error: 'Сообщение слишком длинное (максимум 1500 символов).' });
  const result = db.prepare('INSERT INTO applications (name, discord_tag, role, message) VALUES (?, ?, ?, ?)')
    .run(safeText(body.name, 80), safeText(body.discord_tag, 100), safeText(body.role, 80), safeText(body.message, 1500));
  res.status(201).json({ ok: true, id: result.lastInsertRowid, message: 'Заявка отправлена. Спасибо!' });
});

// Member support: complaints and support tickets require Discord login.
app.post('/api/tickets', requireLogin, ensureCsrf, (req, res) => {
  const b = req.body || {};
  if (!validateRequired(b, ['subject', 'body'])) return res.status(400).json({ error: 'Укажите тему и сообщение.' });
  if (String(b.body).length > 3000) return res.status(400).json({ error: 'Сообщение слишком длинное (максимум 3000 символов).' });
  const category = ['support', 'complaint', 'report', 'other'].includes(b.category) ? b.category : 'support';
  const tx = db.transaction(() => {
    const r = db.prepare('INSERT INTO support_tickets (user_id, username, subject, category) VALUES (?, ?, ?, ?)')
      .run(String(req.session.user.id), safeText(req.session.user.username, 100), safeText(b.subject, 120), category);
    db.prepare('INSERT INTO ticket_messages (ticket_id, sender_id, sender_name, sender_role, body) VALUES (?, ?, ?, ?, ?)')
      .run(r.lastInsertRowid, String(req.session.user.id), safeText(req.session.user.username, 100), 'user', safeText(b.body, 3000));
    return Number(r.lastInsertRowid);
  });
  const id = tx();
  logAction(req, 'ticket.create', `ticket=${id}; category=${category}`);
  notifyDiscord(`Новое обращение #${id}: ${safeText(b.subject,120)} (${category})`).catch(()=>{});
  res.status(201).json({ ok: true, id, message: 'Обращение создано.' });
});
app.get('/api/tickets', requireLogin, (req, res) => {
  res.json(db.prepare('SELECT t.id,t.subject,t.category,t.status,t.priority,t.created_at,t.updated_at,(SELECT body FROM ticket_messages m WHERE m.ticket_id=t.id ORDER BY m.id DESC LIMIT 1) AS last_message FROM support_tickets t WHERE t.user_id=? ORDER BY t.updated_at DESC').all(String(req.session.user.id)));
});
app.get('/api/tickets/:id/messages', requireLogin, (req, res) => {
  const id = Number(req.params.id);
  const ticket = db.prepare('SELECT * FROM support_tickets WHERE id=? AND user_id=?').get(id, String(req.session.user.id));
  if (!ticket) return res.status(404).json({ error: 'Обращение не найдено.' });
  res.json({ ticket, messages: db.prepare('SELECT id,sender_id,sender_name,sender_role,body,created_at FROM ticket_messages WHERE ticket_id=? ORDER BY id ASC').all(id) });
});
app.post('/api/tickets/:id/messages', requireLogin, ensureCsrf, (req, res) => {
  const id = Number(req.params.id); const body = req.body || {};
  if (!validateRequired(body, ['body']) || String(body.body).length > 3000) return res.status(400).json({ error: 'Введите сообщение до 3000 символов.' });
  const ticket = db.prepare("SELECT * FROM support_tickets WHERE id=? AND user_id=? AND status!='closed'").get(id, String(req.session.user.id));
  if (!ticket) return res.status(404).json({ error: 'Обращение не найдено или закрыто.' });
  db.prepare('INSERT INTO ticket_messages (ticket_id,sender_id,sender_name,sender_role,body) VALUES (?,?,?,?,?)').run(id, String(req.session.user.id), safeText(req.session.user.username,100), 'user', safeText(body.body,3000));
  db.prepare("UPDATE support_tickets SET updated_at=datetime('now'), status=CASE WHEN status='answered' THEN 'open' ELSE status END WHERE id=?").run(id);
  logAction(req, 'ticket.message', `ticket=${id}`);
  res.status(201).json({ ok: true });
});

// Community profiles, achievements, event RSVPs, and moderated gallery.
async function getDiscordGuildMembership(userId) {
  const botToken = process.env.DISCORD_BOT_TOKEN;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!botToken || !guildId) return { status: 'not_configured', roles: [] };
  const headers = { Authorization: `Bot ${botToken}` };
  try {
    const [memberResponse, rolesResponse] = await Promise.all([
      fetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`, { headers, signal: AbortSignal.timeout(5000) }),
      fetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}/roles`, { headers, signal: AbortSignal.timeout(5000) })
    ]);
    if (memberResponse.status === 404) return { status: 'not_member', roles: [] };
    if (!memberResponse.ok || !rolesResponse.ok) return { status: 'error', roles: [] };
    const [member, serverRoles] = await Promise.all([memberResponse.json(), rolesResponse.json()]);
    const roleNames = new Map(serverRoles.map(role => [role.id, role.name]));
    const roles = (member.roles || []).filter(id => id !== guildId).map(id => ({ id, name: roleNames.get(id) || 'Роль сервера' }));
    return { status: 'ok', roles, joinedAt: member.joined_at || null };
  } catch {
    return { status: 'error', roles: [] };
  }
}
app.get('/api/profile', requireLogin, async (req, res) => {
  const u = req.session.user;
  let profile = db.prepare('SELECT * FROM profiles WHERE user_id=?').get(String(u.id));
  if (!profile) {
    db.prepare('INSERT OR IGNORE INTO profiles (user_id,username) VALUES (?,?)').run(String(u.id), safeText(u.username,100));
    profile = db.prepare('SELECT * FROM profiles WHERE user_id=?').get(String(u.id));
  }
  db.prepare("INSERT OR IGNORE INTO user_achievements (user_id,achievement_id) SELECT ?,id FROM achievements WHERE code='first_step'").run(String(u.id));
  syncUserAchievements(String(u.id), u.username);
  const guildMembership = await getDiscordGuildMembership(String(u.id));
  const achievements=db.prepare(`SELECT a.code,a.title,a.description,a.icon,ua.earned_at,
    CASE WHEN ua.user_id IS NULL THEN 0 ELSE 1 END AS unlocked
    FROM achievements a LEFT JOIN user_achievements ua ON ua.achievement_id=a.id AND ua.user_id=? ORDER BY a.id`).all(String(u.id));
  res.json({ profile, guildMembership, achievements });
});
app.put('/api/profile', requireLogin, ensureCsrf, (req,res) => {
  const b=req.body||{};
  if (typeof b.bio!=='string' || b.bio.length>240 || typeof b.favorite_games!=='string' || b.favorite_games.length>180 || typeof b.status_text!=='string' || b.status_text.length>80 || typeof b.avatar_url!=='string' || b.avatar_url.length>500) return res.status(400).json({error:'Проверь описание, игры, статус и ссылку на аватар.'});
  let avatarUrl='';
  if(b.avatar_url.trim()) { try { const parsed=new URL(b.avatar_url); if(parsed.protocol!=='https:') throw new Error(); avatarUrl=parsed.href; } catch { return res.status(400).json({error:'Аватар должен быть доступен по HTTPS-ссылке.'}); } }
  const u=req.session.user;
  const publicAchievements=b.achievements_public==='0'||b.achievements_public===false?0:1;
  db.prepare(`INSERT INTO profiles(user_id,username,bio,title,avatar_url,favorite_games,status_text,achievements_public,updated_at)
    VALUES(?,?,?,'Участник Miteria',?,?,?,?,datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,bio=excluded.bio,avatar_url=excluded.avatar_url,
    favorite_games=excluded.favorite_games,status_text=excluded.status_text,achievements_public=excluded.achievements_public,updated_at=datetime('now')`)
    .run(String(u.id),safeText(u.username,100),safeText(b.bio,240),avatarUrl,safeText(b.favorite_games,180),safeText(b.status_text,80),publicAchievements);
  db.prepare("INSERT OR IGNORE INTO user_achievements(user_id,achievement_id) SELECT ?,id FROM achievements WHERE code='community_voice'").run(String(u.id));
  logAction(req,'profile.update','profile updated'); res.json({ok:true});
});
// Find-company board: short-lived, member-authenticated requests with one response per member.
app.get('/api/company', (req,res) => {
  db.prepare("DELETE FROM company_posts WHERE expires_at < datetime('now') AND status='open'").run();
  const posts = db.prepare("SELECT p.id,p.username,p.activity,p.details,p.game,p.available_at,p.created_at,p.expires_at,(SELECT COUNT(*) FROM company_responses r WHERE r.post_id=p.id) AS responses, EXISTS(SELECT 1 FROM company_responses r WHERE r.post_id=p.id AND r.user_id=?) AS responded FROM company_posts p WHERE p.status='open' ORDER BY p.id DESC LIMIT 40").all(String(req.session.user?.id || ''));
  res.json({posts});
});
app.post('/api/company', requireLogin, ensureCsrf, (req,res) => {
  const b=req.body||{};
  if(!validateRequired(b,['activity']) || String(b.activity).length>60 || String(b.details||'').length>400 || String(b.game||'').length>80) return res.status(400).json({error:'Укажите занятие (до 60 символов), описание (до 400) и игру (до 80).'});
  let availableAt = null;
  if (b.available_at) {
    const date = new Date(b.available_at);
    if (Number.isNaN(date.getTime()) || date.getTime() < Date.now()) return res.status(400).json({error:'Укажи корректное будущее время.'});
    availableAt = date.toISOString();
  }
  const activity=safeText(b.activity,60), details=safeText(b.details||'',400), game=safeText(b.game||'',80), u=req.session.user;
  const recent=db.prepare("SELECT COUNT(*) n FROM company_posts WHERE user_id=? AND created_at > datetime('now','-30 minutes')").get(String(u.id)).n;
  if(recent>=3) return res.status(429).json({error:'Можно создать не больше 3 запросов за 30 минут.'});
  const r=db.prepare("INSERT INTO company_posts(user_id,username,activity,details,game,available_at,expires_at) VALUES(?,?,?,?,?,?,datetime('now','+12 hours'))").run(String(u.id),safeText(u.username,100),activity,details,game,availableAt);
  syncUserAchievements(String(u.id), u.username);
  logAction(req,'company.create',`post=${r.lastInsertRowid}`); res.status(201).json({ok:true,id:r.lastInsertRowid});
});
app.post('/api/company/:id/respond', requireLogin, ensureCsrf, (req,res) => {
  const id=Number(req.params.id), u=req.session.user;
  const post=db.prepare("SELECT id,user_id,username,activity FROM company_posts WHERE id=? AND status='open' AND expires_at>datetime('now')").get(id);
  if(!post) return res.status(404).json({error:'Запрос уже закрыт или истёк.'});
  if(post.user_id===String(u.id)) return res.status(400).json({error:'На собственный запрос откликнуться нельзя.'});
  const message=safeText(req.body?.message||'',160);
  const response=db.prepare('INSERT OR IGNORE INTO company_responses(post_id,user_id,username,message) VALUES(?,?,?,?)').run(id,String(u.id),safeText(u.username,100),message);
  if(!response.changes) return res.status(409).json({error:'Ты уже откликался на этот запрос.'});
  createNotification(post.user_id,'company','Новый отклик на поиск компании',`${safeText(u.username,100)} откликнулся: ${post.activity}.`,'/company.html',`company:${id}:response:${u.id}`);
  res.status(201).json({ok:true,message:'Отклик сохранён. Напиши участнику в Discord, чтобы договориться.'});
});

app.post('/api/events/:id/rsvp', requireLogin, ensureCsrf, (req,res) => {
  const id=Number(req.params.id); const ev=db.prepare("SELECT id,event_date,status FROM events WHERE id=? AND status!='cancelled'").get(id);
  if(!ev) return res.status(404).json({error:'Событие не найдено.'});
  if(new Date(ev.event_date).getTime()<Date.now()) return res.status(400).json({error:'Регистрация на прошедшее событие закрыта.'});
  const u=req.session.user;
  db.prepare('INSERT OR IGNORE INTO event_rsvps(event_id,user_id,username) VALUES(?,?,?)').run(id,String(u.id),safeText(u.username,100));
  db.prepare("INSERT OR IGNORE INTO user_achievements(user_id,achievement_id) SELECT ?,id FROM achievements WHERE code='event_guest'").run(String(u.id));
  syncUserAchievements(String(u.id), u.username);
  res.status(201).json({ok:true});
});
app.delete('/api/events/:id/rsvp', requireLogin, ensureCsrf, (req,res) => {
  const eventId = Number(req.params.id);
  const result = db.prepare('DELETE FROM event_rsvps WHERE event_id=? AND user_id=?').run(eventId,String(req.session.user.id));
  if (!result.changes) return res.status(404).json({error:'Запись на это событие не найдена.'});
  res.json({ok:true});
});
app.post('/api/gallery', requireLogin, ensureCsrf, (req,res) => {
  const b=req.body||{};
  if(!validateRequired(b,['title','image_url']) || String(b.title).length>100 || String(b.description||'').length>500) return res.status(400).json({error:'Укажите название (до 100 символов) и описание (до 500).'});
  const category = ['Аниме','Арт','Игры','Скриншоты','Другое'].includes(b.category) ? b.category : 'Другое';
  let url; try { url=new URL(String(b.image_url)); } catch { return res.status(400).json({error:'Укажите корректный URL изображения.'}); }
  if(!['https:'].includes(url.protocol) || !/\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(url.pathname+url.search)) return res.status(400).json({error:'Разрешены только HTTPS-ссылки на изображения PNG, JPG, WEBP или GIF.'});
  const u=req.session.user;
  const r=db.prepare('INSERT INTO gallery_items(user_id,username,title,image_url,description,category) VALUES(?,?,?,?,?,?)').run(String(u.id),safeText(u.username,100),safeText(b.title,100),url.href,safeText(b.description,500),category);
  logAction(req,'gallery.submit',`item=${r.lastInsertRowid}`); res.status(201).json({ok:true,message:'Работа отправлена на модерацию.'});
});
app.post('/api/gallery/upload', requireLogin, ensureCsrf, express.raw({ type: Object.keys(GALLERY_IMAGE_TYPES), limit: '5mb' }), (req,res) => {
  const title = String(req.query.title || '');
  const description = String(req.query.description || '');
  const category = ['Аниме','Арт','Игры','Скриншоты','Другое'].includes(req.query.category) ? req.query.category : 'Другое';
  const mime = String(req.get('content-type') || '').split(';')[0].toLowerCase();
  const ext = GALLERY_IMAGE_TYPES[mime];
  const image = req.body;
  if (!ext || !Buffer.isBuffer(image) || image.length === 0 || title.trim().length === 0 || title.length > 100 || description.length > 500) {
    return res.status(400).json({ error: 'Добавь картинку JPG, PNG, WEBP или GIF до 5 МБ и укажи название до 100 символов.' });
  }
  const validSignature = mime === 'image/jpeg' ? image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff
    : mime === 'image/png' ? image.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))
    : mime === 'image/webp' ? image.toString('ascii', 0, 4) === 'RIFF' && image.toString('ascii', 8, 12) === 'WEBP'
    : image.toString('ascii', 0, 3) === 'GIF';
  if (!validSignature) return res.status(400).json({ error: 'Файл не похож на выбранный формат изображения.' });
  const filename = `${crypto.randomUUID()}.${ext}`;
  const filePath = path.join(GALLERY_DIR, filename);
  try {
    fs.writeFileSync(filePath, image, { flag: 'wx' });
    const u = req.session.user;
    const imageUrl = `/gallery-files/${filename}`;
    const result = db.prepare('INSERT INTO gallery_items(user_id,username,title,image_url,description,category) VALUES(?,?,?,?,?,?)')
      .run(String(u.id), safeText(u.username,100), safeText(title,100), imageUrl, safeText(description,500), category);
    logAction(req, 'gallery.submit', `item=${result.lastInsertRowid}; uploaded image`);
    return res.status(201).json({ ok: true, message: 'Картинка загружена и отправлена на модерацию.' });
  } catch {
    try { fs.unlinkSync(filePath); } catch { /* No file to clean up. */ }
    return res.status(500).json({ error: 'Не удалось сохранить картинку. Попробуй ещё раз.' });
  }
});
app.get('/api/gallery/:id/comments', (req,res) => {
  const id=Number(req.params.id);
  if(!db.prepare("SELECT 1 FROM gallery_items WHERE id=? AND status='approved'").get(id)) return res.status(404).json({error:'Работа не найдена.'});
  const userId=String(req.session.user?.id||'');
  res.json({comments:db.prepare('SELECT id,user_id,username,body,created_at FROM gallery_comments WHERE item_id=? ORDER BY id DESC LIMIT 100').all(id).reverse().map(({user_id,...comment})=>({...comment,own:Boolean(userId&&user_id===userId)}))});
});
app.post('/api/gallery/:id/comments', requireLogin, ensureCsrf, (req,res) => {
  const id=Number(req.params.id), body=safeText(req.body?.body,500), user=req.session.user;
  if(!body) return res.status(400).json({error:'Комментарий не может быть пустым.'});
  const item=db.prepare("SELECT user_id,title FROM gallery_items WHERE id=? AND status='approved'").get(id);
  if(!item) return res.status(404).json({error:'Работа не найдена.'});
  const result=db.prepare('INSERT INTO gallery_comments(item_id,user_id,username,body) VALUES(?,?,?,?)').run(id,String(user.id),safeText(user.username,100),body);
  createNotification(item.user_id,'gallery','Новый комментарий',`${safeText(user.username,100)} прокомментировал работу «${item.title}».`,'/gallery.html',`gallery-comment:${result.lastInsertRowid}`);
  res.status(201).json({ok:true,id:result.lastInsertRowid});
});
for(const [action,table] of [['like','gallery_likes'],['save','gallery_saves']]) app.post(`/api/gallery/:id/${action}`, requireLogin, ensureCsrf, (req,res) => {
  const id=Number(req.params.id), userId=String(req.session.user.id);
  if(!db.prepare("SELECT 1 FROM gallery_items WHERE id=? AND status='approved'").get(id)) return res.status(404).json({error:'Работа не найдена.'});
  const exists=db.prepare(`SELECT 1 FROM ${table} WHERE item_id=? AND user_id=?`).get(id,userId);
  if(exists) db.prepare(`DELETE FROM ${table} WHERE item_id=? AND user_id=?`).run(id,userId);
  else db.prepare(`INSERT OR IGNORE INTO ${table}(item_id,user_id) VALUES(?,?)`).run(id,userId);
  const count=db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE item_id=?`).get(id).count;
  res.json({active:!exists,count});
});
app.post('/api/reports', requireLogin, ensureCsrf, (req,res) => {
  const {kind,target_id}=req.body||{}, id=Number(target_id), reason=safeText(req.body?.reason,300), user=req.session.user;
  if(!['chat','gallery','comment'].includes(kind)||!Number.isInteger(id)||id<1||reason.length<5) return res.status(400).json({error:'Выбери причину и укажи подробности (не меньше 5 символов).'});
  let target;
  if(kind==='chat') target=db.prepare('SELECT user_id,username,body FROM chat_messages WHERE id=?').get(id);
  if(kind==='gallery') target=db.prepare("SELECT user_id,username,title||' — '||description AS body FROM gallery_items WHERE id=? AND status='approved'").get(id);
  if(kind==='comment') target=db.prepare('SELECT user_id,username,body FROM gallery_comments WHERE id=?').get(id);
  if(!target) return res.status(404).json({error:'Материал не найден.'});
  if(String(target.user_id)===String(user.id)) return res.status(400).json({error:'Нельзя пожаловаться на свой материал.'});
  try {
    db.prepare('INSERT INTO content_reports(kind,target_id,target_user_id,target_name,content,reporter_id,reporter_name,reason) VALUES(?,?,?,?,?,?,?,?)')
      .run(kind,id,String(target.user_id),safeText(target.username,100),safeText(target.body,500),String(user.id),safeText(user.username,100),reason);
  } catch(error) { if(String(error.code).startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({error:'Жалоба на этот материал уже отправлена.'}); throw error; }
  logAction(req,'content.report',`kind=${kind}; target=${id}`);
  res.status(201).json({ok:true});
});
app.get('/api/admin/reports', requireAdmin, (req,res) => res.json(db.prepare("SELECT * FROM content_reports WHERE status='open' ORDER BY id DESC LIMIT 200").all()));
app.patch('/api/admin/reports/:id', requireAdmin, ensureCsrf, (req,res) => {
  const status=String(req.body?.status||''); if(!['resolved','dismissed'].includes(status)) return res.status(400).json({error:'Недопустимый статус.'});
  const result=db.prepare('UPDATE content_reports SET status=? WHERE id=?').run(status,Number(req.params.id));
  if(!result.changes) return res.status(404).json({error:'Жалоба не найдена.'});
  logAction(req,'report.resolve',`report=${req.params.id}; status=${status}`);res.json({ok:true});
});
app.get('/api/admin/chat-mutes', requireAdmin, (req,res) => res.json(db.prepare("SELECT * FROM chat_mutes WHERE datetime(expires_at)>datetime('now') ORDER BY expires_at").all()));
app.post('/api/admin/chat-mutes', requireAdmin, ensureCsrf, (req,res) => {
  const userId=safeText(req.body?.user_id,32), duration=Number(req.body?.duration_minutes), reason=safeText(req.body?.reason,240);
  if(!/^\d{15,22}$/.test(userId)||!Number.isInteger(duration)||duration<1||duration>10080) return res.status(400).json({error:'Укажи Discord ID и срок от 1 минуты до 7 дней.'});
  const target=db.prepare('SELECT username FROM chat_messages WHERE user_id=? ORDER BY id DESC LIMIT 1').get(userId);
  const username=target?.username||userId, expiresAt=new Date(Date.now()+duration*60_000).toISOString();
  db.prepare(`INSERT INTO chat_mutes(user_id,username,reason,expires_at,set_by) VALUES(?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,reason=excluded.reason,expires_at=excluded.expires_at,set_by=excluded.set_by,created_at=datetime('now')`)
    .run(userId,username,reason||'Нарушение правил чата',expiresAt,String(req.session.user.id));
  logAction(req,'chat.mute',`user=${userId}; minutes=${duration}`);res.status(201).json({ok:true});
});
app.delete('/api/admin/chat-mutes/:userId', requireAdmin, ensureCsrf, (req,res) => {
  const result=db.prepare('DELETE FROM chat_mutes WHERE user_id=?').run(safeText(req.params.userId,32));
  if(!result.changes) return res.status(404).json({error:'Активное ограничение не найдено.'});
  logAction(req,'chat.unmute',`user=${req.params.userId}`);res.json({ok:true});
});
app.get('/api/admin/gallery', requireAdmin, (req,res)=>res.json(db.prepare('SELECT * FROM gallery_items ORDER BY CASE status WHEN \'pending\' THEN 0 ELSE 1 END,id DESC LIMIT 300').all()));
app.patch('/api/admin/gallery/:id', requireAdmin, ensureCsrf, (req,res)=>{
  const status=String(req.body?.status||''); if(!['approved','rejected','pending'].includes(status)) return res.status(400).json({error:'Недопустимый статус.'});
  const r=db.prepare('UPDATE gallery_items SET status=? WHERE id=?').run(status,Number(req.params.id)); if(!r.changes) return res.status(404).json({error:'Работа не найдена.'});
  if(status==='approved'){const item=db.prepare('SELECT user_id,username FROM gallery_items WHERE id=?').get(Number(req.params.id));db.prepare("INSERT OR IGNORE INTO user_achievements(user_id,achievement_id) SELECT ?,id FROM achievements WHERE code='gallery_artist'").run(item.user_id);syncUserAchievements(String(item.user_id), item.username);}
  logAction(req,'gallery.moderate',`item=${req.params.id}; status=${status}`); res.json({ok:true});
});
app.get('/api/admin/analytics', requireAdmin, (req,res)=>{
 const daily=db.prepare("SELECT substr(created_at,1,10) day, count(*) count FROM system_logs WHERE created_at >= datetime('now','-13 days') GROUP BY substr(created_at,1,10) ORDER BY day").all();
 res.json({daily, tickets:db.prepare("SELECT status,count(*) count FROM support_tickets GROUP BY status").all(), applications:db.prepare("SELECT status,count(*) count FROM applications GROUP BY status").all(), gallery:db.prepare("SELECT status,count(*) count FROM gallery_items GROUP BY status").all(), eventRsvps:db.prepare('SELECT count(*) count FROM event_rsvps').get().count});
});
app.get('/api/admin/discord-status', requireAdmin, async (req,res)=>{
 const configured=Boolean(process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_GUILD_ID);
 if(!configured) return res.json({configured:false,ok:false,message:'Добавьте DISCORD_BOT_TOKEN и DISCORD_GUILD_ID в переменные Railway.'});
 const stats=await getDiscordServerStats();
 if(stats.source!=='bot') return res.json({configured:true,ok:false,message:'Бот не смог прочитать сервер. Проверь DISCORD_BOT_TOKEN и DISCORD_GUILD_ID.'});
 res.json({configured:true,ok:true,...stats});
});

app.get('/auth/discord', (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = process.env.DISCORD_REDIRECT_URI || `${SITE_URL}/auth/discord/callback`;
  if (!clientId || !process.env.DISCORD_CLIENT_SECRET) return res.status(503).send('Discord OAuth2 не настроен. Заполните .env по инструкции.');
  const state = crypto.randomBytes(24).toString('hex');
  req.session.oauthState = state;
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'identify', state });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});
app.get('/auth/discord/callback', async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.redirect('/?login=cancelled');
  if (!code || typeof code !== 'string' || !state || typeof state !== 'string' || !req.session.oauthState || state !== req.session.oauthState) {
    delete req.session.oauthState;
    return res.status(400).send('OAuth2 state check failed. Return to the site and try again.');
  }
  delete req.session.oauthState;
  try {
    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.DISCORD_REDIRECT_URI || `${SITE_URL}/auth/discord/callback`
    });
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params,
      signal: AbortSignal.timeout(7000)
    });
    if (!tokenRes.ok) throw new Error('Token exchange failed');
    const token = await tokenRes.json();
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(7000)
    });
    if (!userRes.ok) throw new Error('Discord user lookup failed');
    const u = await userRes.json();
    await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
    req.session.user = { id: String(u.id), username: safeText(u.global_name || u.username, 100), avatar: u.avatar || null };
    req.session.csrf = crypto.randomBytes(32).toString('hex');
    res.redirect(adminIds.has(String(u.id)) ? '/admin.html' : '/?login=success');
  } catch (err) {
    console.error('Discord OAuth error:', err.message);
    res.redirect('/?login=error');
  }
});
app.post('/auth/logout', requireLogin, ensureCsrf, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/admin/summary', requireAdmin, (req, res) => {
  res.json({
    news: db.prepare('SELECT COUNT(*) AS n FROM news').get().n,
    events: db.prepare("SELECT COUNT(*) AS n FROM events WHERE status != 'cancelled'").get().n,
    newApplications: db.prepare("SELECT COUNT(*) AS n FROM applications WHERE status = 'new'").get().n,
    totalApplications: db.prepare('SELECT COUNT(*) AS n FROM applications').get().n,
    openTickets: db.prepare("SELECT COUNT(*) AS n FROM support_tickets WHERE status != 'closed'").get().n,
    logs: db.prepare('SELECT id, actor_name, action, details, ip, created_at FROM audit_logs ORDER BY id DESC LIMIT 30').all()
  });
});
app.get('/api/admin/news', requireAdmin, (req, res) => res.json(db.prepare('SELECT * FROM news ORDER BY id DESC').all()));
app.post('/api/admin/news', requireAdmin, ensureCsrf, (req, res) => {
  const b = req.body || {};
  if (!validateRequired(b, ['title', 'body'])) return res.status(400).json({ error: 'Нужны заголовок и текст.' });
  const r = db.prepare('INSERT INTO news (title, body) VALUES (?, ?)').run(safeText(b.title, 120), safeText(b.body, 4000));
  logAction(req, 'news.create', `id=${r.lastInsertRowid}; title=${safeText(b.title, 120)}`);
  res.status(201).json({ ok: true });
});
app.delete('/api/admin/news/:id', requireAdmin, ensureCsrf, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Некорректный ID.' });
  db.prepare('DELETE FROM news WHERE id = ?').run(id);
  logAction(req, 'news.delete', `id=${id}`);
  res.json({ ok: true });
});
app.get('/api/admin/events', requireAdmin, (req, res) => res.json(db.prepare('SELECT * FROM events ORDER BY event_date ASC').all()));
app.post('/api/admin/events', requireAdmin, ensureCsrf, (req, res) => {
  const b = req.body || {};
  if (!validateRequired(b, ['title', 'description', 'event_date'])) return res.status(400).json({ error: 'Нужны название, описание и дата.' });
  const date = new Date(b.event_date);
  if (Number.isNaN(date.getTime())) return res.status(400).json({ error: 'Некорректная дата.' });
  const r = db.prepare('INSERT INTO events (title, description, event_date, location) VALUES (?, ?, ?, ?)')
    .run(safeText(b.title, 120), safeText(b.description, 2000), date.toISOString(), safeText(b.location || 'Discord', 120));
  logAction(req, 'event.create', `id=${r.lastInsertRowid}; title=${safeText(b.title, 120)}`);
  notifyDiscord(`Новое событие Miteria: ${safeText(b.title,120)} — ${date.toISOString()}`).catch(()=>{});
  res.status(201).json({ ok: true });
});
app.delete('/api/admin/events/:id', requireAdmin, ensureCsrf, (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Некорректный ID.' });
  db.prepare('UPDATE events SET status = ? WHERE id = ?').run('cancelled', id);
  logAction(req, 'event.cancel', `id=${id}`);
  res.json({ ok: true });
});
app.get('/api/admin/applications', requireAdmin, (req, res) => res.json(db.prepare('SELECT * FROM applications ORDER BY id DESC LIMIT 200').all()));
app.patch('/api/admin/applications/:id', requireAdmin, ensureCsrf, (req, res) => {
  const id = Number(req.params.id);
  const status = safeText(req.body?.status, 20);
  if (!Number.isInteger(id) || id < 1 || !['new', 'reviewing', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Некорректные данные.' });
  db.prepare('UPDATE applications SET status = ? WHERE id = ?').run(status, id);
  logAction(req, 'application.status', `id=${id}; status=${status}`);
  res.json({ ok: true });
});
app.get('/api/admin/tickets', requireAdmin, (req, res) => res.json(db.prepare("SELECT t.*, (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id=t.id) AS message_count FROM support_tickets t ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'answered' THEN 1 ELSE 2 END, t.updated_at DESC LIMIT 300").all()));
app.get('/api/admin/tickets/:id/messages', requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const ticket = db.prepare('SELECT * FROM support_tickets WHERE id=?').get(id);
  if (!ticket) return res.status(404).json({ error: 'Тикет не найден.' });
  res.json({ ticket, messages: db.prepare('SELECT * FROM ticket_messages WHERE ticket_id=? ORDER BY id ASC').all(id) });
});
app.post('/api/admin/tickets/:id/messages', requireAdmin, ensureCsrf, (req, res) => {
  const id = Number(req.params.id); const body = req.body || {};
  if (!validateRequired(body, ['body']) || String(body.body).length > 3000) return res.status(400).json({ error: 'Введите ответ до 3000 символов.' });
  const ticket = db.prepare('SELECT * FROM support_tickets WHERE id=?').get(id);
  if (!ticket) return res.status(404).json({ error: 'Тикет не найден.' });
  const u=req.session.user;
  db.prepare('INSERT INTO ticket_messages (ticket_id,sender_id,sender_name,sender_role,body) VALUES (?,?,?,?,?)').run(id,String(u.id),safeText(u.username,100),'staff',safeText(body.body,3000));
  db.prepare("UPDATE support_tickets SET updated_at=datetime('now'), status=CASE WHEN status='closed' THEN 'closed' ELSE 'answered' END WHERE id=?").run(id);
  createNotification(ticket.user_id,'support','Ответ поддержки',`Новое сообщение в обращении «${ticket.subject}».`,'/support.html',`ticket:${id}:reply:${Date.now()}`);
  logAction(req, 'ticket.reply', `ticket=${id}`);
  res.status(201).json({ ok: true });
});
app.patch('/api/admin/tickets/:id', requireAdmin, ensureCsrf, (req, res) => {
  const id=Number(req.params.id), status=safeText(req.body?.status,20), priority=safeText(req.body?.priority,20);
  if (!Number.isInteger(id)||id<1||!['open','answered','closed'].includes(status)||!['low','normal','high'].includes(priority)) return res.status(400).json({error:'Некорректный статус или приоритет.'});
  const r=db.prepare("UPDATE support_tickets SET status=?,priority=?,updated_at=datetime('now') WHERE id=?").run(status,priority,id);
  if(!r.changes) return res.status(404).json({error:'Тикет не найден.'});
  logAction(req,'ticket.update',`ticket=${id}; status=${status}; priority=${priority}`);
  res.json({ok:true});
});
app.get('/api/admin/system-logs', requireAdmin, (req, res) => res.json(db.prepare('SELECT * FROM system_logs ORDER BY id DESC LIMIT 300').all()));
app.get('/api/admin/logs', requireAdmin, (req, res) => res.json(db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200').all()));
app.get('/api/admin/backup', requireAdmin, ensureCsrf, (req, res) => {
  const dir = path.join(__dirname, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `miteria-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`;
  const target = path.join(dir, filename);
  db.backup(target).then(() => {
    logAction(req, 'backup.create', filename);
    res.download(target, filename);
  }).catch(() => res.status(500).json({ error: 'Не удалось создать резервную копию.' }));
});

app.use('/gallery-files', express.static(GALLERY_DIR, { dotfiles: 'deny', index: false, maxAge: isProduction ? '1d' : 0, immutable: isProduction }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: isProduction ? '1h' : 0 }));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('*', (req, res) => res.status(404).sendFile(path.join(__dirname, 'public', '404.html')));

app.listen(PORT, () => console.log(`Miteria is running at ${SITE_URL} (port ${PORT})`));
