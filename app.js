const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const nice = (d, t) => new Date(d + "T" + (t || "00:00")).toLocaleString("en-PH", {dateStyle: "medium", ...(t ? {timeStyle: "short"} : {})});
async function api(p, body) {
  const r = await fetch("/api/" + p, body ? {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)} : {});
  const j = r.headers.get("Content-Type")?.includes("json") ? await r.json() : {};
  if (!r.ok) throw new Error(j.error || "Something went wrong. Please try again.");
  return j;
}
function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 3200); }
let ME = null, SV = [], DR = [], INFO = {}, B = {step: 1};

const svcCards = l => `<div class="grid">${l.map(s => `<div class="card"><div class="ico">🩺</div><h3>${esc(s.name)}</h3><p class="muted">${esc(s.description)}</p><span class="tag">${s.duration} min</span></div>`).join("") || "<p>No matches found.</p>"}</div>`;
const drCards = l => `<div class="grid">${l.map(d => `<div class="card"><div class="ico">👩‍⚕️</div><h3>${esc(d.name)}</h3><p class="muted">${esc(d.specialty)}</p><a class="btn sm" href="#/book" data-doc="${d.id}">Book with this doctor</a></div>`).join("") || "<p>No matches found.</p>"}</div>`;
const hours = () => `<div class="card"><h3>Opening hours</h3><p>Mon–Fri 9:00 AM–5:00 PM (closed 12:00–1:00 PM)<br>Sat–Sun: closed</p><p>📍 ${esc(INFO.address)}<br>📞 ${esc(INFO.phone)}<br>✉️ ${esc(INFO.email)}</p></div>`;
const faq = () => `<h2>Frequently asked questions</h2>` + [["Can I cancel or reschedule?", "Yes, from your dashboard up to 24 hours before the visit."], ["Do I need an account to book?", "No. An account only lets you see and manage your appointments."], ["Is my information safe?", "We collect only what is needed and limit access by role."]].map(f => `<details><summary>${f[0]}</summary><p>${f[1]}</p></details>`).join("");
const reviews = () => `<h2>What patients say <span class="tag">sample testimonials</span></h2><div class="grid">${["Booking took two minutes and the staff were kind.", "Easy to pick a time that fit my work.", "The reminder helped me not miss my visit."].map((t, i) => `<div class="card">“${t}”<p class="muted">— Demo patient ${i + 1}</p></div>`).join("")}</div>`;

const PAGES = {
  home: () => `<section class="hero"><h1>Your Health, Our Priority.</h1><p>Friendly family care with simple online booking. Choose a service, pick a time, and you are done.</p><a class="btn" href="#/book">Book an Appointment</a></section><h2>Featured services</h2>${svcCards(SV)}<h2>Our doctors</h2>${drCards(DR)}<h2>Visit us</h2>${hours()}${reviews()}${faq()}`,
  services: () => `<h1>Services</h1><label>Search services<input id="sq" type="search" placeholder="e.g. dental"></label><div id="res">${svcCards(SV)}</div>`,
  doctors: () => `<h1>Doctors</h1><label>Search doctors<input id="dq" type="search" placeholder="Name or specialty"></label><div id="res">${drCards(DR)}</div>`,
  about: () => `<h1>About Us</h1><p>${esc(INFO.name)} provides primary care for the whole family. Our team keeps your information private and your visits on time.</p>${hours()}${reviews()}${faq()}`,
  contact: () => `<h1>Contact</h1><div class="row"><form id="cf" class="card"><label>Your name<input name="name" required></label><label>Email<input name="email" type="email"></label><label>Message<textarea name="message" rows="4" required></textarea></label><p class="err" hidden></p><button class="btn" style="margin-top:12px">Send message</button></form>${hours()}</div><p class="muted">Map: ${esc(INFO.address)} — add your map embed here.</p>`,
  login: () => `<h1>Log in or register</h1><div class="row"><form id="lf" class="card"><h3>Log in</h3><label>Email<input name="email" type="email" required></label><label>Password<input name="password" type="password" required></label><p class="err" hidden></p><button class="btn" style="margin-top:12px">Log in</button><p class="muted">Demo: patient@clinic.test / patient12345</p></form><form id="rf" class="card"><h3>New patient</h3><label>Full name<input name="name" required></label><label>Email<input name="email" type="email" required></label><label>Password (8+ characters)<input name="password" type="password" minlength="8" required></label><p class="err" hidden></p><button class="btn" style="margin-top:12px">Create account</button></form></div>`,
  book: () => bookPage(), dashboard: () => dashPage(),
};

function bookPage() {
  const s = B.step, svc = SV.find(x => x.id == B.service), docs = DR.filter(d => !B.service || d.services.split(",").includes(String(B.service)));
  const bar = `<div class="steps">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= s ? "on" : ""}"></i>`).join("")}</div>`;
  if (s === 6) return `<div class="ok"><h1>Booking received</h1><p>Your reference: <strong style="font-size:1.4rem">${esc(B.done.ref)}</strong></p><p>${esc(B.done.service)} with ${esc(B.done.doctor)}<br>${nice(B.done.date, B.done.time)}<br>Status: ${esc(B.done.status)} (the clinic will confirm)</p><p>📍 ${esc(B.done.clinic.address)} · 📞 ${esc(B.done.clinic.phone)}</p><p class="muted">Please save your reference. Arrive 10 minutes early.</p><a class="btn" href="#/home" id="again">Done</a></div>`;
  let h = `<h1>Book an appointment</h1>${bar}`;
  if (s === 1) h += `<h2>1. Choose a service</h2>` + SV.map(x => `<button class="opt ${B.service == x.id ? "on" : ""}" data-svc="${x.id}"><strong>${esc(x.name)}</strong> <span class="muted">${x.duration} min</span></button>`).join("");
  if (s === 2) h += `<h2>2. Choose a doctor</h2><button class="opt ${!B.doctor ? "on" : ""}" data-doc2="">Any available doctor</button>` + docs.map(d => `<button class="opt ${B.doctor == d.id ? "on" : ""}" data-doc2="${d.id}"><strong>${esc(d.name)}</strong> <span class="muted">${esc(d.specialty)}</span></button>`).join("");
  if (s === 3) h += `<h2>3. Pick a date and time</h2><label>Date<input type="date" id="dt" min="${today()}" value="${B.date || ""}"></label><div class="slots" id="sl" aria-live="polite">${B.date ? "Loading times..." : "Choose a date to see times."}</div>`;
  if (s === 4) { const v = B.f || {name: ME?.name || "", email: ME?.email || ""}; h += `<h2>4. Your details</h2><form id="pf"><label>Full name *<input name="name" required value="${esc(v.name)}"></label><label>Date of birth *<input name="dob" type="date" required max="${today()}" value="${esc(v.dob)}"></label><label>Gender (optional)<select name="gender"><option value="">Prefer not to say</option><option>Female</option><option>Male</option><option>Other</option></select></label><label>Phone number *<input name="phone" type="tel" required value="${esc(v.phone)}"></label><label>Email (optional)<input name="email" type="email" value="${esc(v.email)}"></label><label>Reason for visit * (keep it brief)<textarea name="reason" rows="3" maxlength="300" required>${esc(v.reason)}</textarea></label><p class="muted">By continuing you consent to the clinic using this information to manage your appointment.</p><p class="err" hidden></p><button class="btn" style="margin-top:12px">Review</button></form>`; }
  if (s === 5) { const f = B.f; h += `<h2>5. Review and confirm</h2><div class="card"><p><strong>${esc(svc?.name)}</strong><br>${nice(B.date, B.time)}<br>Doctor: ${B.doctor ? esc(DR.find(d => d.id == B.doctor)?.name) : "Any available doctor"}</p><p>${esc(f.name)} · ${esc(f.phone)}<br>Reason: ${esc(f.reason)}</p></div><p class="err" hidden></p><button class="btn" id="go" style="margin-top:12px">Confirm booking</button>`; }
  if (s > 1 && s < 6) h += `<p><button class="btn alt" id="back">Back</button></p>`;
  return h;
}

async function dashPage() {
  if (!ME) { location.hash = "#/login"; return ""; }
  const q = new URLSearchParams(B.q || {}), list = await api("appointments?" + q);
  const acts = a => { const x = [];
    if (!["Completed", "Cancelled"].includes(a.status)) {
      if (ME.role === "admin" && a.status === "Pending") x.push(["Confirmed", "Confirm"]);
      if (ME.role === "doctor" && a.status === "Pending") x.push(["Confirmed", "Confirm"]);
      if (ME.role !== "patient") x.push(["Completed", "Complete"]);
      x.push(["Cancelled", "Cancel"]);
    } return x.map(([s, l]) => `<button class="btn sm ${s === "Cancelled" ? "bad" : ""}" data-st="${a.id}" data-v="${s}">${l}</button>`).join(" ") + (ME.role !== "doctor" && !["Completed", "Cancelled"].includes(a.status) ? ` <button class="btn sm alt" data-rs="${a.id}" data-svc="${a.service_id}" data-doc="${a.doctor_id}">Reschedule</button>` : ""); };
  const row = a => `<tr><td>${esc(a.ref)}</td><td>${nice(a.date, a.time)}</td><td>${esc(a.service)}<br><span class="muted">${esc(a.doctor)}</span></td><td>${esc(a.name)}${ME.role === "doctor" ? `<br><span class="muted">${esc(a.reason)}</span>` : ""}</td><td><span class="st ${a.status}">${a.status}</span></td><td>${acts(a)}</td></tr>`;
  const tbl = l => l.length ? `<div class="scroll"><table><tr><th>Ref</th><th>When</th><th>Service</th><th>Patient</th><th>Status</th><th>Actions</th></tr>${l.map(row).join("")}</table></div>` : `<p class="muted">Nothing here yet.</p>`;
  const nowIso = today(), up = list.filter(a => a.date >= nowIso && !["Cancelled", "Completed"].includes(a.status)), past = list.filter(a => !up.includes(a));
  let h = `<h1>${ME.role === "admin" ? "Admin dashboard" : ME.role === "doctor" ? "My schedule" : "My appointments"}</h1><p class="muted">Signed in as ${esc(ME.name)} ${ME.demo ? "(demo account)" : ""} · <a href="#" id="out">Log out</a></p>`;
  if (ME.role === "admin") {
    const s = await api("stats"), n = await api("notifications");
    h += `<div class="grid">${[["Today", s.today], ["Upcoming", s.upcoming], ["Patients", s.patients], ["Cancelled", s.cancelled]].map(x => `<div class="card"><div class="stat">${x[1]}</div>${x[0]}</div>`).join("")}</div>
    <h2>Find appointments</h2><form id="flt" class="row"><label>Patient or ref<input name="q" value="${esc(B.q?.q)}"></label><label>Doctor<select name="doctor"><option value="">All</option>${DR.map(d => `<option value="${d.id}" ${B.q?.doctor == d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></label><label>Date<input type="date" name="date" value="${esc(B.q?.date)}"></label><label>Status<select name="status"><option value="">All</option>${["Pending", "Confirmed", "Completed", "Cancelled"].map(x => `<option ${B.q?.status == x ? "selected" : ""}>${x}</option>`).join("")}</select></label></form><p><button class="btn sm" form="flt">Search</button> <a class="btn sm alt" href="/api/export?${q}">Export CSV</a> <button class="btn sm alt" id="rem">Queue tomorrow's reminders</button></p>${tbl(list)}
    <h2>Notification outbox</h2><p class="muted">Email is only sent when SMTP is configured. Otherwise messages are logged here and marked not sent.</p><div class="scroll"><table><tr><th>To</th><th>Subject</th><th>Status</th></tr>${n.map(x => `<tr><td>${esc(x.recipient)}</td><td>${esc(x.subject)}</td><td>${esc(x.status)}</td></tr>`).join("")}</table></div>`;
  } else h += `<h2>Upcoming</h2>${tbl(up)}<h2>Past and cancelled</h2>${tbl(past)}`;
  return h;
}

async function render() {
  const r = (location.hash.slice(2) || "home").split("?")[0], f = PAGES[r] || PAGES.home;
  document.querySelectorAll("nav a").forEach(a => a.classList.toggle("on", a.getAttribute("href") === "#/" + r));
  $("#acct").textContent = ME ? "Dashboard" : "Log in"; $("#acct").href = ME ? "#/dashboard" : "#/login";
  try { $("#app").innerHTML = await f(); } catch (e) { $("#app").innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  bind(r);
}
const showErr = (f, m) => { const e = f.querySelector(".err"); e.textContent = m; e.hidden = false; };
const fd = f => Object.fromEntries(new FormData(f));
const after = async () => { ME = (await api("me")).user; location.hash = "#/dashboard"; render(); };

function bind(r) {
  const on = (s, ev, fn) => document.querySelectorAll(s).forEach(e => e.addEventListener(ev, fn));
  on("[data-doc]:not([data-rs])", "click", e => { B = {step: 2, doctor: e.target.dataset.doc}; });
  if (r === "services") $("#sq").oninput = e => $("#res").innerHTML = svcCards(SV.filter(s => (s.name + s.description).toLowerCase().includes(e.target.value.toLowerCase())));
  if (r === "doctors") $("#dq").oninput = e => $("#res").innerHTML = drCards(DR.filter(d => (d.name + d.specialty).toLowerCase().includes(e.target.value.toLowerCase())));
  if (r === "contact") $("#cf").onsubmit = async e => { e.preventDefault(); try { await api("contact", fd(e.target)); e.target.reset(); toast("Message sent to the clinic."); } catch (x) { showErr(e.target, x.message); } };
  if (r === "login") { $("#lf").onsubmit = async e => { e.preventDefault(); try { await api("login", fd(e.target)); after(); } catch (x) { showErr(e.target, x.message); } };
    $("#rf").onsubmit = async e => { e.preventDefault(); try { await api("register", fd(e.target)); after(); } catch (x) { showErr(e.target, x.message); } }; }
  if (r === "book") {
    on("[data-svc]", "click", e => { B.service = e.currentTarget.dataset.svc; B.doctor = ""; B.step = 2; render(); });
    on("[data-doc2]", "click", e => { B.doctor = e.currentTarget.dataset.doc2; B.step = 3; render(); });
    if ($("#back")) $("#back").onclick = () => { B.step--; render(); };
    if ($("#dt")) { const load = async () => { B.date = $("#dt").value; B.time = ""; if (!B.date) return;
        const l = await api(`slots?service=${B.service}&doctor=${B.doctor || ""}&date=${B.date}`);
        $("#sl").innerHTML = l.length ? l.map(t => `<button class="slot" data-t="${t}">${t}</button>`).join("") : "No times available that day. Try another date.";
        on(".slot", "click", e => { B.time = e.target.dataset.t; B.step = 4; render(); }); };
      $("#dt").onchange = load; if (B.date) load(); }
    if ($("#pf")) $("#pf").onsubmit = e => { e.preventDefault(); B.f = fd(e.target); B.step = 5; render(); };
    if ($("#go")) $("#go").onclick = async e => { e.target.disabled = true; e.target.textContent = "Booking...";
      try { B.done = await api("book", {...B.f, service: B.service, doctor: B.doctor, date: B.date, time: B.time}); B.step = 6; render(); toast("Booking confirmed."); }
      catch (x) { e.target.disabled = false; e.target.textContent = "Confirm booking"; showErr($("#app"), x.message); const p = $("#app .err"); p.hidden = false; } };
    if ($("#again")) $("#again").onclick = () => { B = {step: 1}; };
  }
  if (r === "dashboard") {
    if ($("#out")) $("#out").onclick = async e => { e.preventDefault(); await api("logout", {}); ME = null; location.hash = "#/home"; render(); };
    if ($("#flt")) $("#flt").onsubmit = e => { e.preventDefault(); B.q = Object.fromEntries([...new FormData(e.target)].filter(x => x[1])); render(); };
    if ($("#rem")) $("#rem").onclick = async () => { const x = await api("reminders", {}); toast(x.queued + " reminder(s) queued."); render(); };
    on("[data-st]", "click", async e => { const d = e.target.dataset; if (d.v === "Cancelled" && !confirm("Cancel this appointment?")) return;
      try { await api(`appointments/${d.st}/status`, {status: d.v}); toast("Appointment " + d.v.toLowerCase() + "."); } catch (x) { toast(x.message); } render(); });
    on("[data-rs]", "click", async e => { const d = e.target.dataset, nd = prompt("New date (YYYY-MM-DD):", today()); if (!nd) return;
      try { const l = await api(`slots?service=${d.svc}&doctor=${d.doc}&date=${nd}`); if (!l.length) return toast("No times available that day.");
        const nt = prompt("Available times:\n" + l.join(", ") + "\n\nType one:"); if (!nt) return;
        await api(`appointments/${d.rs}/reschedule`, {date: nd, time: nt}); toast("Rescheduled."); } catch (x) { toast(x.message); } render(); });
  }
}
$("#menu").onclick = () => { const n = $("#nav"); $("#menu").setAttribute("aria-expanded", n.classList.toggle("open")); };
$("#nav").onclick = () => $("#nav").classList.remove("open");
addEventListener("hashchange", render);
(async () => { try { [INFO, SV, DR, {user: ME}] = await Promise.all([api("info"), api("services"), api("doctors"), api("me")]); } catch (e) { $("#app").innerHTML = `<p class="err">Could not reach the server. Start it with: python3 server.py</p>`; return; } render(); })();
