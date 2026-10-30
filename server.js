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
const DB_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DB_DIR, { recursive: true });

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
  title TEXT NOT NULL, image_url TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS company_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, username TEXT NOT NULL,
  activity TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', game TEXT NOT NULL DEFAULT '',
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
`);
const seedNews = db.prepare('SELECT COUNT(*) AS n FROM news').get().n;
if (!seedNews) {
  db.prepare('INSERT INTO news (title, body) VALUES (?, ?)').run('Добро пожаловать в Yushiko!', 'Мы рады видеть тебя в нашем сообществе. Знакомься, общайся и участвуй в событиях.');
  db.prepare('INSERT INTO news (title, body) VALUES (?, ?)').run('Сайт обновлён', 'Теперь новости, мероприятия и заявки можно управлять через панель администратора.');
}
const seedEvents = db.prepare('SELECT COUNT(*) AS n FROM events').get().n;
if (!seedEvents) {
  db.prepare('INSERT INTO events (title, description, event_date, location) VALUES (?, ?, ?, ?)').run('Вечер сообщества', 'Знакомимся, общаемся и играем вместе.', new Date(Date.now() + 7*86400000).toISOString(), 'Discord');
}

const seedAchievements = [
  ['first_step','Первый шаг','Присоединился к пространству Yushiko','✿'],
  ['community_voice','Голос сообщества','Заполнил профиль участника','☾'],
  ['gallery_artist','Творец','Работа опубликована в галерее','✦'],
  ['event_guest','Гость события','Записался на мероприятие','❋']
];
const insertAchievement = db.prepare('INSERT OR IGNORE INTO achievements (code,title,description,icon) VALUES (?,?,?,?)');
for (const item of seedAchievements) insertAchievement.run(...item);

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
function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Требуется вход через Discord.' });
  if (!adminIds.has(req.session.user.id)) return res.status(403).json({ error: 'Нет доступа к панели администратора.' });
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
function validateRequired(body, fields) {
  return fields.every(f => typeof body[f] === 'string' && body[f].trim().length > 0);
}
async function notifyDiscord(content) {
  if (!process.env.DISCORD_WEBHOOK_URL) return;
  const url = new URL(process.env.DISCORD_WEBHOOK_URL); if (url.protocol !== 'https:') return;
  await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({content:String(content).slice(0,1800)}), signal:AbortSignal.timeout(3500) });
}

app.get('/api/me', (req, res) => {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(32).toString('hex');
  res.json({ user: userView(req), csrfToken: req.session.csrf });
});
app.get('/api/public', async (req, res) => {
  let discord = { members: null, online: null, source: 'unavailable' };
  if (process.env.DISCORD_WIDGET_ENABLED === 'true' && process.env.DISCORD_GUILD_ID) {
    try {
      const response = await fetch(`https://discord.com/api/guilds/${encodeURIComponent(process.env.DISCORD_GUILD_ID)}/widget.json`, { signal: AbortSignal.timeout(3500) });
      if (response.ok) {
        const data = await response.json();
        discord = { members: Array.isArray(data.members) ? null : (data.presence_count ?? null), online: data.presence_count ?? null, source: 'widget' };
        // Widget API exposes online presence, not a reliable total member count.
      }
    } catch { /* Keep the public page usable if Discord widget is disabled/unavailable. */ }
  }
  res.json({
    inviteUrl,
    discord,
    news: db.prepare('SELECT id, title, body, created_at FROM news ORDER BY id DESC LIMIT 6').all(),
    company: db.prepare("SELECT p.id,p.username,p.activity,p.details,p.game,p.created_at,p.expires_at,(SELECT COUNT(*) FROM company_responses r WHERE r.post_id=p.id) AS responses FROM company_posts p WHERE p.status='open' AND p.expires_at>datetime('now') ORDER BY p.id DESC LIMIT 8").all(),
    events: db.prepare("SELECT e.id, e.title, e.description, e.event_date, e.location, e.status, (SELECT COUNT(*) FROM event_rsvps r WHERE r.event_id=e.id) AS attendees FROM events e WHERE e.status != 'cancelled' ORDER BY e.event_date ASC LIMIT 24").all(),
    gallery: db.prepare("SELECT id,username,title,image_url,description,created_at FROM gallery_items WHERE status='approved' ORDER BY id DESC LIMIT 12").all(),
    achievements: db.prepare('SELECT code,title,description,icon FROM achievements ORDER BY id').all()
  });
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
app.get('/api/profile', requireLogin, (req, res) => {
  const u = req.session.user;
  let profile = db.prepare('SELECT * FROM profiles WHERE user_id=?').get(String(u.id));
  if (!profile) {
    db.prepare('INSERT OR IGNORE INTO profiles (user_id,username) VALUES (?,?)').run(String(u.id), safeText(u.username,100));
    profile = db.prepare('SELECT * FROM profiles WHERE user_id=?').get(String(u.id));
  }
  db.prepare("INSERT OR IGNORE INTO user_achievements (user_id,achievement_id) SELECT ?,id FROM achievements WHERE code='first_step'").run(String(u.id));
  res.json({ profile, achievements: db.prepare('SELECT a.code,a.title,a.description,a.icon,ua.earned_at FROM user_achievements ua JOIN achievements a ON a.id=ua.achievement_id WHERE ua.user_id=? ORDER BY ua.earned_at').all(String(u.id)) });
});
app.put('/api/profile', requireLogin, ensureCsrf, (req,res) => {
  const b=req.body||{};
  if (typeof b.bio!=='string' || b.bio.length>240 || typeof b.title!=='string' || b.title.length>40) return res.status(400).json({error:'Описание — до 240 символов, титул — до 40.'});
  const u=req.session.user;
  db.prepare("INSERT INTO profiles(user_id,username,bio,title,updated_at) VALUES(?,?,?,?,datetime('now')) ON CONFLICT(user_id) DO UPDATE SET username=excluded.username,bio=excluded.bio,title=excluded.title,updated_at=datetime('now')").run(String(u.id),safeText(u.username,100),safeText(b.bio,240),safeText(b.title,40));
  db.prepare("INSERT OR IGNORE INTO user_achievements(user_id,achievement_id) SELECT ?,id FROM achievements WHERE code='community_voice'").run(String(u.id));
  logAction(req,'profile.update','profile updated'); res.json({ok:true});
});
// Find-company board: short-lived, member-authenticated requests with one response per member.
app.get('/api/company', (req,res) => {
  db.prepare("DELETE FROM company_posts WHERE expires_at < datetime('now') AND status='open'").run();
  const posts = db.prepare("SELECT p.id,p.username,p.activity,p.details,p.game,p.created_at,p.expires_at,(SELECT COUNT(*) FROM company_responses r WHERE r.post_id=p.id) AS responses, EXISTS(SELECT 1 FROM company_responses r WHERE r.post_id=p.id AND r.user_id=?) AS responded FROM company_posts p WHERE p.status='open' ORDER BY p.id DESC LIMIT 40").all(String(req.session.user?.id || ''));
  res.json({posts});
});
app.post('/api/company', requireLogin, ensureCsrf, (req,res) => {
  const b=req.body||{};
  if(!validateRequired(b,['activity']) || String(b.activity).length>60 || String(b.details||'').length>400 || String(b.game||'').length>80) return res.status(400).json({error:'Укажите занятие (до 60 символов), описание (до 400) и игру (до 80).'});
  const activity=safeText(b.activity,60), details=safeText(b.details||'',400), game=safeText(b.game||'',80), u=req.session.user;
  const recent=db.prepare("SELECT COUNT(*) n FROM company_posts WHERE user_id=? AND created_at > datetime('now','-30 minutes')").get(String(u.id)).n;
  if(recent>=3) return res.status(429).json({error:'Можно создать не больше 3 запросов за 30 минут.'});
  const r=db.prepare("INSERT INTO company_posts(user_id,username,activity,details,game,expires_at) VALUES(?,?,?,?,?,datetime('now','+12 hours'))").run(String(u.id),safeText(u.username,100),activity,details,game);
  logAction(req,'company.create',`post=${r.lastInsertRowid}`); res.status(201).json({ok:true,id:r.lastInsertRowid});
});
app.post('/api/company/:id/respond', requireLogin, ensureCsrf, (req,res) => {
  const id=Number(req.params.id), u=req.session.user;
  const post=db.prepare("SELECT id,user_id FROM company_posts WHERE id=? AND status='open' AND expires_at>datetime('now')").get(id);
  if(!post) return res.status(404).json({error:'Запрос уже закрыт или истёк.'});
  if(post.user_id===String(u.id)) return res.status(400).json({error:'На собственный запрос откликнуться нельзя.'});
  const message=safeText(req.body?.message||'',160);
  db.prepare('INSERT OR IGNORE INTO company_responses(post_id,user_id,username,message) VALUES(?,?,?,?)').run(id,String(u.id),safeText(u.username,100),message);
  res.status(201).json({ok:true,message:'Отклик сохранён. Напиши участнику в Discord, чтобы договориться.'});
});

app.post('/api/events/:id/rsvp', requireLogin, ensureCsrf, (req,res) => {
  const id=Number(req.params.id); const ev=db.prepare("SELECT id,event_date,status FROM events WHERE id=? AND status!='cancelled'").get(id);
  if(!ev) return res.status(404).json({error:'Событие не найдено.'});
  if(new Date(ev.event_date).getTime()<Date.now()) return res.status(400).json({error:'Регистрация на прошедшее событие закрыта.'});
  const u=req.session.user;
  db.prepare('INSERT OR IGNORE INTO event_rsvps(event_id,user_id,username) VALUES(?,?,?)').run(id,String(u.id),safeText(u.username,100));
  db.prepare("INSERT OR IGNORE INTO user_achievements(user_id,achievement_id) SELECT ?,id FROM achievements WHERE code='event_guest'").run(String(u.id));
  res.status(201).json({ok:true});
});
app.post('/api/gallery', requireLogin, ensureCsrf, (req,res) => {
  const b=req.body||{};
  if(!validateRequired(b,['title','image_url']) || String(b.title).length>100 || String(b.description||'').length>500) return res.status(400).json({error:'Укажите название (до 100 символов) и описание (до 500).'});
  let url; try { url=new URL(String(b.image_url)); } catch { return res.status(400).json({error:'Укажите корректный URL изображения.'}); }
  if(!['https:'].includes(url.protocol) || !/\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(url.pathname+url.search)) return res.status(400).json({error:'Разрешены только HTTPS-ссылки на изображения PNG, JPG, WEBP или GIF.'});
  const u=req.session.user;
  const r=db.prepare('INSERT INTO gallery_items(user_id,username,title,image_url,description) VALUES(?,?,?,?,?)').run(String(u.id),safeText(u.username,100),safeText(b.title,100),url.href,safeText(b.description,500));
  logAction(req,'gallery.submit',`item=${r.lastInsertRowid}`); res.status(201).json({ok:true,message:'Работа отправлена на модерацию.'});
});
app.get('/api/admin/gallery', requireAdmin, (req,res)=>res.json(db.prepare('SELECT * FROM gallery_items ORDER BY CASE status WHEN \'pending\' THEN 0 ELSE 1 END,id DESC LIMIT 300').all()));
app.patch('/api/admin/gallery/:id', requireAdmin, ensureCsrf, (req,res)=>{
  const status=String(req.body?.status||''); if(!['approved','rejected','pending'].includes(status)) return res.status(400).json({error:'Недопустимый статус.'});
  const r=db.prepare('UPDATE gallery_items SET status=? WHERE id=?').run(status,Number(req.params.id)); if(!r.changes) return res.status(404).json({error:'Работа не найдена.'});
  if(status==='approved'){const item=db.prepare('SELECT user_id FROM gallery_items WHERE id=?').get(Number(req.params.id));db.prepare("INSERT OR IGNORE INTO user_achievements(user_id,achievement_id) SELECT ?,id FROM achievements WHERE code='gallery_artist'").run(item.user_id);}
  logAction(req,'gallery.moderate',`item=${req.params.id}; status=${status}`); res.json({ok:true});
});
app.get('/api/admin/analytics', requireAdmin, (req,res)=>{
 const daily=db.prepare("SELECT substr(created_at,1,10) day, count(*) count FROM system_logs WHERE created_at >= datetime('now','-13 days') GROUP BY substr(created_at,1,10) ORDER BY day").all();
 res.json({daily, tickets:db.prepare("SELECT status,count(*) count FROM support_tickets GROUP BY status").all(), applications:db.prepare("SELECT status,count(*) count FROM applications GROUP BY status").all(), gallery:db.prepare("SELECT status,count(*) count FROM gallery_items GROUP BY status").all(), eventRsvps:db.prepare('SELECT count(*) count FROM event_rsvps').get().count});
});
app.get('/api/admin/discord-status', requireAdmin, async (req,res)=>{
 const configured=Boolean(process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_GUILD_ID);
 if(!configured) return res.json({configured:false,ok:false,message:'Добавьте DISCORD_BOT_TOKEN и DISCORD_GUILD_ID в .env.'});
 try { const response=await fetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(process.env.DISCORD_GUILD_ID)}?with_counts=true`,{headers:{Authorization:`Bot ${process.env.DISCORD_BOT_TOKEN}`},signal:AbortSignal.timeout(4000)}); const data=await response.json();
 if(!response.ok) return res.json({configured:true,ok:false,message:`Discord API ответил ${response.status}. Проверьте токен и доступ бота.`});
 res.json({configured:true,ok:true,guild:data.name,members:data.approximate_member_count,online:data.approximate_presence_count});
 } catch { res.json({configured:true,ok:false,message:'Не удалось связаться с Discord API.'}); }
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
  notifyDiscord(`Новое событие Yushiko: ${safeText(b.title,120)} — ${date.toISOString()}`).catch(()=>{});
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
  const filename = `yushiko-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`;
  const target = path.join(dir, filename);
  db.backup(target).then(() => {
    logAction(req, 'backup.create', filename);
    res.download(target, filename);
  }).catch(() => res.status(500).json({ error: 'Не удалось создать резервную копию.' }));
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: isProduction ? '1h' : 0 }));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('*', (req, res) => res.status(404).sendFile(path.join(__dirname, 'public', '404.html')));

app.listen(PORT, () => console.log(`Yushiko is running at ${SITE_URL} (port ${PORT})`));
