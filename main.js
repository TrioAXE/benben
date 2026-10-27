let MENU = [], CATS = ["All"];
let cat = "All", cart = {};

const peso = n => "₱" + Number(n).toLocaleString();
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

async function api(action, body){
  const r = await fetch("api.php?action=" + action, {
    method: body ? "POST" : "GET",
    headers: {"Content-Type": "application/json"},
    body: body ? JSON.stringify(body) : undefined
  });
  return r.json();
}

async function loadMenu(){
  try{
    const d = await api("menu");
    if(!d.ok) throw new Error(d.error);
    MENU = d.menu;
    CATS = ["All", ...new Set(MENU.map(m => m.cat))];
    renderTabs(); renderMenu();
  }catch(e){
    $("grid").innerHTML = `<p class="empty" style="grid-column:1/-1;color:#fff">Could not load the menu. Make sure XAMPP (Apache + MySQL) is running and you opened this page via http://localhost/.</p>`;
  }
}

function renderTabs(){
  $("tabs").innerHTML = CATS.map(c =>
    `<button class="tab ${c===cat?'active':''}" onclick="setCat('${c.replace(/'/g,"\\'")}')">${esc(c)}</button>`).join("");
}
function setCat(c){ cat = c; renderTabs(); renderMenu(); }

function renderMenu(){
  $("grid").innerHTML = MENU.filter(m => cat==="All" || m.cat===cat).map(m => `
    <div class="card">
      <h3>${esc(m.name)}${m.diet.map(d=>`<span class="tag ${d==='GF'?'gf':''}">${esc(d)}</span>`).join("")}</h3>
      <p>${esc(m.desc)}</p>
      <div class="row"><span class="price">${peso(m.price)}</span>
      <button class="add" onclick="addItem(${m.id})">Add</button></div>
    </div>`).join("");
}

function addItem(id){ cart[id] = (cart[id]||0) + 1; renderCart(); }
function changeQty(id, d){ cart[id] += d; if(cart[id] <= 0) delete cart[id]; renderCart(); }

function renderCart(){
  const ids = Object.keys(cart);
  let total = 0, count = 0;
  $("items").innerHTML = ids.length ? ids.map(id => {
    const m = MENU.find(x => x.id == id), q = cart[id];
    total += m.price * q; count += q;
    return `<div class="item">
      <div>${esc(m.name)}<br><small>${peso(m.price)} each</small></div>
      <div class="qty"><button onclick="changeQty(${id},-1)">−</button>${q}<button onclick="changeQty(${id},1)">+</button></div>
      <strong>${peso(m.price*q)}</strong></div>`;
  }).join("") : `<p class="empty">Your cart is empty.</p>`;
  $("total").textContent = peso(total);
  $("count").textContent = count;
  $("place").disabled = !count;
}

function toggleCart(open){
  $("cart").classList.toggle("show", open);
  $("overlay").classList.toggle("show", open);
}
function toggleMenu(){ $("subMenu").classList.toggle("open-menu"); }

// "My Orders" = this browser's own history (order numbers come from the server)
function getOrders(){ try{ return JSON.parse(localStorage.getItem("ppOrders")) || []; }catch(e){ return []; } }
function saveOrders(o){ try{ localStorage.setItem("ppOrders", JSON.stringify(o)); }catch(e){} }

async function placeOrder(){
  const name = $("name").value.trim(), ref = $("table").value.trim();
  if(!name || !ref){ alert("Please enter your name and table / contact number."); return; }

  const btn = $("place");
  btn.disabled = true; btn.textContent = "Placing…";
  try{
    const d = await api("create", {
      name, ref, type: $("type").value,
      items: Object.keys(cart).map(id => ({id: Number(id), qty: cart[id]}))
    });
    if(!d.ok){ alert(d.error || "Could not place order."); return; }

    const order = d.order;
    saveOrders([...getOrders(), order]);
    statusMap[order.no] = "New";
    cart = {}; renderCart(); toggleCart(false);
    $("name").value = ""; $("table").value = "";
    $("modalBody").innerHTML = `<h2>Order placed! 🎉</h2>
      <p>Order <b>${esc(order.no)}</b> for ${esc(order.name)} (${esc(order.type)})</p>
      <p>Total: <b>${peso(order.total)}</b></p>
      <p>You can follow your order's progress in My Orders.</p>
      <button onclick="closeModal()">OK</button> <button onclick="showOrders()">Track my order</button>`;
    $("modal").classList.add("show");
    modalMode = "";
  }catch(e){
    alert("Cannot reach the server. Is XAMPP running?");
  }finally{
    btn.textContent = "Place Order";
    btn.disabled = !Object.keys(cart).length;
  }
}

// ---------- Order progress tracking ----------
const STEPS = ["New","Preparing","Ready","Completed"];
const STEP_LABEL = {New:"Received", Preparing:"Preparing", Ready:"Ready", Completed:"Completed"};
const STEP_MSG = {
  New:"We received your order.", Preparing:"Your order is being prepared.",
  Ready:"Your order is ready!", Completed:"Order completed. Enjoy!", Cancelled:"This order was cancelled."
};
let statusMap = {}, statusLoaded = false, modalMode = "";

function trackerHTML(no){
  const s = statusMap[no];
  if(!s) return `<small class="trk-note">${statusLoaded ? "Status not available." : "Checking status…"}</small>`;
  if(s === "Cancelled") return `<p class="trk-cancel">Order cancelled</p>`;
  const at = s === "Completed" ? STEPS.length : STEPS.indexOf(s);
  return `<ol class="trk">${STEPS.map((x,i) =>
    `<li class="${i<at?'done':i===at?'now':''}"><span class="dot"></span>${STEP_LABEL[x]}</li>`).join("")}</ol>
    <small class="trk-note">${STEP_MSG[s]}</small>`;
}

async function refreshStatuses(){
  const nos = getOrders().map(o => o.no);
  if(!nos.length) return;
  try{
    const d = await api("track", {nos});
    if(d.ok){ statusMap = d.status; statusLoaded = true; }
  }catch(e){}
}

function renderOrdersModal(){
  const o = getOrders().slice().reverse();
  $("modalBody").innerHTML = `<h2>My Orders</h2>` + (o.length
    ? o.map(x => `<article class="ord"><b>${esc(x.no)}</b> – ${peso(x.total)}<br>
        <small>${x.lines.map(l=>l.qty+"× "+esc(l.name)).join(", ")}<br>${esc(x.time)}</small>
        ${trackerHTML(x.no)}</article>`).join("")
    : "<p>No orders yet.</p>") + `<button onclick="closeModal()">Close</button>`;
}

async function showOrders(){
  $("subMenu").classList.remove("open-menu");
  modalMode = "orders";
  renderOrdersModal();
  $("modal").classList.add("show");
  await refreshStatuses();
  if(modalMode === "orders") renderOrdersModal();
}
function closeModal(){ $("modal").classList.remove("show"); modalMode = ""; }

function toast(msg){
  let t = $("toast");
  if(!t){
    t = document.createElement("div"); t.id = "toast"; t.className = "toast";
    t.onclick = () => { t.classList.remove("show"); showOrders(); };
    document.body.appendChild(t);
  }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 6000);
}

async function pollActive(){
  const active = getOrders().filter(o => !["Completed","Cancelled"].includes(statusMap[o.no]));
  if(!active.length) return;
  const before = {...statusMap};
  await refreshStatuses();
  active.forEach(o => {
    if(before[o.no] && statusMap[o.no] && before[o.no] !== statusMap[o.no])
      toast(`Order ${o.no}: ${STEP_MSG[statusMap[o.no]]}`);
  });
  if(modalMode === "orders") renderOrdersModal();
}

renderCart();
loadMenu();
refreshStatuses();
setInterval(pollActive, 6000);
