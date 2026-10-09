"""Clinic booking backend. Python standard library only. Run: python3 server.py"""
import sqlite3, json, os, re, secrets, hashlib, csv, io, smtplib, mimetypes
from datetime import datetime, date, timedelta
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from email.message import EmailMessage

DB = os.environ.get("CLINIC_DB", "clinic.db")
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
SMTP_HOST = os.environ.get("SMTP_HOST")  # optional: SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM
CLINIC = {"name": "Bayanihan Family Clinic", "address": "12 Rizal St., Bayombong, Nueva Vizcaya", "phone": "(078) 000-0000", "email": "hello@clinic.example"}
STEP = 30  # minutes between slot start times

class Fail(Exception):
    def __init__(s, msg, code=400): super().__init__(msg); s.code = code

def db():
    c = sqlite3.connect(DB, isolation_level=None, timeout=10)
    c.row_factory = sqlite3.Row
    return c

def now(): return datetime.now().isoformat(timespec="seconds")
def hp(pw, salt): return hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), 200000).hex()
def mins(t): return int(t[:2]) * 60 + int(t[3:5])
def fmt(m): return "%02d:%02d" % (m // 60, m % 60)

SCHEMA = """
create table if not exists users(id integer primary key, email text unique, name text, salt text, pw text, role text, demo int default 0);
create table if not exists sessions(token text primary key, user_id int, expires text);
create table if not exists services(id integer primary key, name text, description text, duration int);
create table if not exists doctors(id integer primary key, user_id int, name text, specialty text, services text, active int default 1);
create table if not exists schedules(doctor_id int, weekday int, start text, finish text);
create table if not exists blocked(date text, doctor_id int, reason text);
create table if not exists appointments(id integer primary key, ref text unique, patient_id int, doctor_id int, service_id int, date text, time text,
  status text, name text, dob text, gender text, phone text, email text, reason text, created text, reminded int default 0);
create unique index if not exists uniq_slot on appointments(doctor_id, date, time) where status != 'Cancelled';
create table if not exists notifications(id integer primary key, recipient text, subject text, body text, status text, created text);
"""

def seed(c):
    if c.execute("select count(*) from users").fetchone()[0]: return
    def user(email, name, pw, role):
        s = secrets.token_hex(8)
        return c.execute("insert into users(email,name,salt,pw,role,demo) values(?,?,?,?,?,1)", (email, name, s, hp(pw, s), role)).lastrowid
    user("admin@clinic.test", "Clinic Admin", "admin12345", "admin")
    user("patient@clinic.test", "Demo Patient", "patient12345", "patient")
    for n, d, desc in [("General Consultation", 30, "Check-ups, fever, cough, and everyday concerns."),
                       ("Pediatrics", 30, "Care for babies, children, and teens."),
                       ("Dental Checkup", 60, "Cleaning, exam, and oral health advice."),
                       ("Laboratory Tests", 30, "Blood tests and basic diagnostics.")]:
        c.execute("insert into services(name,description,duration) values(?,?,?)", (n, desc, d))
    for email, n, sp, sv, days in [("doctor1@clinic.test", "Dr. Maria Santos", "General Medicine", "1,4", range(5)),
                                   ("doctor2@clinic.test", "Dr. Jose Reyes", "Pediatrics", "2", range(5)),
                                   ("doctor3@clinic.test", "Dr. Ana Cruz", "Dentistry", "3", (0, 2, 4))]:
        did = c.execute("insert into doctors(user_id,name,specialty,services) values(?,?,?,?)", (user(email, n, "doctor12345", "doctor"), n, sp, sv)).lastrowid
        for d in days:
            c.execute("insert into schedules values(?,?,?,?)", (did, d, "09:00", "12:00"))
            c.execute("insert into schedules values(?,?,?,?)", (did, d, "13:00", "17:00"))

def notify(c, to, subject, body):
    status = "not sent (email not configured)"
    if SMTP_HOST and to:
        try:
            m = EmailMessage(); m["From"] = os.environ.get("MAIL_FROM", CLINIC["email"]); m["To"] = to; m["Subject"] = subject; m.set_content(body)
            with smtplib.SMTP(SMTP_HOST, int(os.environ.get("SMTP_PORT", 587)), timeout=10) as s:
                s.starttls()
                if os.environ.get("SMTP_USER"): s.login(os.environ["SMTP_USER"], os.environ.get("SMTP_PASS", ""))
                s.send_message(m)
            status = "sent"
        except Exception: status = "failed"
    elif not to: status = "no email address"
    c.execute("insert into notifications(recipient,subject,body,status,created) values(?,?,?,?,?)", (to or "-", subject, body, status, now()))

def slots(c, sid, did, d, exclude=0):
    """Returns {time: doctor_id} of free start times for a service on a date."""
    try: dt = date.fromisoformat(d)
    except Exception: raise Fail("Invalid date")
    svc = c.execute("select * from services where id=?", (sid,)).fetchone()
    if not svc or dt < date.today(): return {}
    out = {}
    for doc in c.execute("select id, services from doctors where active=1" + (" and id=%d" % did if did else "")):
        if str(sid) not in doc["services"].split(","): continue
        if c.execute("select 1 from blocked where date=? and (doctor_id is null or doctor_id=?)", (d, doc["id"])).fetchone(): continue
        busy = [(mins(r["time"]), mins(r["time"]) + r["duration"]) for r in c.execute(
            "select a.time, s.duration from appointments a join services s on s.id=a.service_id where a.doctor_id=? and a.date=? and a.status!='Cancelled' and a.id!=?", (doc["id"], d, exclude))]
        for r in c.execute("select start, finish from schedules where doctor_id=? and weekday=? order by start", (doc["id"], dt.weekday())):
            t = mins(r["start"])
            while t + svc["duration"] <= mins(r["finish"]):
                start = datetime.combine(dt, datetime.min.time()) + timedelta(minutes=t)
                if start > datetime.now() + timedelta(minutes=30) and not any(t < b1 and b0 < t + svc["duration"] for b0, b1 in busy):
                    out.setdefault(fmt(t), doc["id"])
                t += STEP
    return out

def need(me, *roles):
    if not me: raise Fail("Please log in first.", 401)
    if roles and me["role"] not in roles: raise Fail("You do not have permission for this.", 403)

def pub(u): return {"id": u["id"], "name": u["name"], "email": u["email"], "role": u["role"], "demo": u["demo"]} if u else None

def appt_query(c, me, q):
    sql = ("select a.*, d.name doctor, s.name service, s.duration from appointments a join doctors d on d.id=a.doctor_id join services s on s.id=a.service_id where 1=1")
    args = []
    if me["role"] == "patient": sql += " and a.patient_id=?"; args.append(me["id"])
    if me["role"] == "doctor": sql += " and d.user_id=?"; args.append(me["id"])
    if q.get("q"): sql += " and (a.name like ? or a.ref like ? or a.phone like ?)"; args += ["%" + q["q"] + "%"] * 3
    for k, col in (("status", "a.status"), ("date", "a.date"), ("doctor", "a.doctor_id")):
        if q.get(k): sql += " and %s=?" % col; args.append(q[k])
    rows = [dict(r) for r in c.execute(sql + " order by a.date, a.time", args)]
    if me["role"] == "doctor":  # doctors only need basic consultation info
        for r in rows: r.pop("phone", None); r.pop("email", None)
    return rows

def api(h, c, m, p, q, b):
    me = h.user(c)
    if p == "info": return 200, CLINIC
    if p == "services": return 200, [dict(r) for r in c.execute("select * from services")]
    if p == "doctors": return 200, [dict(r) for r in c.execute("select id,name,specialty,services from doctors where active=1")]
    if p == "slots":
        return 200, sorted(slots(c, int(q["service"]), int(q["doctor"]) if q.get("doctor") else None, q["date"]))
    if p == "me": return 200, {"user": pub(me)}
    if p == "register":
        email = (b.get("email") or "").strip().lower(); name = (b.get("name") or "").strip()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email) or not name or len(b.get("password") or "") < 8:
            raise Fail("Enter your name, a valid email, and a password of at least 8 characters.")
        if c.execute("select 1 from users where email=?", (email,)).fetchone(): raise Fail("That email is already registered.", 409)
        s = secrets.token_hex(8)
        c.execute("insert into users(email,name,salt,pw,role) values(?,?,?,?, 'patient')", (email, name, s, hp(b["password"], s)))
        return login(c, email, b["password"])
    if p == "login": return login(c, (b.get("email") or "").strip().lower(), b.get("password") or "")
    if p == "logout":
        ck = h.headers.get("Cookie", ""); c.execute("delete from sessions where token=?", (ck.split("sid=")[-1].split(";")[0],))
        return 200, {"ok": True}, {"Set-Cookie": "sid=; Max-Age=0; Path=/"}
    if p == "book": return 201, book(c, me, b)
    if p == "appointments": need(me); return 200, appt_query(c, me, q)
    mm = re.match(r"appointments/(\d+)/(status|reschedule)$", p)
    if mm and m == "POST":
        need(me); a = c.execute("select a.*, d.user_id duser from appointments a join doctors d on d.id=a.doctor_id where a.id=?", (mm[1],)).fetchone()
        if not a or (me["role"] == "patient" and a["patient_id"] != me["id"]) or (me["role"] == "doctor" and a["duser"] != me["id"]):
            raise Fail("Appointment not found.", 404)
        if a["status"] in ("Completed", "Cancelled"): raise Fail("This appointment is already %s." % a["status"].lower())
        if me["role"] == "patient" and datetime.fromisoformat(a["date"] + "T" + a["time"]) - datetime.now() < timedelta(hours=24):
            raise Fail("Changes need at least 24 hours notice. Please call the clinic.")
        if mm[2] == "status":
            st = b.get("status")
            allowed = {"patient": ["Cancelled"], "doctor": ["Confirmed", "Completed"], "admin": ["Pending", "Confirmed", "Completed", "Cancelled"]}[me["role"]]
            if st not in allowed: raise Fail("Status change not allowed.", 403)
            c.execute("update appointments set status=? where id=?", (st, a["id"]))
            notify(c, a["email"], "Appointment %s: %s" % (st.lower(), a["ref"]), "Your appointment on %s at %s is now %s." % (a["date"], a["time"], st))
        else:
            c.execute("begin immediate")
            try:
                if b.get("time") not in slots(c, a["service_id"], a["doctor_id"], b.get("date") or "", exclude=a["id"]): raise Fail("That time is not available.", 409)
                c.execute("update appointments set date=?, time=?, status='Pending' where id=?", (b["date"], b["time"], a["id"]))
                notify(c, a["email"], "Appointment rescheduled: " + a["ref"], "New time: %s at %s." % (b["date"], b["time"]))
                c.execute("commit")
            except Exception: c.execute("rollback"); raise
        return 200, {"ok": True}
    if p == "stats":
        need(me, "admin"); t = date.today().isoformat(); n = lambda s, *a: c.execute(s, a).fetchone()[0]
        return 200, {"today": n("select count(*) from appointments where date=? and status!='Cancelled'", t),
                     "upcoming": n("select count(*) from appointments where date>? and status in ('Pending','Confirmed')", t),
                     "patients": n("select count(*) from users where role='patient'"), "cancelled": n("select count(*) from appointments where status='Cancelled'")}
    if p == "notifications": need(me, "admin"); return 200, [dict(r) for r in c.execute("select * from notifications order by id desc limit 30")]
    if p == "reminders" and m == "POST":
        need(me, "admin"); tom = (date.today() + timedelta(days=1)).isoformat(); k = 0
        for a in c.execute("select * from appointments where date=? and status in ('Pending','Confirmed') and reminded=0", (tom,)).fetchall():
            notify(c, a["email"], "Reminder: appointment tomorrow", "Hello %s, your visit is tomorrow at %s. Ref %s." % (a["name"], a["time"], a["ref"]))
            c.execute("update appointments set reminded=1 where id=?", (a["id"],)); k += 1
        return 200, {"queued": k}
    if p == "export":
        need(me, "admin"); rows = appt_query(c, me, q); o = io.StringIO(); w = csv.writer(o)
        w.writerow(["ref", "date", "time", "doctor", "service", "status", "patient", "phone"])
        for r in rows: w.writerow([r["ref"], r["date"], r["time"], r["doctor"], r["service"], r["status"], r["name"], r["phone"]])
        return 200, o.getvalue().encode(), {"Content-Type": "text/csv", "Content-Disposition": "attachment; filename=appointments.csv"}
    if p == "contact" and m == "POST":
        if not (b.get("name") and b.get("message")): raise Fail("Please enter your name and message.")
        notify(c, CLINIC["email"], "Contact form: " + b["name"][:60], (b["message"][:1000]) + "\nReply to: " + (b.get("email") or "-")[:100])
        return 200, {"ok": True}
    raise Fail("Not found", 404)

def login(c, email, pw):
    u = c.execute("select * from users where email=?", (email,)).fetchone()
    if not u or hp(pw, u["salt"]) != u["pw"]: raise Fail("Wrong email or password.", 401)
    t = secrets.token_urlsafe(32)
    c.execute("insert into sessions values(?,?,?)", (t, u["id"], (datetime.now() + timedelta(days=7)).isoformat()))
    return 200, {"user": pub(u)}, {"Set-Cookie": "sid=%s; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800" % t}

def book(c, me, b):
    g = lambda k: (b.get(k) or "").strip()
    name, phone, dob, reason, d, t = g("name"), g("phone"), g("dob"), g("reason"), g("date"), g("time")
    if not name or not reason: raise Fail("Name and reason for visit are required.")
    if not re.match(r"^[0-9+()\-\s]{7,20}$", phone): raise Fail("Enter a valid phone number.")
    try:
        if date.fromisoformat(dob) >= date.today(): raise ValueError
    except Exception: raise Fail("Enter a valid date of birth.")
    if g("email") and not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", g("email")): raise Fail("Enter a valid email or leave it blank.")
    sid = int(b.get("service") or 0); did = int(b["doctor"]) if b.get("doctor") else None
    c.execute("begin immediate")  # locks the database so two people cannot take the same slot
    try:
        doc = slots(c, sid, did, d).get(t)
        if not doc: raise Fail("Sorry, that time is no longer available. Please pick another.", 409)
        ref = "CLN-" + secrets.token_hex(3).upper()
        c.execute("insert into appointments(ref,patient_id,doctor_id,service_id,date,time,status,name,dob,gender,phone,email,reason,created) values(?,?,?,?,?,?,'Pending',?,?,?,?,?,?,?)",
                  (ref, me["id"] if me and me["role"] == "patient" else None, doc, sid, d, t, name, dob, g("gender"), phone, g("email"), reason[:300], now()))
        notify(c, g("email"), "Booking received: " + ref, "Hello %s, we received your request for %s at %s. Reference: %s. The clinic will confirm shortly." % (name, d, t, ref))
        c.execute("commit")
    except Exception: c.execute("rollback"); raise
    r = c.execute("select a.*, d.name doctor, s.name service from appointments a join doctors d on d.id=a.doctor_id join services s on s.id=a.service_id where ref=?", (ref,)).fetchone()
    return {k: r[k] for k in ("ref", "doctor", "service", "date", "time", "status")} | {"clinic": CLINIC}

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def user(self, c):
        t = next((p[4:] for p in self.headers.get("Cookie", "").split("; ") if p.startswith("sid=")), None)
        return c.execute("select u.* from sessions s join users u on u.id=s.user_id where s.token=? and s.expires>?", (t, now())).fetchone() if t else None
    def out(self, code, body, hdr=None):
        b = body if isinstance(body, bytes) else json.dumps(body).encode()
        h = {"Content-Type": "application/json", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"}; h.update(hdr or {})
        self.send_response(code)
        for k, v in h.items(): self.send_header(k, v)
        self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self): self.route("GET")
    def do_POST(self): self.route("POST")
    def route(self, m):
        u = urlparse(self.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}
        if not u.path.startswith("/api/"):
            f = os.path.normpath(os.path.join(ROOT, u.path.lstrip("/") or "index.html"))
            if not f.startswith(ROOT) or not os.path.isfile(f): f = os.path.join(ROOT, "index.html")
            return self.out(200, open(f, "rb").read(), {"Content-Type": mimetypes.guess_type(f)[0] or "text/html"})
        body = {}
        if m == "POST":
            try: body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            except Exception: return self.out(400, {"error": "Invalid request"})
        c = db()
        try:
            r = api(self, c, m, u.path[5:], q, body); self.out(r[0], r[1], r[2] if len(r) > 2 else None)
        except Fail as e: self.out(e.code, {"error": str(e)})
        except Exception as e: print("ERROR", e); self.out(500, {"error": "Server error. Please try again."})
        finally: c.close()

if __name__ == "__main__":
    c = db(); c.executescript(SCHEMA); seed(c); c.close()
    port = int(os.environ.get("PORT", 8000))
    print("Clinic running at http://127.0.0.1:%d (demo logins are in README.txt)" % port)
    ThreadingHTTPServer(("127.0.0.1", port), H).serve_forever()
