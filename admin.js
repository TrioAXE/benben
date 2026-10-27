const STATUSES = ["All","New","Preparing","Ready","Completed","Cancelled"];
const NEXT = {New:["Preparing","Cancelled"], Preparing:["Ready","Cancelled"], Ready:["Completed"], Completed:[], Cancelled:[]};
let key = "", filter = "All", orders = [], knownNew = null, timer = null;
let menu = [], editingId = 0;
const $ = id => document.getElementById(id);
const peso = n => "₱" + Number(n).toLocaleString();

try{ key = sessionStorage.getItem("ppKey") || ""; }catch(e){}
if(key) start();

async function api(action, body){
  const r = await fetch("api.php?action=" + action, {
    method: body ? "POST" : "GET",
    headers: {"X-Admin-Key": key, "Content-Type": "application/json"},
    body: body ? JSON.stringify(body) : undefined
  });
  return r.json();
}

async function login(){
  key = $("pw").value;
  try{
    const d = await api("list");
    if(!d.ok){ $("err").textContent = d.error || "Login failed"; return; }
    try{ sessionStorage.setItem("ppKey", key); }catch(e){}
    start();
  }catch(e){ $("err").textContent = "Cannot reach api.php – run this on a PHP server (e.g. XAMPP)."; }
}
function logout(){ try{ sessionStorage.removeItem("ppKey"); }catch(e){} clearInterval(timer); location.reload(); }

function start(){
  $("loginView").style.display = "none"; $("dash").style.display = "block";
  refresh(); timer = setInterval(refresh, 5000);
}

// ---------- Switch between Orders and Menu ----------
function showView(v){
  $("ordersView").style.display = v === "orders" ? "block" : "none";
  $("menuView").style.display   = v === "menu"   ? "block" : "none";
  $("tabOrders").classList.toggle("active", v === "orders");
  $("tabMenu").classList.toggle("active", v === "menu");
  if(v === "menu") loadMenu();
}

async function refresh(){
  try{
    const d = await api("list");
    if(!d.ok){ logout(); return; }
    orders = d.orders.slice().reverse();
    const newCount = orders.filter(o => o.status === "New").length;
    if(knownNew !== null && newCount > knownNew) beep();
    knownNew = newCount;
    $("live").style.color = "#66bb6a";
    render();
  }catch(e){ $("live").style.color = "#ef5350"; }
}

function beep(){
  try{
    const a = new (window.AudioContext || window.webkitAudioContext)(), o = a.createOscillator(), g = a.createGain();
    o.connect(g); g.connect(a.destination); o.frequency.value = 880; g.gain.value = .2;
    o.start(); o.stop(a.currentTime + .4);
  }catch(e){}
}

function render(){
  const d = new Date(), today = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  const todays = orders.filter(o => o.time.startsWith(today));
  $("sNew").textContent = orders.filter(o => o.status === "New").length;
  $("sActive").textContent = orders.filter(o => ["Preparing","Ready"].includes(o.status)).length;
  $("sToday").textContent = todays.length;
  $("sSales").textContent = peso(todays.filter(o => o.status !== "Cancelled").reduce((s,o) => s + o.total, 0));

  $("filters").innerHTML = STATUSES.map(s =>
    `<button class="f ${s===filter?'active':''}" onclick="setFilter('${s}')">${s}</button>`).join("");

  const list = orders.filter(o => filter === "All" || o.status === filter);
  $("orders").innerHTML = list.length ? list.map(o => `
    <div class="order ${o.status}">
      <div class="top"><strong>${esc(o.no)}</strong><span class="badge">${o.status}</span></div>
      <div class="meta">${esc(o.name)} · ${o.type} · ${esc(o.ref)}<br>${o.time}</div>
      <ul>${o.lines.map(l => `<li><span>${l.qty}× ${esc(l.name)}</span><span>${peso(l.subtotal)}</span></li>`).join("")}</ul>
      <div class="total"><span>Total</span><span>${peso(o.total)}</span></div>
      <div class="actions">${NEXT[o.status].map(s => `<button class="b-${s}" onclick="setStatus('${o.no}','${s}')">${s}</button>`).join("")}</div>
    </div>`).join("") : `<p class="empty">No orders here yet.</p>`;
}

function setFilter(f){ filter = f; render(); }
async function setStatus(no, status){
  await api("status", {no, status});
  refresh();
}
function esc(s){ return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

// ---------- Menu management ----------
async function loadMenu(){
  try{
    const d = await api("menu_all");
    if(!d.ok){ alert(d.error || "Could not load menu."); return; }
    menu = d.menu;
    renderMenuAdmin();
  }catch(e){
    $("menuList").innerHTML = `<p class="empty">Cannot reach api.php.</p>`;
  }
}

function renderMenuAdmin(){
  // group by category, keeping the order the server sent
  const groups = {};
  menu.forEach(m => (groups[m.cat] = groups[m.cat] || []).push(m));

  $("catList").innerHTML = Object.keys(groups).map(c => `<option value="${esc(c)}">`).join("");

  $("menuList").innerHTML = menu.length ? Object.keys(groups).map(c => `
    <h3 class="mcat">${esc(c)}</h3>
    <div class="mgrid">${groups[c].map(m => `
      <div class="mitem ${m.available ? "" : "off"}">
        <div class="mtop"><strong>${esc(m.name)}</strong><strong>${peso(m.price)}</strong></div>
        <p>${esc(m.desc) || "<i>No description</i>"}</p>
        <div class="mtags">
          ${m.diet.map(t => `<span class="mtag">${esc(t)}</span>`).join("")}
          ${m.available ? "" : `<span class="mtag hidden">Hidden</span>`}
        </div>
        <div class="mbtns">
          <button onclick="openItem(${m.id})">Edit</button>
          <button onclick="toggleAvail(${m.id})">${m.available ? "Hide" : "Show"}</button>
          <button class="del" onclick="deleteItem(${m.id})">Delete</button>
        </div>
      </div>`).join("")}
    </div>`).join("") : `<p class="empty">No menu items yet. Click "+ Add item".</p>`;
}

function openItem(id){
  const m = id ? menu.find(x => x.id === id) : null;
  editingId = m ? m.id : 0;
  $("itemTitle").textContent = m ? "Edit item" : "Add item";
  $("fName").value  = m ? m.name : "";
  $("fCat").value   = m ? m.cat : "";
  $("fDesc").value  = m ? m.desc : "";
  $("fPrice").value = m ? m.price : "";
  $("fV").checked   = m ? m.diet.includes("V") : false;
  $("fGF").checked  = m ? m.diet.includes("GF") : false;
  $("fAvail").checked = m ? m.available : true;
  $("fErr").textContent = "";
  $("itemModal").classList.add("show");
  $("fName").focus();
}
function closeItem(){ $("itemModal").classList.remove("show"); }

async function saveItem(){
  const name = $("fName").value.trim(), cat = $("fCat").value.trim();
  const desc = $("fDesc").value.trim(), price = $("fPrice").value;
  if(!name || !cat){ $("fErr").textContent = "Name and category are required."; return; }
  if(price === "" || isNaN(price) || Number(price) < 0){ $("fErr").textContent = "Enter a valid price."; return; }

  const diet = [];
  if($("fV").checked) diet.push("V");
  if($("fGF").checked) diet.push("GF");

  try{
    const d = await api("menu_save", {
      id: editingId, name, cat, desc, price: Number(price), diet, available: $("fAvail").checked
    });
    if(!d.ok){ $("fErr").textContent = d.error || "Could not save."; return; }
    closeItem();
    loadMenu();
  }catch(e){ $("fErr").textContent = "Cannot reach the server."; }
}

async function toggleAvail(id){
  const m = menu.find(x => x.id === id);
  if(!m) return;
  try{
    const d = await api("menu_save", {...m, available: !m.available});
    if(!d.ok){ alert(d.error || "Could not update."); return; }
    loadMenu();
  }catch(e){ alert("Cannot reach the server."); }
}

async function deleteItem(id){
  const m = menu.find(x => x.id === id);
  if(!m || !confirm(`Delete "${m.name}" from the menu?\n\nPast orders keep their records. (Tip: use Hide to remove it temporarily.)`)) return;
  try{
    const d = await api("menu_delete", {id});
    if(!d.ok){ alert(d.error || "Could not delete."); return; }
    loadMenu();
  }catch(e){ alert("Cannot reach the server."); }
}
