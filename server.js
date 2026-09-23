const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ROOT, "public", "uploads");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "nefu.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('student','buddy','admin')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active','pending','rejected','suspended')),
  country TEXT,
  faculty TEXT,
  course TEXT,
  languages TEXT,
  help_areas TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  starts_at TEXT NOT NULL,
  ends_at TEXT,
  cover_photo TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS event_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  photo TEXT NOT NULL,
  caption TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS event_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, student_id)
);

CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  status TEXT NOT NULL DEFAULT 'new',
  assigned_buddy_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO site_settings(key,value) VALUES
('hero_photo',''),
('site_title','NEFU International'),
('site_subtitle','Buddy Team');

CREATE TABLE IF NOT EXISTS site_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  photo TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_site_photos_order ON site_photos(sort_order,id);
CREATE INDEX IF NOT EXISTS idx_requests_student ON requests(student_id);
CREATE INDEX IF NOT EXISTS idx_requests_buddy ON requests(assigned_buddy_id);
CREATE INDEX IF NOT EXISTS idx_reg_event ON event_registrations(event_id);
`);

class SQLiteSessionStore extends session.Store {
  constructor(database){super();this.db=database;this.db.exec(`CREATE TABLE IF NOT EXISTS web_sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expire INTEGER NOT NULL)`);}
  get(sid,cb){try{const row=this.db.prepare("SELECT sess, expire FROM web_sessions WHERE sid=?").get(sid);if(!row)return cb(null,null);if(row.expire<=Date.now()){this.db.prepare("DELETE FROM web_sessions WHERE sid=?").run(sid);return cb(null,null);}cb(null,JSON.parse(row.sess));}catch(e){cb(e);}}
  set(sid,sess,cb){try{const expire=new Date(sess.cookie?.expires||Date.now()+1000*60*60*24*30).getTime();this.db.prepare("INSERT INTO web_sessions(sid,sess,expire) VALUES(?,?,?) ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess,expire=excluded.expire").run(sid,JSON.stringify(sess),expire);cb&&cb(null);}catch(e){cb&&cb(e);}}
  destroy(sid,cb){try{this.db.prepare("DELETE FROM web_sessions WHERE sid=?").run(sid);cb&&cb(null);}catch(e){cb&&cb(e);}}
  touch(sid,sess,cb){this.set(sid,sess,cb);}
}
const app = express();
app.use(express.json({limit:"10mb"}));
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(ROOT,"public")));
app.use("/uploads", express.static(UPLOAD_DIR));

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg","image/png","image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Only JPG, PNG and WEBP images are allowed"), ok);
  }
});

app.use(session({
  store: new SQLiteSessionStore(db),
  secret: process.env.SESSION_SECRET || "CHANGE_THIS_SESSION_SECRET",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly:true, sameSite:"lax", secure: process.env.NODE_ENV === "production", maxAge:1000*60*60*24*30 }
}));

function publicUser(u) {
  return {
    id:u.id, username:u.username, name:u.name, email:u.email || "",
    phone:u.phone, role:u.role, status:u.status,
    country:u.country || "", faculty:u.faculty || "", course:u.course || "",
    languages:u.languages || "", helpAreas:u.help_areas || ""
  };
}
function auth(req,res,next) {
  if (!req.session.userId) return res.status(401).json({error:"login_required"});
  const u=db.prepare("SELECT * FROM users WHERE id=?").get(req.session.userId);
  if (!u || u.status!=="active") return res.status(401).json({error:"login_required"});
  req.user=u; next();
}
function role(...roles) {
  return (req,res,next)=>{
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).json({error:"forbidden"});
    next();
  };
}
function saveUpload(file) {
  if (!file) return null;
  const ext = path.extname(file.originalname).toLowerCase() || ".jpg";
  const finalName = `${crypto.randomUUID()}${ext}`;
  const finalPath = path.join(UPLOAD_DIR, finalName);
  fs.renameSync(file.path, finalPath);
  return `/uploads/${finalName}`;
}

// ---------- Auth ----------
app.get("/api/me", (req,res)=>{
  if (!req.session.userId) return res.json({user:null});
  const u=db.prepare("SELECT * FROM users WHERE id=?").get(req.session.userId);
  if (!u || u.status!=="active") return res.json({user:null});
  res.json({user:publicUser(u)});
});

app.post("/api/auth/register", async (req,res)=>{
  const {
    username,name,email="",phone,password,role="student",
    country="",faculty="",course="",languages="",helpAreas=""
  }=req.body || {};
  if(!username||!name||!phone||!password)
    return res.status(400).json({error:"name_username_phone_password_required"});
  if(!["student","buddy"].includes(role))
    return res.status(400).json({error:"invalid_registration_role"});
  const existing=db.prepare("SELECT id FROM users WHERE lower(username)=lower(?)").get(username);
  if(existing) return res.status(409).json({error:"username_taken"});
  const hash=await bcrypt.hash(password,12);
  const status=role==="buddy" ? "pending" : "active";
  const info=db.prepare(`
    INSERT INTO users(username,name,email,phone,password_hash,role,status,country,faculty,course,languages,help_areas)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(username,name,email||null,phone,hash,role,status,country,faculty,course,languages,helpAreas);
  const u=db.prepare("SELECT * FROM users WHERE id=?").get(info.lastInsertRowid);
  if(role==="student") {
    req.session.userId=u.id;
  }
  res.status(201).json({user:publicUser(u), pending:role==="buddy"});
});

app.post("/api/auth/login", async (req,res)=>{
  const {username,password}=req.body||{};
  const u=db.prepare("SELECT * FROM users WHERE lower(username)=lower(?)").get(username||"");
  if(!u || !(await bcrypt.compare(password||"",u.password_hash)))
    return res.status(401).json({error:"invalid_credentials"});
  if(u.status!=="active")
    return res.status(403).json({error:u.status});
  req.session.userId=u.id;
  res.json({user:publicUser(u)});
});

app.post("/api/auth/logout",(req,res)=>{
  req.session.destroy(()=>res.json({ok:true}));
});

// ---------- Public site ----------
app.get("/api/site",(_req,res)=>{
  const settings={};
  for(const r of db.prepare("SELECT key,value FROM site_settings").all()) settings[r.key]=r.value;
  const count=db.prepare("SELECT COUNT(*) count FROM site_photos").get().count;
  if(count===0 && settings.hero_photo){
    db.prepare("INSERT INTO site_photos(photo,caption,sort_order) VALUES(?,?,?)").run(settings.hero_photo,"",0);
  }
  const heroPhotos=db.prepare("SELECT id,photo,caption,sort_order FROM site_photos ORDER BY sort_order,id").all();
  res.json({settings,heroPhotos});
});

// ---------- Events ----------
function eventObject(e) {
  const photos=db.prepare("SELECT id,photo,caption FROM event_photos WHERE event_id=? ORDER BY id").all(e.id);
  const registrations=db.prepare("SELECT COUNT(*) count FROM event_registrations WHERE event_id=?").get(e.id).count;
  return {...e, photos, registrationCount:registrations};
}
app.get("/api/events",(_req,res)=>{
  res.json({events:db.prepare("SELECT * FROM events ORDER BY starts_at ASC").all().map(eventObject)});
});

app.post("/api/events/:id/register",auth,role("student"),(req,res)=>{
  const e=db.prepare("SELECT id FROM events WHERE id=?").get(req.params.id);
  if(!e) return res.status(404).json({error:"event_not_found"});
  try {
    db.prepare("INSERT INTO event_registrations(event_id,student_id,phone) VALUES(?,?,?)")
      .run(e.id,req.user.id,req.body.phone||req.user.phone);
    res.status(201).json({ok:true});
  } catch(err) {
    if(String(err.message).includes("UNIQUE")) return res.status(409).json({error:"already_registered"});
    throw err;
  }
});

app.get("/api/admin/events",auth,role("admin"),(_req,res)=>{
  res.json({events:db.prepare("SELECT * FROM events ORDER BY starts_at ASC").all().map(eventObject)});
});
app.post("/api/admin/events",auth,role("admin"),upload.single("cover"),(req,res)=>{
  const {title,description="",location="",startsAt,endsAt=""}=req.body;
  if(!title||!startsAt) return res.status(400).json({error:"title_and_date_required"});
  const cover=saveUpload(req.file);
  const info=db.prepare(`INSERT INTO events(title,description,location,starts_at,ends_at,cover_photo)
    VALUES(?,?,?,?,?,?)`).run(title,description,location,startsAt,endsAt||null,cover);
  res.status(201).json({event:eventObject(db.prepare("SELECT * FROM events WHERE id=?").get(info.lastInsertRowid))});
});
app.patch("/api/admin/events/:id",auth,role("admin"),upload.single("cover"),(req,res)=>{
  const old=db.prepare("SELECT * FROM events WHERE id=?").get(req.params.id);
  if(!old) return res.status(404).json({error:"event_not_found"});
  const cover=saveUpload(req.file) || old.cover_photo;
  const {title=old.title,description=old.description,location=old.location,startsAt=old.starts_at,endsAt=old.ends_at}=req.body;
  db.prepare(`UPDATE events SET title=?,description=?,location=?,starts_at=?,ends_at=?,cover_photo=? WHERE id=?`)
    .run(title,description,location,startsAt,endsAt||null,cover,old.id);
  res.json({event:eventObject(db.prepare("SELECT * FROM events WHERE id=?").get(old.id))});
});
app.delete("/api/admin/events/:id",auth,role("admin"),(req,res)=>{
  const e=db.prepare("SELECT * FROM events WHERE id=?").get(req.params.id);
  if(!e) return res.status(404).json({error:"event_not_found"});
  db.prepare("DELETE FROM events WHERE id=?").run(e.id);
  res.json({ok:true});
});
app.post("/api/admin/events/:id/photos",auth,role("admin"),upload.single("photo"),(req,res)=>{
  const photo=saveUpload(req.file);
  if(!photo) return res.status(400).json({error:"photo_required"});
  const info=db.prepare("INSERT INTO event_photos(event_id,photo,caption) VALUES(?,?,?)")
    .run(req.params.id,photo,req.body.caption||"");
  res.status(201).json({photo:db.prepare("SELECT * FROM event_photos WHERE id=?").get(info.lastInsertRowid)});
});
app.delete("/api/admin/event-photos/:id",auth,role("admin"),(req,res)=>{
  db.prepare("DELETE FROM event_photos WHERE id=?").run(req.params.id);
  res.json({ok:true});
});
app.get("/api/admin/events/:id/registrations",auth,role("admin"),(req,res)=>{
  const rows=db.prepare(`
    SELECT er.id,er.phone,er.created_at,u.name,u.username,u.email
    FROM event_registrations er JOIN users u ON u.id=er.student_id
    WHERE er.event_id=? ORDER BY er.created_at DESC
  `).all(req.params.id);
  res.json({registrations:rows});
});

// ---------- Admin website photo gallery ----------
app.get("/api/admin/site/photos",auth,role("admin"),(_req,res)=>{
  res.json({photos:db.prepare("SELECT id,photo,caption,sort_order,created_at FROM site_photos ORDER BY sort_order,id").all()});
});
app.post("/api/admin/site/photos",auth,role("admin"),upload.single("photo"),(req,res)=>{
  const photo=saveUpload(req.file);
  if(!photo) return res.status(400).json({error:"photo_required"});
  const max=db.prepare("SELECT COALESCE(MAX(sort_order),-1) m FROM site_photos").get().m;
  const info=db.prepare("INSERT INTO site_photos(photo,caption,sort_order) VALUES(?,?,?)")
    .run(photo,String(req.body.caption||""),max+1);
  res.status(201).json({photo:db.prepare("SELECT * FROM site_photos WHERE id=?").get(info.lastInsertRowid)});
});
app.delete("/api/admin/site/photos/:id",auth,role("admin"),(req,res)=>{
  const row=db.prepare("SELECT * FROM site_photos WHERE id=?").get(req.params.id);
  if(!row) return res.status(404).json({error:"photo_not_found"});
  db.prepare("DELETE FROM site_photos WHERE id=?").run(row.id);
  res.json({ok:true});
});
// Backward-compatible endpoint.
app.post("/api/admin/site/hero-photo",auth,role("admin"),upload.single("photo"),(req,res)=>{
  const photo=saveUpload(req.file);
  if(!photo) return res.status(400).json({error:"photo_required"});
  const max=db.prepare("SELECT COALESCE(MAX(sort_order),-1) m FROM site_photos").get().m;
  const info=db.prepare("INSERT INTO site_photos(photo,caption,sort_order) VALUES(?,?,?)")
    .run(photo,String(req.body.caption||""),max+1);
  db.prepare(`INSERT INTO site_settings(key,value) VALUES('hero_photo',?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(photo);
  res.json({heroPhoto:photo,id:info.lastInsertRowid});
});

// ---------- Buddy approval ----------
app.get("/api/admin/users",auth,role("admin"),(req,res)=>{
  const roleName = req.query.role==="buddy" ? "buddy" : "student";
  const rows=db.prepare(`SELECT id,username,name,email,phone,status,country,faculty,course,languages,help_areas,created_at
    FROM users WHERE role=? ORDER BY created_at DESC`).all(roleName);
  res.json({users:rows});
});

app.get("/api/admin/buddies",auth,role("admin"),(_req,res)=>{
  const rows=db.prepare(`SELECT id,username,name,email,phone,status,country,languages,help_areas,created_at
    FROM users WHERE role='buddy' ORDER BY created_at DESC`).all();
  res.json({buddies:rows});
});
app.patch("/api/admin/buddies/:id",auth,role("admin"),(req,res)=>{
  const status=req.body.status;
  if(!["active","rejected","suspended"].includes(status))
    return res.status(400).json({error:"invalid_status"});
  const info=db.prepare("UPDATE users SET status=? WHERE id=? AND role='buddy'").run(status,req.params.id);
  if(!info.changes) return res.status(404).json({error:"buddy_not_found"});
  res.json({ok:true});
});

// ---------- Requests ----------
app.get("/api/requests",auth,(req,res)=>{
  let rows;
  if(req.user.role==="student") {
    rows=db.prepare(`SELECT r.*,u.name student_name,b.name buddy_name
      FROM requests r JOIN users u ON u.id=r.student_id
      LEFT JOIN users b ON b.id=r.assigned_buddy_id
      WHERE r.student_id=? ORDER BY r.updated_at DESC`).all(req.user.id);
  } else {
    rows=db.prepare(`SELECT r.*,u.name student_name,b.name buddy_name
      FROM requests r JOIN users u ON u.id=r.student_id
      LEFT JOIN users b ON b.id=r.assigned_buddy_id
      ORDER BY r.updated_at DESC`).all();
  }
  res.json({requests:rows});
});
app.post("/api/requests",auth,role("student"),(req,res)=>{
  const {category,title,description,priority="normal"}=req.body||{};
  if(!category||!title||!description) return res.status(400).json({error:"request_fields_required"});
  const info=db.prepare(`INSERT INTO requests(student_id,category,title,description,priority)
    VALUES(?,?,?,?,?)`).run(req.user.id,category,title,description,priority);
  res.status(201).json({request:db.prepare("SELECT * FROM requests WHERE id=?").get(info.lastInsertRowid)});
});
app.get("/api/requests/:id/messages",auth,(req,res)=>{
  const r=db.prepare("SELECT * FROM requests WHERE id=?").get(req.params.id);
  if(!r) return res.status(404).json({error:"request_not_found"});
  if(req.user.role==="student" && r.student_id!==req.user.id) return res.status(403).json({error:"forbidden"});
  res.json({messages:db.prepare(`SELECT m.*,u.name sender_name,u.role sender_role
    FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.request_id=? ORDER BY m.id`).all(r.id)});
});
app.post("/api/requests/:id/messages",auth,(req,res)=>{
  const r=db.prepare("SELECT * FROM requests WHERE id=?").get(req.params.id);
  if(!r) return res.status(404).json({error:"request_not_found"});
  if(req.user.role==="student" && r.student_id!==req.user.id) return res.status(403).json({error:"forbidden"});
  const body=String(req.body.body||"").trim();
  if(!body) return res.status(400).json({error:"message_required"});
  const info=db.prepare("INSERT INTO messages(request_id,sender_id,body) VALUES(?,?,?)")
    .run(r.id,req.user.id,body);
  res.status(201).json({message:db.prepare("SELECT * FROM messages WHERE id=?").get(info.lastInsertRowid)});
});
app.patch("/api/requests/:id",auth,(req,res)=>{
  const r=db.prepare("SELECT * FROM requests WHERE id=?").get(req.params.id);
  if(!r) return res.status(404).json({error:"request_not_found"});
  if(req.user.role==="student") return res.status(403).json({error:"forbidden"});
  const status=req.body.status||r.status;
  const buddy=req.body.assignedBuddyId===undefined ? r.assigned_buddy_id : req.body.assignedBuddyId;
  const allowed=["new","reviewing","in_progress","resolved"];
  if(!allowed.includes(status)) return res.status(400).json({error:"invalid_request_status"});
  db.prepare(`UPDATE requests SET status=?,assigned_buddy_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(status,buddy||null,r.id);
  res.json({request:db.prepare("SELECT * FROM requests WHERE id=?").get(r.id)});
});

app.get("/api/buddies",auth,role("buddy","admin"),(_req,res)=>{
  res.json({buddies:db.prepare(`SELECT id,name,username,languages,help_areas FROM users
    WHERE role='buddy' AND status='active' ORDER BY name`).all()});
});

// Admin dashboard summary
app.get("/api/admin/summary",auth,role("admin"),(_req,res)=>{
  const count=(sql)=>db.prepare(sql).get().n;
  res.json({
    students:count("SELECT COUNT(*) n FROM users WHERE role='student'"),
    buddies:count("SELECT COUNT(*) n FROM users WHERE role='buddy' AND status='active'"),
    pendingBuddies:count("SELECT COUNT(*) n FROM users WHERE role='buddy' AND status='pending'"),
    events:count("SELECT COUNT(*) n FROM events"),
    openRequests:count("SELECT COUNT(*) n FROM requests WHERE status!='resolved'")
  });
});

const PORT=process.env.PORT||3000;

app.get("/health",(_req,res)=>{
  res.status(200).json({ok:true,service:"NEFU International"});
});

app.get("*",(req,res)=>{
  if(req.path.startsWith("/api/")) {
    return res.status(404).json({error:"not_found"});
  }
  res.sendFile(path.join(ROOT,"public","index.html"));
});

app.listen(PORT,"0.0.0.0",()=>{
  console.log(`NEFU International running on port ${PORT}`);
});
