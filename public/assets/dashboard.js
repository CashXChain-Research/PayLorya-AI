var un={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"},s=e=>String(e??"").replace(/[&<>"']/g,t=>un[t]);var me=e=>e&&e.length>22?`${e.slice(0,12)}\u2026${e.slice(-6)}`:e||"",rt=e=>e?`${e.slice(0,8)}\u2026${e.slice(-6)}`:"",pn={JPY:0},mn=e=>e==="ADA"?6:pn[e]??2;function It(e,t){let a=mn(t);return(e/10**a).toLocaleString("en-US",{minimumFractionDigits:t==="ADA"?2:a,maximumFractionDigits:a})}function it(e,t){return e==null||!t?"":t==="ADA"?`${It(e,t)} tADA`:`${t} ${It(e,t)}`}var hn="cxc-theme",Bt=matchMedia("(prefers-color-scheme: dark)");function Te(){let e=document.documentElement.dataset.theme;return e==="light"||e==="dark"?e:Bt.matches?"dark":"light"}function lt(e){let t=document.documentElement;t.classList.add("theme-anim"),t.dataset.theme=e;try{localStorage.setItem(hn,e)}catch{}window.setTimeout(()=>t.classList.remove("theme-anim"),450),ct()}function ct(){let e=Te()==="dark";for(let t of document.querySelectorAll("[data-theme-toggle]"))t.setAttribute("aria-pressed",String(e)),t.title=e?"Switch to light mode":"Switch to dark mode"}function Nt(){for(let e of document.querySelectorAll("[data-theme-toggle]"))e.addEventListener("click",()=>lt(Te()==="dark"?"light":"dark"));Bt.addEventListener("change",ct),ct()}var fn={home:'<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',chat:'<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z"/>',doc:'<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',pay:'<path d="M3 7h18v12H3z"/><path d="M3 11h18M7 15h3"/>',budget:'<path d="M21 12a9 9 0 1 1-9-9v9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',payees:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.7.8 2.8 2.5 3 5.2"/>',link:'<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',shield:'<path d="M12 3l8 4v5c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V7l8-4z"/>',shieldCheck:'<path d="M12 3l8 4v5c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V7l8-4z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',activity:'<path d="M3 12h4l3-8 4 16 3-8h4"/>',settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',plus:'<path d="M12 5v14M5 12h14"/>',check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',x:'<path d="M6 6l12 12M18 6L6 18"/>',send:'<path d="M12 19V5M5 12l7-7 7 7"/>',stop:'<rect x="7" y="7" width="10" height="10" rx="2"/>',clip:'<path d="M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9"/>',upload:'<path d="M12 16V4M6 10l6-6 6 6"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',download:'<path d="M12 4v12M6 10l6 6 6-6"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',trash:'<path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3"/>',edit:'<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',refresh:'<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8"/><path d="M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16"/><path d="M20 20v-4h-4"/>',copy:'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',external:'<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',chevron:'<path d="M9 6l6 6-6 6"/>',chevronDown:'<path d="M6 9l6 6 6-6"/>',chevronLeft:'<path d="M15 6l-6 6 6 6"/>',menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',logout:'<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 16l-4-4 4-4M6 12h10"/>',user:'<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.2 4-6.5 8-6.5s7.2 2.3 8 6.5"/>',bot:'<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13v1.5M15 13v1.5M2 13v3M22 13v3"/>',cog:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',sparkle:'<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',wallet:'<path d="M4 7a2 2 0 0 1 2-2h12v4"/><path d="M4 7v11a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2z"/><circle cx="16" cy="14.5" r="1.2"/>',bank:'<path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18"/>',globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',lock:'<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',eye:'<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',alert:'<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',search:'<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',moon:'<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',trend:'<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',image:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',invoice:'<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><path d="M12.5 10.5v8M14.5 12h-2.75a1.6 1.6 0 0 0 0 3.2h1.5a1.6 1.6 0 0 1 0 3.2H10"/>',receipt:'<path d="M6 3h12v18l-2.4-1.6L13.2 21l-2.4-1.6L8.4 21 6 19.4z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>',contract:'<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/><path d="M8.5 17.5c1.2-2.2 2.2-2.2 2.7-.2.4 1.6 1.4 1 2.3-.4.6-.9 1.3-.6 1.8.6"/>',percent:'<path d="M19 5 5 19"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',file:'<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/>',arrowRight:'<path d="M5 12h14M13 6l6 6-6 6"/>',arrowUp:'<path d="M7 17L17 7M9 7h8v8"/>',arrowDown:'<path d="M17 7L7 17M15 17H7V9"/>',more:'<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',zap:'<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',key:'<circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',webhook:'<path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="M6 17l3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06"/><path d="M12 6l3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8"/>',code:'<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>'};function u(e,t=18,a=1.9){return`<svg class="i" width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${a}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${fn[e]??""}</svg>`}var yn={JPY:0,ADA:6},Rt=e=>yn[e]??2;function H(e,t={}){let a=(e??0)/100,n=Math.abs(a),r;if(t.compact&&n>=1e3)r="$"+new Intl.NumberFormat("en-US",{notation:"compact",maximumFractionDigits:n>=1e5?0:1}).format(n);else{let i=t.cents===!1||t.compact&&n>=100?0:2;r="$"+n.toLocaleString("en-US",{minimumFractionDigits:i,maximumFractionDigits:i})}return a<0?`\u2212${r}`:t.sign&&a>0?`+${r}`:r}function G(e,t){if(e==null||!t)return"\u2014";if(t==="ADA")return it(e,"ADA");try{let a=Rt(t);return new Intl.NumberFormat("en-US",{style:"currency",currency:t,minimumFractionDigits:a,maximumFractionDigits:a}).format(e/10**a)}catch{return it(e,t)}}function he(e,t){let a=Number(String(e).replace(/[,\s]/g,""));return Number.isFinite(a)?Math.round(a*10**Rt(t)):NaN}function He(e){let t=Number(e.amount),a=/ADA|ETH|BTC/i.test(e.asset)?4:2;return`${Number.isFinite(t)?t.toLocaleString("en-US",{minimumFractionDigits:Math.min(2,a),maximumFractionDigits:a}):e.amount} ${e.asset}`}var _t=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];function R(e,t){if(!e)return"\u2014";let a=e.length===10?new Date(`${e}T00:00:00`):new Date(e);if(Number.isNaN(a.getTime()))return e;let n=t??a.getFullYear()!==new Date().getFullYear();return`${_t[a.getMonth()]} ${a.getDate()}${n?`, ${a.getFullYear()}`:""}`}function $e(e){if(!e)return"\u2014";let t=new Date(e);return Number.isNaN(t.getTime())?e:`${R(e)}, ${t.toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"})}`}function le(e,t=!1){let[a,n]=e.split("-").map(Number),r=_t[(n??1)-1]??e;return t?`${new Date(2e3,(n??1)-1,1).toLocaleString("en-US",{month:"long"})} ${a}`:r}function xe(e){if(!e)return"";let t=(Date.now()-new Date(e).getTime())/1e3;return Number.isFinite(t)?t<45?"just now":t<3600?`${Math.round(t/60)} min ago`:t<86400?`${Math.round(t/3600)} h ago`:t<86400*7?`${Math.round(t/86400)} d ago`:R(e):""}function Pe(e){if(!e)return;let t=new Date(`${e}T00:00:00`),a=new Date;return a.setHours(0,0,0,0),Math.round((t.getTime()-a.getTime())/864e5)}function De(e){let t=Pe(e);return t==null?{text:"No due date",tone:""}:t<0?{text:`${-t} d overdue`,tone:"t-bad"}:t===0?{text:"Due today",tone:"t-warn"}:t===1?{text:"Due tomorrow",tone:"t-warn"}:{text:`Due in ${t} d`,tone:t<=7?"t-warn":"t-neutral"}}var ke=e=>e<1024?`${e} B`:e<1024*1024?`${(e/1024).toFixed(0)} KB`:`${(e/1024/1024).toFixed(1)} MB`,dt=e=>e.replace(/[_-]+/g," ").replace(/\b\w/g,t=>t.toUpperCase()),gn=e=>e.split(/\s+/).filter(Boolean).slice(0,2).map(t=>t[0].toUpperCase()).join("")||"?",bn=e=>[...e].reduce((t,a)=>t+a.charCodeAt(0),0)%3,ne=(e,t="")=>`<span class="av v${bn(e)} ${t}">${s(gn(e))}</span>`,Z={read_only:{name:"Read-only",short:"Read-only",tone:"t-ok"},guarded:{name:"Guarded",short:"Guarded",tone:"t-run"},full:{name:"Full access",short:"Full access",tone:"t-bad"}},Se={cardano_preprod:{name:"Cardano Preprod",note:"testnet \xB7 tADA"},cashxchain:{name:"CashXChain",note:"sandbox rail"},manual:{name:"Manual",note:"paid outside"}},je=e=>`<span class="rail rail-${e}"><b>${s(Se[e]?.name??e)}</b><span>${s(Se[e]?.note??"")}</span></span>`,vn={pending_approval:["Needs approval","t-warn"],approved:["Approved","t-run"],executing:["Executing","t-run"],awaiting_signature:["Sign in wallet","t-warn"],executed:["Paid","t-ok"],rejected:["Rejected","t-neutral"],failed:["Failed","t-bad"],blocked:["Blocked","t-bad"]};function Fe(e){let[t,a]=vn[e]??[e,"t-neutral"];return`<span class="pill ${a}">${e==="executing"?'<i class="live"></i>':""}${s(t)}</span>`}var fe={invoice:"Invoice",receipt:"Receipt",bank_statement:"Bank statement",contract:"Contract",payroll:"Payroll",tax:"Tax",other:"Other"},qt=0;function P(e,t="info"){let a=document.getElementById("toast");a||(a=document.createElement("div"),a.id="toast",a.className="toast",a.setAttribute("role","status"),a.setAttribute("aria-live","polite"),document.body.append(a)),a.className=`toast ${t}`,a.innerHTML=`${u(t==="error"?"alert":t==="ok"?"check":"info",16,2.2)}<span>${s(e)}</span>`,a.offsetWidth,a.classList.add("show"),window.clearTimeout(qt),qt=window.setTimeout(()=>a.classList.remove("show"),t==="error"?5200:3200)}function X(e){return new Promise(t=>{let a=document.createElement("dialog");a.className=`dlg${e.wide?" wide":""}`,a.innerHTML=`<form method="dialog" class="dlg-form" novalidate>
      <header class="dlg-head"><h2>${s(e.title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${u("x")}</button></header>
      <div class="dlg-body">${e.body}</div>
      <footer class="dlg-foot">
        <button type="button" class="btn ghost sm" data-close>${e.submit?"Cancel":"Close"}</button>
        ${e.submit?`<button type="submit" class="btn sm ${e.danger?"danger":"primary"}" data-submit>${s(e.submit)}</button>`:""}
      </footer></form>`,document.body.append(a);let n=a.querySelector("form"),r=!1,o=()=>a.close();a.addEventListener("close",()=>{a.remove(),t(r)});let i=d=>{let m=a.getBoundingClientRect();return d.clientX<m.left||d.clientX>m.right||d.clientY<m.top||d.clientY>m.bottom},l=!1;a.addEventListener("pointerdown",d=>{l=d.target===a&&i(d)}),a.addEventListener("click",d=>{l&&d.target===a&&i(d)&&o(),l=!1});for(let d of a.querySelectorAll("[data-close]"))d.addEventListener("click",o);n.addEventListener("submit",async d=>{d.preventDefault();let m=n.querySelector("[data-submit]");if(!(!m||m.disabled)){m.disabled=!0,m.classList.add("loading");try{(e.onSubmit?await e.onSubmit(n):!0)!==!1&&(r=!0,o())}catch{}finally{m.disabled=!1,m.classList.remove("loading")}}}),a.showModal();let c=document.activeElement;e.onOpen?.(n,o),document.activeElement===c&&n.querySelector("input:not([type=hidden]):not([disabled]), select, textarea")?.focus()})}function Q(e,t,a="Confirm",n=!1){return X({title:e,body:`<p class="dlg-text">${s(t)}</p>`,submit:a,danger:n})}function I(e,t,a){let n=e.elements.namedItem(t),r=n?.closest(".field");r?.classList.add("invalid");let o=r?.querySelector(".field-err");return r&&!o&&(o=document.createElement("span"),o.className="field-err",r.append(o)),o&&(o.textContent=a),n?.focus(),n?.addEventListener("input",()=>r?.classList.remove("invalid"),{once:!0}),!1}var B=(e,t)=>(e.elements.namedItem(t)?.value??"").trim(),N=(e="100%",t=14,a=8)=>`<span class="sk" style="width:${e};height:${t}px;border-radius:${a}px"></span>`,V=e=>Array.from({length:e},(t,a)=>`<div class="sk-row">${N("36px",36,12)}<div class="sk-col">${N(`${60-a%3*12}%`)}${N(`${35+a%2*10}%`,11)}</div>${N("70px")}</div>`).join(""),ye=(e=220)=>`<div class="card sk-card">${N("40%",18)}<div style="height:18px"></div>${N("100%",e-60,14)}</div>`;function j(e){return`<div class="empty-state"><div class="empty-ill">${u(e.icon,26,1.8)}</div><b>${s(e.title)}</b><p>${s(e.text)}</p>${e.action??""}</div>`}function K(e,t,a=""){return`<header class="page-head"><div class="page-title"><h1>${s(e)}</h1>${t?`<p>${t}</p>`:""}</div>${a?`<div class="page-actions">${a}</div>`:""}</header>`}async function ge(e){try{await navigator.clipboard.writeText(e),P("Copied to clipboard","ok")}catch{P("Copy failed. Select the text and copy it manually.","error")}}function Oe(e){return new Promise((t,a)=>{let n=new FileReader;n.onload=()=>{let r=String(n.result??"");t(r.slice(r.indexOf(",")+1))},n.onerror=()=>a(n.error??new Error("Could not read file")),n.readAsDataURL(e)})}var We=15*1024*1024,ze="image/*,application/pdf,text/csv,text/plain,.csv,.txt,.pdf";function Ce(e){return e.startsWith("image/")?"image":e==="application/pdf"?"doc":"file"}var wn={invoice:"invoice",receipt:"receipt",bank_statement:"bank",contract:"contract",payroll:"payees",tax:"percent"};function jt(e){return e.status==="failed"?"alert":e.kind&&wn[e.kind]||Ce(e.mimeType)}function Ue(e){if(e.type)return e.type;let t=e.name.split(".").pop()?.toLowerCase();return t==="csv"?"text/csv":t==="txt"?"text/plain":t==="pdf"?"application/pdf":"application/octet-stream"}var Me="x-paylorya-build",Ft=!1;function ut(e){if(!e||e==="2f9fe2cb9644"||Ft)return;Ft=!0;let t=document.createElement("div");t.className="update-bar",t.setAttribute("role","alert"),t.innerHTML='<span>PayLorya AI was updated. Reload to use the new version.</span><button type="button" class="btn primary xs">Reload</button>',t.querySelector("button").addEventListener("click",()=>location.reload()),document.body.append(t)}var J=class extends Error{constructor(a,n){super(a);this.status=n}status};function pt(){let e=location.pathname+location.search;throw location.href=`/login?next=${encodeURIComponent(e)}`,new J("Signed out",401)}async function Ot(e){try{let t=await e.json();if(typeof t?.error=="string"&&t.error)return t.error}catch{}return`Request failed (${e.status})`}async function Ye(e,t={}){let a=t.method??(t.body===void 0?"GET":"POST"),n;try{n=await fetch(e,{method:a,credentials:"same-origin",headers:{accept:"application/json",[Me]:"2f9fe2cb9644",...t.body===void 0?{}:{"content-type":"application/json"}},body:t.body===void 0?void 0:JSON.stringify(t.body),signal:t.signal})}catch(o){if(o.name==="AbortError")throw o;let i="Network error. Check your connection and try again.";throw t.quiet||P(i,"error"),new J(i,0)}if(ut(n.headers.get(Me)),n.status===401&&pt(),!n.ok){let o=await Ot(n);throw t.quiet||P(o,"error"),new J(o,n.status)}if(n.status===204)return;let r=await n.text();return r?JSON.parse(r):void 0}var D=(e,t=!1)=>Ye(e,{quiet:t}),O=(e,t={})=>Ye(e,{method:"POST",body:t}),ee=(e,t)=>Ye(e,{method:"PATCH",body:t}),te=e=>Ye(e,{method:"DELETE"});function Wt(e,t,a){return new Promise((n,r)=>{let o=new XMLHttpRequest;o.open("POST",e),o.withCredentials=!0,o.setRequestHeader("content-type","application/json"),o.setRequestHeader("accept","application/json"),o.setRequestHeader(Me,"2f9fe2cb9644"),o.upload.onprogress=i=>{i.lengthComputable&&a(i.loaded/i.total)},o.onerror=()=>r(new J("Network error during upload.",0)),o.onload=()=>{if(ut(o.getResponseHeader(Me)),o.status===401){try{pt()}catch(l){r(l)}return}let i;try{i=o.responseText?JSON.parse(o.responseText):void 0}catch{i=void 0}if(o.status<200||o.status>=300){let l=i?.error||`Upload failed (${o.status})`;r(new J(l,o.status));return}n(i)},o.send(JSON.stringify(t))})}async function zt(e,t,a,n){let r=await fetch(e,{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json",accept:"text/event-stream",[Me]:"2f9fe2cb9644"},body:JSON.stringify(t),signal:n});if(ut(r.headers.get(Me)),r.status===401&&pt(),!r.ok||!r.body)throw new J(await Ot(r),r.status);let o=r.body.getReader(),i=new TextDecoder,l="",c=d=>{let m="",h=[];for(let p of d.split(`
`)){let y=p.replace(/\r$/,"");y.startsWith(":")||(y.startsWith("event:")?m=y.slice(6).trim():y.startsWith("data:")&&h.push(y.slice(5).replace(/^ /,"")))}if(!h.length)return;let f;try{f=JSON.parse(h.join(`
`))}catch{return}!f.type&&m&&(f.type=m),a(f)};for(;;){let{value:d,done:m}=await o.read();if(m)break;l+=i.decode(d,{stream:!0});let h;for(;(h=l.search(/\r?\n\r?\n/))>=0;){let f=l.slice(0,h);l=l.slice(h).replace(/^\r?\n\r?\n/,""),c(f)}}l+=i.decode(),l.trim()&&c(l)}var $n={user:["user","You"],agent:["bot","AI CFO agent"],system:["cog","System"]};function xn(e){let t=e.ref;if(!t)return null;let a=encodeURIComponent(t.id);switch(t.type){case"document":return`/app/documents/${a}`;case"payment":return`/app/payments?id=${a}`;case"chat":return`/app/chat/${a}`;case"budget":return"/app/budgets";case"connection":return"/app/connections";case"payee":return"/app/payees";case"workspace":return"/app/agent"}return null}async function Yt(e,t){let a=[],n="all",r="";e.innerHTML=`${K("Activity","Audit log of everything you, the agent and the system did. Nothing is hidden.")}
    <section class="card list-card">
      <div class="list-head"><div class="chips" id="a-filter"></div><label class="search">${u("search",16)}<input id="a-q" placeholder="Search activity" aria-label="Search activity"></label></div>
      <div id="a-list"><div class="pad">${V(7)}</div></div>
    </section>`;let o=e.querySelector("#a-list"),i=()=>{let l={all:a.length,user:0,agent:0,system:0};for(let f of a)l[f.actor]=(l[f.actor]??0)+1;e.querySelector("#a-filter").innerHTML=["all","user","agent","system"].map(f=>`<button data-a="${f}" class="${n===f?"on":""}">${f==="all"?"All":f==="user"?"You":f==="agent"?"Agent":"System"} <em>${l[f]??0}</em></button>`).join("");let c=r.toLowerCase(),d=a.filter(f=>(n==="all"||f.actor===n)&&(!c||`${f.action} ${f.detail}`.toLowerCase().includes(c)));if(!d.length){o.innerHTML=j({icon:"activity",title:a.length?"No matching activity":"No activity yet",text:a.length?"Try another filter.":"Uploads, payments, approvals and setting changes are recorded here."});return}let m="",h="";for(let f of d){let p=f.at.slice(0,10);if(p!==h){h&&(m+="</ol>");let x=new Date().toISOString().slice(0,10),L=new Date(Date.now()-864e5).toISOString().slice(0,10);m+=`<h3 class="tl-day">${p===x?"Today":p===L?"Yesterday":s(R(p,!0))}</h3><ol class="timeline">`,h=p}let[y,w]=$n[f.actor]??["info",f.actor],$=xn(f);m+=`<li class="tl tl-${f.actor}"><span class="tl-ic" title="${s(w)}">${u(y,15)}</span><div class="tl-body"><p><b>${s(w)}</b> ${s(f.action)}</p>${f.detail?`<span class="tl-detail">${s(f.detail)}</span>`:""}</div><div class="tl-r"><time datetime="${s(f.at)}">${s(new Date(f.at).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"}))}</time>${$?`<a class="link-sm" href="${$}">View${u("chevron",13)}</a>`:""}</div></li>`}o.innerHTML=m+"</ol>"};e.querySelector("#a-filter").addEventListener("click",l=>{let c=l.target.closest("[data-a]");c&&(n=c.dataset.a,i())}),e.querySelector("#a-q").addEventListener("input",l=>{r=l.target.value.trim(),i()}),a=await D("/api/v1/activity?limit=100"),t.alive()&&(a.sort((l,c)=>c.at.localeCompare(l.at)),i())}var _={me:null,approvals:0},Kt=e=>{location.href=e},re=(e,t)=>Kt(e,t);function Xt(e){Kt=e}var mt=null;function Ie(e){mt={text:e},re("/app/chat")}function Gt(){let e=mt?.text??null;return mt=null,e}var ht=new Set;function Vt(e){return ht.add(e),()=>ht.delete(e)}function ie(){for(let e of ht)e()}async function Be(){try{let e=await D("/api/v1/payments",!0);_.approvals=e.filter(t=>t.status==="pending_approval"||t.status==="awaiting_signature").length,ie()}catch{}}async function Ke(){try{await fetch("/api/auth/sign-out",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:"{}"})}finally{location.href="/"}}var Jt=[{id:"read_only",icon:"eye",title:"Read-only",lead:"Analyses, plans and drafts. Never moves money.",can:["Read documents, balances and history","Summarise, forecast and plan budgets","Draft payments for you to approve"],cannot:["Execute any payment"]},{id:"guarded",icon:"shieldCheck",title:"Guarded",lead:"Pays routine bills alone, inside the limits you set.",can:["Everything in read-only","Execute payments within the per-payment limit and monthly budget","Pay only payees in your directory"],cannot:["Go over a limit or pay a new payee without your approval"]},{id:"full",icon:"alert",title:"Full access",lead:"Pays without asking you. Use with care.",can:["Execute any payment from read & write connections","No per-payment or monthly caps"],cannot:["Bypass hard policy blocks (invalid details, blocked payees)"]}];function kn(e,t){if(e.status!=="active")return{tone:"muted",text:"Not active. The agent cannot use it."};if(!e.supports.write)return{tone:"read",text:"Reads balances and history. Watch-only, cannot pay from it."};if(e.access==="read")return{tone:"read",text:"Reads balances and history. Cannot pay from it (read-only access)."};let a=t.limits,n=a.knownPayeesOnly?" to payees in your directory":"";return t.autonomy==="read_only"?{tone:"draft",text:"Reads and drafts payments. Every payment waits for your approval."}:t.autonomy==="guarded"?{tone:"guard",text:`Pays on its own${n} up to ${H(a.perPaymentUsdMinor,{cents:!1})} per payment and ${H(a.monthlyUsdMinor,{cents:!1})} per month. Everything else waits for your approval.`}:{tone:"full",text:`Pays without approval${n}. Only hard policy blocks stop it.`}}async function Zt(e,t){e.innerHTML=`${K("Agent access","Decide what your AI CFO may do on its own.")}
    <div class="trust">
      <div>${u("eye",18)}<span><b>Claude reads.</b> It sees documents and balances, never keys.</span></div>
      <div>${u("shield",18)}<span><b>Code decides.</b> Limits and payee checks run outside the model.</span></div>
      <div>${u("check",18,2.4)}<span><b>You approve.</b> Anything outside your rules waits for you.</span></div>
    </div>
    <div id="ag-body"><div class="levels">${Jt.map(()=>`<div class="card">${N("40%",20)}<div style="height:14px"></div>${N("90%",12)}<div style="height:8px"></div>${N("70%",12)}</div>`).join("")}</div></div>`;let[a,n,r]=await Promise.all([D("/api/v1/me"),D("/api/v1/connections",!0).catch(()=>[]),D("/api/v1/overview",!0).catch(()=>null)]);if(!t.alive())return;let o=a.workspace;_.me=a,ie();let i=e.querySelector("#ag-body"),l=()=>{let m=o.limits,h=r?.agent.executedThisMonthUsdMinor??0,f=m.monthlyUsdMinor?Math.min(100,h/m.monthlyUsdMinor*100):0;i.innerHTML=`
    <div class="levels" role="radiogroup" aria-label="Autonomy level">${Jt.map(p=>`<button type="button" class="card level lv-${p.id}${o.autonomy===p.id?" on":""}" role="radio" aria-checked="${o.autonomy===p.id}" data-level="${p.id}">
        <span class="lv-top"><span class="lv-ic">${u(p.icon,20)}</span><span class="lv-radio"></span></span>
        <b class="lv-t">${p.title}${p.id==="full"?'<span class="pill t-bad">Dangerous</span>':p.id==="guarded"?'<span class="pill t-neutral">Recommended</span>':""}</b>
        <span class="lv-lead">${p.lead}</span>
        <ul>${p.can.map(y=>`<li class="yes">${u("check",13,2.6)}${s(y)}</li>`).join("")}${p.cannot.map(y=>`<li class="no">${u("x",13,2.6)}${s(y)}</li>`).join("")}</ul>
      </button>`).join("")}</div>

    <div class="ag-grid">
      <form class="card" id="limits" novalidate>
        <div class="card-head"><div><h2>Limits</h2><p class="muted small">${o.autonomy==="guarded"?"Active now. The agent executes alone only within these.":o.autonomy==="full"?"Caps are not applied in full access. Known payees still applies.":"Used when you switch to guarded mode."}</p></div></div>
        <div class="grid2">
          <div class="field"><label for="l-per">Per-payment limit</label><div class="affix"><span>$</span><input id="l-per" name="per" inputmode="decimal" value="${m.perPaymentUsdMinor/100}"></div><span class="hint">Largest single payment it may execute alone</span></div>
          <div class="field"><label for="l-mon">Monthly limit</label><div class="affix"><span>$</span><input id="l-mon" name="mon" inputmode="decimal" value="${m.monthlyUsdMinor/100}"></div><span class="hint">Total it may execute alone per calendar month</span></div>
        </div>
        <label class="switch-row"><span><b>Known payees only</b><span>Only pay payees saved in your <a href="/app/payees">payee directory</a>.</span></span><input type="checkbox" name="known" class="switch" ${m.knownPayeesOnly?"checked":""}></label>
        <div class="form-foot"><span class="muted small" id="l-dirty"></span><button class="btn primary sm" type="submit" id="l-save" disabled>Save limits</button></div>
      </form>
      <section class="card">
        <div class="card-head"><h2>This month</h2><span class="pill ${Z[o.autonomy].tone}">${Z[o.autonomy].name}</span></div>
        <div class="usage"><b>${s(H(h,{cents:!1}))}</b><span>executed by the agent on its own</span></div>
        <div class="meter lg ${f>=90?"hot":""}"><i style="width:${f.toFixed(1)}%"></i></div>
        <div class="usage-foot"><span>${Math.round(f)}% of ${s(H(m.monthlyUsdMinor,{cents:!1}))}</span><span>${s(H(Math.max(0,m.monthlyUsdMinor-h),{cents:!1}))} left</span></div>
        <p class="fine">Payments you approve yourself don't count toward this limit.</p>
      </section>
    </div>

    <section class="card">
      <div class="card-head"><div><h2>What the agent can do, per connection</h2><p class="muted small">From each connection's access and the autonomy level above.</p></div><a class="link-sm" href="/app/connections">Connections${u("chevron",14)}</a></div>
      ${n.length?`<ul class="perms">${n.map(p=>{let y=kn(p,o);return`<li><span class="perm-ic p-${y.tone}">${u(y.tone==="read"||y.tone==="muted"?"eye":y.tone==="draft"?"edit":y.tone==="full"?"zap":"shieldCheck",16)}</span><div><b>${s(p.label)}</b><span class="perm-meta">${p.access==="read_write"&&p.supports.write?"Read &amp; write":"Read-only"} \xB7 ${s(p.network)}</span></div><p>${s(y.text)}</p></li>`}).join("")}</ul>`:j({icon:"link",title:"No connections",text:"Connect a wallet or account to see what the agent may do with it."})}
    </section>`,d()},c=async m=>{if(m!==o.autonomy){if(m==="full")await X({title:"Turn on full access?",submit:"Enable full access",danger:!0,body:`<div class="callout bad">${u("alert",16)}<span><b>The agent will pay without asking you.</b> No per-payment or monthly caps. Only hard policy blocks stop a payment. Testnet and sandbox rails only in this environment.</span></div>
          <div class="field"><label for="fa">Type <b class="mono">FULL ACCESS</b> to confirm</label><input id="fa" name="confirm" autocomplete="off" spellcheck="false" placeholder="FULL ACCESS"></div>`,onOpen:h=>{let f=h.elements.namedItem("confirm"),p=h.querySelector("[data-submit]");p.disabled=!0,f.addEventListener("input",()=>p.disabled=f.value.trim()!=="FULL ACCESS")},onSubmit:async h=>{let f=B(h,"confirm");return f!=="FULL ACCESS"?I(h,"confirm","Type FULL ACCESS exactly."):(o=await ee("/api/v1/workspace",{autonomy:"full",confirm:f}),!0)}});else try{o=await ee("/api/v1/workspace",{autonomy:m})}catch{return}o.autonomy===m&&P(`Agent autonomy: ${Z[m].name}`,m==="full"?"info":"ok"),_.me&&(_.me={..._.me,workspace:o}),ie(),l()}},d=()=>{let m=i.querySelector("#limits"),h=m.querySelector("#l-save"),f=()=>({perPaymentUsdMinor:he(B(m,"per"),"USD"),monthlyUsdMinor:he(B(m,"mon"),"USD"),knownPayeesOnly:m.elements.namedItem("known").checked}),p=()=>{let y=f(),w=y.perPaymentUsdMinor!==o.limits.perPaymentUsdMinor||y.monthlyUsdMinor!==o.limits.monthlyUsdMinor||y.knownPayeesOnly!==o.limits.knownPayeesOnly;h.disabled=!w,m.querySelector("#l-dirty").textContent=w?"Unsaved changes":""};m.addEventListener("input",p),m.addEventListener("change",p),m.addEventListener("submit",async y=>{y.preventDefault();let w=f();if(!Number.isFinite(w.perPaymentUsdMinor)||w.perPaymentUsdMinor<0)return void I(m,"per","Enter an amount.");if(!Number.isFinite(w.monthlyUsdMinor)||w.monthlyUsdMinor<0)return void I(m,"mon","Enter an amount.");if(w.perPaymentUsdMinor>w.monthlyUsdMinor)return void I(m,"per","Can't be higher than the monthly limit.");h.disabled=!0,h.classList.add("loading");try{o=await ee("/api/v1/workspace",{limits:w}),_.me&&(_.me={..._.me,workspace:o}),ie(),P("Limits saved","ok"),l()}catch{h.disabled=!1,h.classList.remove("loading")}})};i.addEventListener("click",m=>{let h=m.target.closest("[data-level]");h&&c(h.dataset.level)}),l()}function Ne(e,t,a){let n=0,r=()=>{let i=Math.floor(e.clientWidth);!i||i===n||(n=i,e.innerHTML=t(i),a?.(e))};r();let o=new ResizeObserver(()=>r());return o.observe(e),()=>o.disconnect()}function Qt(e,t=0,a=4){let r=Math.max(1,e-t)/a,o=10**Math.floor(Math.log10(r)),i=([1,2,2.5,5,10].find(m=>m*o>=r)??10)*o,l=Math.floor(t/i)*i,c=Math.ceil(e/i)*i,d=[];for(let m=l;m<=c+i/2;m+=i)d.push(Math.round(m));return d}function ea(e){return t=>{let n={l:52,r:8,t:12,b:28},r=Math.max(1,...e.flatMap(p=>[p.inUsdMinor,p.outUsdMinor])),o=Qt(r),i=o[o.length-1],l=t-n.l-n.r,c=240-n.t-n.b,d=p=>n.t+c-p/i*c,m=l/Math.max(1,e.length),h=Math.min(22,m*.28),f=`<svg width="${t}" height="240" viewBox="0 0 ${t} 240" role="img" aria-label="Money in and out, last ${e.length} months">`;for(let p of o)f+=`<line class="grid" x1="${n.l}" x2="${t-n.r}" y1="${d(p)}" y2="${d(p)}"/><text class="axis" x="${n.l-10}" y="${d(p)+4}" text-anchor="end">${s(H(p,{compact:!0}))}</text>`;return e.forEach((p,y)=>{let w=n.l+m*y+m/2,$=Math.max(p.inUsdMinor?2:0,p.inUsdMinor/i*c),x=Math.max(p.outUsdMinor?2:0,p.outUsdMinor/i*c),L=p.inUsdMinor-p.outUsdMinor;f+=`<g class="bar-g" tabindex="0"><title>${s(le(p.month,!0))}: in ${s(H(p.inUsdMinor))}, out ${s(H(p.outUsdMinor))}, net ${s(H(L,{sign:!0}))}</title>
        <rect class="hit" x="${w-m/2}" y="${n.t}" width="${m}" height="${c}"/>
        <rect class="bar-in" x="${w-h-2}" y="${n.t+c-$}" width="${h}" height="${$}" rx="${Math.min(5,h/3)}"/>
        <rect class="bar-out" x="${w+2}" y="${n.t+c-x}" width="${h}" height="${x}" rx="${Math.min(5,h/3)}"/>
        <text class="axis" x="${w}" y="232" text-anchor="middle">${s(le(p.month))}</text></g>`}),f+"</svg>"}}function Xe(e,t=260){let a=e.points,n=null;return{draw:i=>{let l=t,c={l:56,r:12,t:16,b:30};if(a.length<2)return'<div class="chart-empty"><span>No forecast yet. <a href="/app/connections">Connect a wallet</a> and <a href="/app/documents">upload invoices</a> to see where your cash is heading.</span></div>';let d=a.map(T=>T.balanceUsdMinor),m=Qt(Math.max(...d,0),Math.min(...d,0)),h=m[0],f=m[m.length-1],p=i-c.l-c.r,y=l-c.t-c.b,w=T=>c.l+T/(a.length-1)*p,$=T=>c.t+y-(T-h)/Math.max(1,f-h)*y;n={x:w,y:$,l:c.l,r:i-c.r,t:c.t,b:c.t+y};let x=`<svg width="${i}" height="${l}" viewBox="0 0 ${i} ${l}" role="img" aria-label="Cash forecast, next ${e.days} days">
      <defs><linearGradient id="fc-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" class="fc-stop-a"/><stop offset="1" class="fc-stop-b"/></linearGradient></defs>`;for(let T of m)x+=`<line class="grid${T===0&&h<0?" zero":""}" x1="${c.l}" x2="${i-c.r}" y1="${$(T)}" y2="${$(T)}"/><text class="axis" x="${c.l-10}" y="${$(T)+4}" text-anchor="end">${s(H(T,{compact:!0}))}</text>`;let L=Math.max(1,Math.round(a.length/Math.max(2,Math.floor(p/90))));for(let T=0;T<a.length;T+=L)x+=`<text class="axis" x="${w(T)}" y="${l-8}" text-anchor="${T===0?"start":"middle"}">${s(R(a[T].date,!1))}</text>`;let M=a.map((T,q)=>`${q?"L":"M"}${w(q).toFixed(1)},${$(T.balanceUsdMinor).toFixed(1)}`).join(""),E=$(Math.max(h,0));x+=`<path class="fc-area" d="${M}L${w(a.length-1)},${E}L${w(0)},${E}Z" fill="url(#fc-fill)"/>`,x+=`<path class="fc-line" d="${M}" pathLength="1"/>`;let A=new Map(a.map((T,q)=>[T.date,q]));for(let T of e.events){let q=A.get(T.date);if(q==null)continue;let S=$(a[q].balanceUsdMinor);x+=`<g class="fc-ev ${T.usdMinor<0?"out":"in"}"><title>${s(R(T.date))} \xB7 ${s(T.label)} \xB7 ${s(H(T.usdMinor,{sign:!0}))}</title><line x1="${w(q)}" x2="${w(q)}" y1="${S}" y2="${c.t+y}"/><circle cx="${w(q)}" cy="${S}" r="4.5"/></g>`}return x+=`<g class="fc-hover" style="display:none"><line class="fc-cross" y1="${c.t}" y2="${c.t+y}"/><circle class="fc-dot" r="5"/></g>`,x+"</svg>"},wire:i=>{let l=i.querySelector("svg");if(!l||!n)return;let c=i.parentElement?.querySelector(".chart-tip");c||(c=document.createElement("div"),c.className="chart-tip",i.parentElement?.append(c));let d=l.querySelector(".fc-hover"),m=d.querySelector("line"),h=d.querySelector("circle"),f=y=>{if(!n)return;let w=l.getBoundingClientRect(),$=y-w.left,x=Math.max(0,Math.min(a.length-1,Math.round(($-n.l)/(n.r-n.l)*(a.length-1)))),L=a[x],M=n.x(x),E=n.y(L.balanceUsdMinor);d.style.display="",m.setAttribute("x1",String(M)),m.setAttribute("x2",String(M)),h.setAttribute("cx",String(M)),h.setAttribute("cy",String(E));let A=e.events.filter(S=>S.date===L.date);c.innerHTML=`<span>${s(R(L.date))}</span><b>${s(H(L.balanceUsdMinor))}</b>${A.map(S=>`<em class="${S.usdMinor<0?"out":"in"}">${s(S.label)} ${s(H(S.usdMinor,{sign:!0}))}</em>`).join("")}`,c.style.opacity="1";let T=c.offsetWidth,q=Math.min(Math.max(M-T/2,0),w.width-T);c.style.transform=`translate(${q}px, ${Math.max(0,E-76)}px)`},p=()=>{d.style.display="none",c.style.opacity="0"};l.addEventListener("pointermove",y=>f(y.clientX)),l.addEventListener("pointerleave",p)}}}function ta(e,t=6){let a=[...e].filter(l=>l.usdMinor>0).sort((l,c)=>c.usdMinor-l.usdMinor),n=a.slice(0,t),r=a.slice(t).reduce((l,c)=>l+c.usdMinor,0);r>0&&n.push({category:`Other (${a.length-t})`,usdMinor:r});let o=a.reduce((l,c)=>l+c.usdMinor,0)||1,i=Math.max(1,...n.map(l=>l.usdMinor));return`<ul class="hbars">${n.map((l,c)=>`<li style="--d:${c*50}ms"><div class="hb-top"><span>${s(l.category)}</span><b>${s(H(l.usdMinor,{cents:!1}))}</b><em>${Math.round(l.usdMinor/o*100)}%</em></div>
      <div class="hb-track"><i style="width:${Math.max(2,l.usdMinor/i*100).toFixed(1)}%"></i></div></li>`).join("")}</ul>`}var Cn=["Software","Payroll","Rent","Marketing","Travel","Hosting","Contractors","Office","Legal & accounting","Taxes"];async function aa(e,t){let a=null,n=[...new Set([...t,...Cn])].sort();return await X({title:e?"Edit budget":"New budget",submit:e?"Save budget":"Create budget",body:`<div class="field"><label for="b-name">Name</label><input id="b-name" name="name" value="${s(e?.name??"")}" placeholder="Software subscriptions" autocomplete="off"></div>
      <div class="grid2">
        <div class="field"><label for="b-cat">Category</label><input id="b-cat" name="category" list="b-cats" value="${s(e?.category??"")}" placeholder="Software" autocomplete="off"><datalist id="b-cats">${n.map(r=>`<option value="${s(r)}">`).join("")}</datalist></div>
        <div class="field"><label for="b-limit">Monthly limit (USD)</label><div class="affix"><span>$</span><input id="b-limit" name="limit" inputmode="decimal" value="${e?e.limitUsdMinor/100:""}" placeholder="2,000"></div></div>
      </div>
      <p class="fine">Spending is matched by transaction category. The AI CFO warns you before a payment would push a budget over.</p>`,onSubmit:async r=>{let o=B(r,"name"),i=B(r,"category"),l=he(B(r,"limit"),"USD");if(!o)return I(r,"name","Give the budget a name.");if(!i)return I(r,"category","Choose a category.");if(!Number.isFinite(l)||l<=0)return I(r,"limit","Enter a monthly limit above zero.");let c={name:o,category:i,limitUsdMinor:l};return a=e?await ee(`/api/v1/budgets/${encodeURIComponent(e.id)}`,c):await O("/api/v1/budgets",c),P(e?"Budget saved":"Budget created","ok"),!0}}),a}function Mn(e,t){let a=e.limitUsdMinor?e.spentUsdMinor/e.limitUsdMinor*100:0,n=a>100,r=!n&&a>=85,o=e.limitUsdMinor-e.spentUsdMinor;return`<article class="card bud-card reveal ${n?"over":r?"warn":""}" style="--d:${t*40}ms">
    <div class="bc-head"><div><h3>${s(e.name)}</h3>${e.category.toLowerCase()===e.name.toLowerCase()?'<span class="muted small">Monthly budget</span>':`<span class="cat">${s(e.category)}</span>`}</div>
      <div class="bc-act"><button class="icon-btn" type="button" data-edit="${s(e.id)}" aria-label="Edit ${s(e.name)}">${u("edit",16)}</button><button class="icon-btn danger-h" type="button" data-del="${s(e.id)}" aria-label="Delete ${s(e.name)}">${u("trash",16)}</button></div></div>
    <div class="bc-num"><b>${s(H(e.spentUsdMinor,{cents:!1}))}</b><span>of ${s(H(e.limitUsdMinor,{cents:!1}))} this month</span></div>
    <div class="meter lg"><i style="width:${Math.min(100,a).toFixed(1)}%"></i></div>
    <div class="bc-foot">${n?`<span class="over-l">${u("alert",13,2.4)}Over budget by ${s(H(-o,{cents:!1}))}</span>`:r?`<span class="warn-l">${u("alert",13,2.4)}${Math.round(a)}% used \xB7 ${s(H(o,{cents:!1}))} left</span>`:`<span>${Math.round(a)}% used</span><span>${s(H(o,{cents:!1}))} left</span>`}</div>
  </article>`}async function na(e,t){let a=new Date,n=`${a.getFullYear()}-${String(a.getMonth()+1).padStart(2,"0")}`,r=n,o=[],i=[];e.innerHTML=`${K("Budgets & planning","Monthly limits per category, where the money went, and where your cash is heading.",`<button class="btn primary sm" type="button" id="b-new">${u("plus",16,2.4)}New budget</button>`)}
    <section class="stat-row" id="b-stats">${Array.from({length:3},()=>`<div class="stat-card">${N("50%",12)}<div style="height:10px"></div>${N("60%",26)}</div>`).join("")}</section>
    <section class="bud-grid" id="b-grid">${ye(160)}${ye(160)}${ye(160)}</section>
    <section class="card chart-card"><div class="card-head"><div><h2>Cash forecast</h2><p class="muted small">Next 90 days \xB7 indicative USD</p></div><div class="fc-legend"><span class="lg-in">Inflow</span><span class="lg-out">Outflow</span></div></div><div class="chart-wrap"><div class="chart" id="b-fc">${N("100%",240,14)}</div></div></section>
    <section class="card">
      <div class="card-head"><div><h2>Transactions by category</h2><p class="muted small" id="tx-sub">&nbsp;</p></div>
        <div class="month-nav"><button class="icon-btn" type="button" id="m-prev" aria-label="Previous month">${u("chevronLeft",16)}</button><b id="m-label"></b><button class="icon-btn" type="button" id="m-next" aria-label="Next month">${u("chevron",16)}</button></div></div>
      <div id="tx-groups">${V(5)}</div>
    </section>`;let l=()=>{let w=e.querySelector("#b-grid"),$=o.reduce((M,E)=>M+E.limitUsdMinor,0),x=o.reduce((M,E)=>M+E.spentUsdMinor,0),L=o.filter(M=>M.spentUsdMinor>M.limitUsdMinor);e.querySelector("#b-stats").innerHTML=`
      <div class="stat-card"><span class="label">Budgeted this month</span><b>${s(H($,{cents:!1}))}</b><span class="sub">${o.length} budget${o.length===1?"":"s"}</span></div>
      <div class="stat-card"><span class="label">Spent against budgets</span><b>${s(H(x,{cents:!1}))}</b><div class="meter ${x>$?"hot":""}"><i style="width:${$?Math.min(100,x/$*100).toFixed(1):0}%"></i></div></div>
      <div class="stat-card ${L.length?"attn-bad":""}"><span class="label">Over budget</span><b>${L.length}</b><span class="sub">${L.length?s(L.map(M=>M.name).join(", ")):"Everything on track"}</span></div>`,w.innerHTML=o.length?o.map(Mn).join(""):`<div class="card wide-empty">${j({icon:"budget",title:"No budgets yet",text:"Set a monthly limit per category. Your AI CFO tracks spending against it and warns before a payment would go over.",action:`<button class="btn primary sm" type="button" data-new>${u("plus",15,2.4)}Create your first budget</button>`})}</div>`},c=()=>{e.querySelector("#m-label").textContent=le(n,!0),e.querySelector("#m-next").disabled=n>=r;let w=e.querySelector("#tx-groups"),$=i.filter(A=>A.usdMinor<0).reduce((A,T)=>A-T.usdMinor,0),x=i.filter(A=>A.usdMinor>0).reduce((A,T)=>A+T.usdMinor,0);if(e.querySelector("#tx-sub").innerHTML=i.length?`${i.length} transactions \xB7 <b class="pos">${s(H(x,{sign:!0,cents:!1}))}</b> in \xB7 <b>${s(H(-$,{cents:!1}))}</b> out`:"No transactions",!i.length){w.innerHTML=j({icon:"activity",title:`Nothing recorded in ${le(n,!0)}`,text:"Transactions come from processed documents, payments and connected accounts."});return}let L=new Map;for(let A of i)L.set(A.category,[...L.get(A.category)??[],A]);let M=new Map(o.map(A=>[A.category.toLowerCase(),A])),E=[...L.entries()].sort((A,T)=>A[1].reduce((q,S)=>q+S.usdMinor,0)-T[1].reduce((q,S)=>q+S.usdMinor,0));w.innerHTML=`<div class="tx-groups">${E.map(([A,T])=>{let q=T.reduce((b,k)=>b+k.usdMinor,0),S=M.get(A.toLowerCase());return`<details class="txg"${E.length<=3?" open":""}><summary><span class="chev">${u("chevron",14)}</span><b>${s(A)}</b><em>${T.length}</em>${S&&n===r?`<span class="pill ${S.spentUsdMinor>S.limitUsdMinor?"t-bad":"t-neutral"}">Budget ${s(H(S.limitUsdMinor,{cents:!1}))}</span>`:""}<span class="txg-sum ${q>0?"pos":""}">${s(H(q,{sign:q>0}))}</span></summary>
          <ul>${T.sort((b,k)=>k.date.localeCompare(b.date)).map(b=>`<li><span class="tx-d">${s(R(b.date))}</span><span class="tx-desc"><b>${s(b.description)}</b>${b.counterparty?`<span>${s(b.counterparty)}</span>`:""}</span>${b.documentId?`<a class="tx-doc" href="/app/documents/${s(b.documentId)}" title="Open source document">${u("doc",14)}</a>`:`<span class="tx-src">${s(b.source)}</span>`}<span class="tx-amt ${b.amountMinor>0?"pos":""}">${s(G(b.amountMinor,b.currency))}${b.currency!=="USD"?`<em>\u2248 ${s(H(b.usdMinor))}</em>`:""}</span></li>`).join("")}</ul></details>`}).join("")}</div>`},d=async()=>{e.querySelector("#tx-groups").innerHTML=V(4),i=await D(`/api/v1/transactions?month=${n}`),t.alive()&&c()},m=w=>{let[$,x]=n.split("-").map(Number),L=new Date($,x-1+w,1);n=`${L.getFullYear()}-${String(L.getMonth()+1).padStart(2,"0")}`,d().catch(()=>{})};e.querySelector("#m-prev").addEventListener("click",()=>m(-1)),e.querySelector("#m-next").addEventListener("click",()=>m(1));let h=()=>[...new Set([...i.map(w=>w.category),...o.map(w=>w.category)])];e.addEventListener("click",async w=>{let $=w.target;if($.closest("#b-new, [data-new]")){let M=await aa(null,h());M&&t.alive()&&(o.push(M),l())}let x=$.closest("[data-edit]");if(x){let M=o.find(A=>A.id===x.dataset.edit),E=M&&await aa(M,h());E&&t.alive()&&(o=o.map(A=>A.id===E.id?E:A),l())}let L=$.closest("[data-del]");if(L){let M=o.find(E=>E.id===L.dataset.del);if(!M||!await Q("Delete budget?",`\u201C${M.name}\u201D will be removed. Transactions are not affected.`,"Delete",!0))return;try{await te(`/api/v1/budgets/${encodeURIComponent(M.id)}`),o=o.filter(E=>E.id!==M.id),l(),P("Budget deleted","ok")}catch{}}});let[f,,p]=await Promise.all([D("/api/v1/budgets"),d(),D("/api/v1/forecast?days=90",!0).catch(()=>null)]);if(!t.alive())return;o=f,l(),c();let y=e.querySelector("#b-fc");if(p){let w=Xe(p,240);t.onCleanup(Ne(y,w.draw,w.wire))}else y.innerHTML='<div class="chart-empty">Forecast unavailable right now.</div>'}function Le(e){let t=s(e),a=[];return t=t.replace(/`([^`]+)`/g,(n,r)=>(a.push(`<code>${r}</code>`),`\0${a.length-1}\0`)),t=t.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g,"$1<em>$2</em>").replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^\s)]+)\)/g,(n,r,o)=>{let i=o.startsWith("http");return`<a href="${o}"${i?' target="_blank" rel="noopener noreferrer"':""}>${r}</a>`}),t.replace(/\u0000(\d+)\u0000/g,(n,r)=>a[Number(r)]??"")}var ft=e=>/^\s*\|.*\|\s*$/.test(e),sa=e=>/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(e),yt=e=>e.trim().replace(/^\|/,"").replace(/\|$/,"").split("|").map(t=>t.trim());function Ee(e){let t=e.replace(/\r/g,"").split(`
`),a=[],n=0;for(;n<t.length;){let r=t[n];if(!r.trim()){n++;continue}if(/^```/.test(r)){let l=[];for(n++;n<t.length&&!/^```/.test(t[n]);)l.push(t[n++]);n++,a.push(`<pre><code>${s(l.join(`
`))}</code></pre>`);continue}let o=/^(#{1,4})\s+(.*)$/.exec(r);if(o){let l=Math.min(4,o[1].length+2);a.push(`<h${l}>${Le(o[2])}</h${l}>`),n++;continue}if(ft(r)&&n+1<t.length&&sa(t[n+1])){let l=yt(r),c=yt(t[n+1]).map(h=>/:$/.test(h)?"num":"");n+=2;let d=[];for(;n<t.length&&ft(t[n]);)d.push(yt(t[n++]));let m=(h,f)=>c[f]==="num"||/^[-−+]?\s?(?:[A-Z]{3}\s)?[$€£]?\s?[\d,.]+\s?(?:%|k|m|tADA|ADA|[A-Z]{3})?$/.test(h);a.push(`<div class="md-table"><table><thead><tr>${l.map((h,f)=>`<th${c[f]?' class="num"':""}>${Le(h)}</th>`).join("")}</tr></thead><tbody>${d.map(h=>`<tr>${l.map((f,p)=>`<td${m(h[p]??"",p)?' class="num"':""}>${Le(h[p]??"")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);continue}if(/^\s*([-*•]|\d+[.)])\s+/.test(r)){let l=/^\s*\d+[.)]/.test(r),c=[];for(;n<t.length&&/^\s*([-*•]|\d+[.)])\s+/.test(t[n]);){let d=t[n].replace(/^\s*([-*•]|\d+[.)])\s+/,"");for(n++;n<t.length&&/^\s{2,}\S/.test(t[n])&&!/^\s*([-*•]|\d+[.)])\s+/.test(t[n]);)d+=" "+t[n++].trim();c.push(`<li>${Le(d)}</li>`)}a.push(l?`<ol>${c.join("")}</ol>`:`<ul>${c.join("")}</ul>`);continue}if(/^>\s?/.test(r)){let l=[];for(;n<t.length&&/^>\s?/.test(t[n]);)l.push(t[n++].replace(/^>\s?/,""));a.push(`<blockquote>${Le(l.join(" "))}</blockquote>`);continue}let i=[];for(;n<t.length&&t[n].trim()&&!/^(#{1,4}\s|```|>\s?)/.test(t[n])&&!/^\s*([-*•]|\d+[.)])\s+/.test(t[n])&&!(ft(t[n])&&n+1<t.length&&sa(t[n+1]));)i.push(t[n++]);a.push(`<p>${i.map(Le).join("<br>")}</p>`)}return a.join("")}var Ln=[["budget","Summarise my spending this month"],["calendar","Which invoices are due in the next 14 days?"],["shield","Create a budget for software at $2,000/month"],["pay","Draft payment for the latest invoice"],["trend","Forecast my cash for the next 90 days"]],En=/^(image\/|application\/pdf$|text\/csv$|text\/plain$|application\/vnd\.ms-excel$)/;function An(e){let t=new Date(e),a=new Date;a.setHours(0,0,0,0);let n=(a.getTime()-new Date(t.getFullYear(),t.getMonth(),t.getDate()).getTime())/864e5;return n<=0?"Today":n<=1?"Yesterday":n<=7?"Previous 7 days":n<=30?"Previous 30 days":"Older"}var Ge=(e,t,a="")=>`<span class="tool ${t?"run":"done"}" data-tool="${s(a)}">${t?'<i class="spin"></i>':u("check",12,2.8)}<span>${s(e)}</span></span>`;function gt(e,t){let a=e.attachments?.length?e.attachments.map(n=>`<a class="file-chip" href="/app/documents/${s(n.documentId)}">${u("doc",14)}<span>${s(n.filename)}</span></a>`).join(""):(t??[]).map(n=>`<span class="file-chip">${u(Ce(n.mime),14)}<span>${s(n.file.name)}</span></span>`).join("");return`<div class="msg user">${a?`<div class="att-row">${a}</div>`:""}${e.text?`<div class="bubble">${s(e.text)}</div>`:""}</div>`}function bt(e){return`<div class="msg bot"><span class="bot-av" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 64 64"><path d="M36.3 38.6C36.1 38.6 36.1 38.6 36.5 38.5C37.4 38.3 38.5 37.9 39.3 37.3C40.1 36.7 40.8 35.9 41.2 35.2C41.6 34.5 42 33.5 42.2 32.7C42.5 31.8 42.5 30.6 42.5 28.3C42.4 26.7 42.4 26.5 42.2 25.8C41.9 25.1 41.3 24.1 40.7 23.6C40.2 23.1 39.4 22.6 38.5 22.3C37.6 22 38.3 22 29.8 22C24.2 22 22.2 22 22.1 21.9C20.7 21.5 20 20.8 19.6 19.6C19.5 19.2 19.5 18.6 19.5 15.8C19.5 12.7 19.5 12.6 19.8 12.2C20.1 11.8 20.6 11.4 21.1 11.2C21.3 11.2 23.6 11.2 30 11.2C34.7 11.2 38.8 11.2 39.1 11.2C41.1 11.3 43.5 12.1 45.3 13.2C46.6 14 47.4 14.7 48.5 15.7C50.3 17.5 51.8 20 52.5 22.6C53 24.2 53.1 25.7 53 27.4C53 28.1 52.9 28.6 52.7 29.5C52.5 30.4 52 31.6 51.5 32.5C50.5 34.2 49 35.7 47.4 36.8C47 37 46 37.5 45.7 37.6C45.6 37.7 45.4 37.8 45.3 37.8C44.1 38.3 43 38.5 41.5 38.6C40.9 38.7 36.7 38.7 36.3 38.6Z" fill="#faf8f5"/><path d="M9.7 56.2C9.4 56.1 9.1 55.8 9 55.5C8.9 55.3 8.9 46.1 9 44.8C9 43.8 9.1 42.8 9.2 42.2C9.3 41.7 9.5 41 9.6 40.7C9.6 40.6 9.7 40.4 9.7 40.2C9.8 40 9.8 39.9 9.9 39.8C9.9 39.8 9.9 39.6 10 39.5C10 39.4 10.1 39.2 10.1 39.2C10.1 39.2 10.2 39 10.2 38.9C10.2 38.8 10.3 38.7 10.3 38.6C10.4 38.5 10.4 38.4 10.5 38.3C10.6 38.1 10.8 37.6 10.9 37.4C11.6 36.2 11.8 35.9 12.3 35.2C13.1 34 14.4 32.7 15.4 31.9C16.1 31.4 17 30.7 17.1 30.7C17.1 30.7 17.1 30.7 17.2 30.6C17.3 30.5 17.4 30.4 17.5 30.4C17.6 30.4 17.8 30.2 18 30.1C18.3 30 19.3 29.5 19.7 29.3C19.8 29.3 20 29.2 20.2 29.1C20.4 29 20.6 28.9 20.6 28.9C20.7 28.9 20.8 28.9 20.8 28.9C20.9 28.9 20.9 28.8 21 28.8C21.2 28.8 21.8 28.6 22.2 28.4C22.7 28.3 23.6 28.1 23.9 28.1C23.9 28.1 24.1 28.1 24.1 28.1C24.2 28.1 24.7 28 25.3 28C26.2 27.9 26.8 27.9 34.4 27.9L42.4 27.9L42.5 29C42.5 31.5 42.3 32.9 41.7 34.3C41.3 35 41.1 35.4 40.8 35.9C40.4 36.4 39.8 36.9 39.3 37.3C38.5 37.9 37.4 38.4 36.5 38.5C36.3 38.6 36.1 38.6 36.1 38.6C36 38.6 33.6 38.6 30.7 38.7C26.1 38.7 25.5 38.7 25.2 38.8C24.6 38.9 24.4 39 23.8 39.2C22.1 39.9 20.8 41.1 20.1 42.8C19.8 43.6 19.6 44.2 19.6 45C19.5 46.7 19.4 46.9 19.3 47.5C19.1 48.7 18.8 49.6 18.1 50.8C17.4 52 16.2 53.3 14.9 54.2C14.5 54.5 13.8 54.9 13.2 55.2C12 55.8 10.2 56.3 9.7 56.2Z" fill="#fd7b5d"/></svg></span><div class="msg-body">${e?.tools?.length?`<div class="tools">${e.tools.map(a=>Ge(a.summary,!1,a.name)).join("")}</div>`:'<div class="tools"></div>'}<div class="md">${e?Ee(e.text):'<span class="typing"><i></i><i></i><i></i></span>'}</div></div></div>`}async function oa(e,t){let a=t.params[0]||null,n=[],r=[],o=0,i=null,l=_.me?.workspace.autonomy;e.innerHTML=`<div class="chat">
    <aside class="threads" id="threads">
      <div class="threads-head"><button class="btn primary sm block" type="button" id="new-chat">${u("plus",16,2.4)}New chat</button></div>
      <div class="thread-list" id="thread-list">${Array.from({length:6},()=>`<div class="th-sk">${N("80%",12)}${N("40%",10)}</div>`).join("")}</div>
    </aside>
    <div class="threads-scrim" id="threads-scrim"></div>
    <section class="convo" id="convo">
      <header class="convo-head">
        <button class="icon-btn threads-btn" type="button" id="threads-btn" aria-label="Show chats">${u("chat",18)}</button>
        <div class="convo-title"><b id="chat-title">New chat</b><span>AI CFO \xB7 Claude</span></div>
        ${l?`<a class="pill ${Z[l].tone}" href="/app/agent" title="Agent autonomy">${u("shield",12,2.2)}${Z[l].name}</a>`:""}
      </header>
      <div class="msgs" id="msgs"><div class="msgs-in" id="msgs-in"></div></div>
      <form class="composer" id="composer">
        <div class="att-chips" id="att-chips"></div>
        <textarea id="input" rows="1" placeholder="Ask about cash, invoices, budgets, or ask it to draft a payment\u2026" aria-label="Message"></textarea>
        <div class="comp-bar">
          <button type="button" class="icon-btn" id="attach" aria-label="Attach files" title="Attach files (PDF, images, CSV, text)">${u("clip",18)}</button>
          <input type="file" id="file" multiple accept="${ze}" hidden>
          <span class="comp-hint">Shift + Enter for a new line</span>
          <button type="submit" class="send" id="send" aria-label="Send" disabled>${u("send",18,2.4)}</button>
        </div>
      </form>
      <p class="comp-fine">Claude reads. Code decides. You approve. Payments run on Cardano Preprod (testnet) and the CashXChain sandbox.</p>
      <div class="drop-over" id="drop-over"><div>${u("upload",26)}<b>Drop files to attach</b><span>PDF, images, CSV or text \xB7 up to 15 MB each</span></div></div>
    </section>
  </div>`;let c=v=>e.querySelector(`#${v}`),d=c("msgs"),m=c("msgs-in"),h=c("input"),f=c("send"),p=c("thread-list"),y=()=>d.scrollHeight-d.scrollTop-d.clientHeight<120,w=(v=!1)=>{(v||y())&&(d.scrollTop=d.scrollHeight)},$=()=>{if(i){f.disabled=!1,f.classList.add("stop"),f.innerHTML=u("stop",16,2.2),f.setAttribute("aria-label","Stop");return}f.classList.remove("stop"),f.innerHTML=u("send",18,2.4),f.setAttribute("aria-label","Send"),f.disabled=!h.value.trim()&&!r.length},x=()=>{h.style.height="auto",h.style.height=`${Math.min(200,h.scrollHeight)}px`,$()},L=()=>{if(!n.length){p.innerHTML='<p class="threads-empty">Your conversations appear here.</p>';return}let v="",g="";for(let U of n){let Y=An(U.updatedAt);Y!==g&&(v+=`<div class="th-group">${Y}</div>`),g=Y,v+=`<div class="th${U.id===a?" on":""}"><a href="/app/chat/${s(U.id)}" title="${s(U.title)}"><span>${s(U.title||"New chat")}</span><em>${s(xe(U.updatedAt))}</em></a><button type="button" class="icon-btn th-del" data-del="${s(U.id)}" aria-label="Delete chat">${u("trash",15)}</button></div>`}p.innerHTML=v},M=async()=>{if(n=await D("/api/v1/chats",!0).catch(()=>n),!t.alive())return;n.sort((g,U)=>U.updatedAt.localeCompare(g.updatedAt)),L();let v=n.find(g=>g.id===a);v&&(c("chat-title").textContent=v.title||"New chat")},E=()=>{m.innerHTML=`<div class="chat-empty">
      <div class="ce-mark">${u("sparkle",26)}</div>
      <h2>How can I help with your finances?</h2>
      <p>I can read your documents and connected accounts, plan budgets and draft payments. Code checks every payment against your policy, and you approve what moves.</p>
      <div class="suggest">${Ln.map(([v,g])=>`<button type="button" data-suggest="${s(g)}">${u(v,16)}<span>${s(g)}</span></button>`).join("")}</div>
    </div>`},A=()=>{let v=c("att-chips");v.innerHTML=r.map(g=>`<span class="att">${g.url?`<img src="${g.url}" alt="">`:`<span class="att-ic">${u(Ce(g.mime),16)}</span>`}<span class="att-t"><b>${s(g.file.name)}</b><em>${s(ke(g.file.size))}</em></span><button type="button" class="att-x" data-rm="${g.id}" aria-label="Remove ${s(g.file.name)}">${u("x",12,2.6)}</button></span>`).join(""),v.classList.toggle("has",r.length>0),$()},T=v=>{for(let g of Array.from(v)){let U=Ue(g);if(!En.test(U)){P(`${g.name}: only images, PDF, CSV and text files are supported.`,"error");continue}if(g.size>We){P(`${g.name} is larger than 15 MB.`,"error");continue}r.push({id:++o,file:g,mime:U,url:U.startsWith("image/")?URL.createObjectURL(g):void 0})}A(),h.focus()},q=v=>{if(v)for(let g of r)g.url&&URL.revokeObjectURL(g.url);r=[],A()};t.onCleanup(()=>{i?.abort(),q(!0)});let S=async v=>{if(i||!v&&!r.length)return;let g=r;r=[],A(),h.value="",x(),m.querySelector(".chat-empty")?.remove(),i=new AbortController,$();let U=document.createElement("div");U.innerHTML=gt({text:v},g),m.append(U.firstElementChild);let Y=document.createElement("div");Y.innerHTML=bt();let z=Y.firstElementChild;m.append(z),z.classList.add("streaming"),w(!0);let be=z.querySelector(".tools"),Ae=z.querySelector(".md"),ae="",oe=0,dn=()=>{oe=0,Ae.innerHTML=Ee(ae)+'<span class="caret"></span>',w()};try{if(!a){let W=await O("/api/v1/chats",{});a=W.id,n.unshift(W),L(),re(`/app/chat/${encodeURIComponent(W.id)}`,{silent:!0})}let ve=[];for(let W of g)ve.push({filename:W.file.name,mimeType:W.mime,dataBase64:await Oe(W.file)});for(let W of g)W.url&&URL.revokeObjectURL(W.url);let we=i.signal;await zt(`/api/v1/chats/${encodeURIComponent(a)}/messages`,ve.length?{text:v,attachments:ve}:{text:v},W=>{if(t.alive())switch(W.type){case"user":{let ce=document.createElement("div");ce.innerHTML=gt(W.message);let pe=z.previousElementSibling;pe?.classList.contains("user")&&pe.replaceWith(ce.firstElementChild);break}case"text":ae+=W.delta,oe||(oe=requestAnimationFrame(dn));break;case"tool":{let ce=[...be.querySelectorAll(".tool.run")].find(pe=>pe.dataset.tool===W.name);W.status==="start"?be.insertAdjacentHTML("beforeend",Ge(W.summary,!0,W.name)):ce?ce.outerHTML=Ge(W.summary,!1,W.name):be.insertAdjacentHTML("beforeend",Ge(W.summary,!1,W.name)),ae||(Ae.innerHTML='<span class="typing"><i></i><i></i><i></i></span>'),w();break}case"done":{oe&&cancelAnimationFrame(oe),oe=0;let ce=document.createElement("div");ce.innerHTML=bt({...W.message,text:W.message.text||ae});let pe=ce.firstElementChild;!W.message.tools?.length&&be.children.length&&pe.querySelector(".tools").replaceWith(be),z.replaceWith(pe),ae="";break}case"error":throw new Error(W.message||"The AI CFO could not answer.")}},we),z.isConnected&&(oe&&cancelAnimationFrame(oe),z.classList.remove("streaming"),Ae.innerHTML=(ae?Ee(ae):"")+`<div class="callout bad">${u("alert",15)}<span>The connection closed before the answer was complete, possibly a server restart. Nothing you asked for was lost; send the message again.</span></div>`)}catch(ve){oe&&cancelAnimationFrame(oe),z.classList.remove("streaming");for(let we of be.querySelectorAll(".tool.run"))we.classList.replace("run","stopped");if(ve.name==="AbortError")Ae.innerHTML=(ae?Ee(ae):"")+`<p class="stopped-note">${u("stop",12,2.4)}Stopped</p>`;else{let we=ve.message||"Something went wrong.";Ae.innerHTML=(ae?Ee(ae):"")+`<div class="callout bad">${u("alert",15)}<span>${s(we)}</span></div>`,P(we,"error")}}finally{i=null,$(),t.alive()&&(M(),h.focus())}};c("composer").addEventListener("submit",v=>{if(v.preventDefault(),i){i.abort();return}S(h.value.trim())}),h.addEventListener("input",x),h.addEventListener("keydown",v=>{v.key==="Enter"&&!v.shiftKey&&!v.isComposing&&(v.preventDefault(),i||S(h.value.trim()))}),h.addEventListener("paste",v=>{let g=v.clipboardData?.files;g&&g.length&&(v.preventDefault(),T(g))}),c("attach").addEventListener("click",()=>c("file").click()),c("file").addEventListener("change",v=>{let g=v.target;g.files&&T(g.files),g.value=""}),c("att-chips").addEventListener("click",v=>{let g=v.target.closest("[data-rm]");if(!g)return;let U=Number(g.dataset.rm),Y=r.find(z=>z.id===U);Y?.url&&URL.revokeObjectURL(Y.url),r=r.filter(z=>z.id!==U),A()});let b=c("convo"),k=0;b.addEventListener("dragenter",v=>{v.dataTransfer?.types.includes("Files")&&(v.preventDefault(),k++,b.classList.add("dragging"))}),b.addEventListener("dragover",v=>{v.dataTransfer?.types.includes("Files")&&v.preventDefault()}),b.addEventListener("dragleave",()=>{k=Math.max(0,k-1),k||b.classList.remove("dragging")}),b.addEventListener("drop",v=>{v.preventDefault(),k=0,b.classList.remove("dragging"),v.dataTransfer?.files.length&&T(v.dataTransfer.files)}),m.addEventListener("click",v=>{let g=v.target.closest("[data-suggest]");g&&S(g.dataset.suggest)}),c("new-chat").addEventListener("click",()=>re("/app/chat"));let F=()=>e.querySelector(".chat").classList.remove("show-threads");c("threads-btn").addEventListener("click",()=>e.querySelector(".chat").classList.toggle("show-threads")),c("threads-scrim").addEventListener("click",F),p.addEventListener("click",async v=>{let g=v.target.closest("[data-del]");if(!g)return;v.preventDefault();let U=g.dataset.del,Y=n.find(z=>z.id===U);if(await Q("Delete chat?",`\u201C${Y?.title||"This chat"}\u201D and its messages will be deleted. Documents attached in it stay in your library.`,"Delete chat",!0)){try{await te(`/api/v1/chats/${encodeURIComponent(U)}`)}catch{return}n=n.filter(z=>z.id!==U),P("Chat deleted","ok"),U===a?re("/app/chat",{replace:!0}):L()}});let C=Gt();if(a?m.innerHTML=`<div class="msg bot"><span class="bot-av" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 64 64"><path d="M36.3 38.6C36.1 38.6 36.1 38.6 36.5 38.5C37.4 38.3 38.5 37.9 39.3 37.3C40.1 36.7 40.8 35.9 41.2 35.2C41.6 34.5 42 33.5 42.2 32.7C42.5 31.8 42.5 30.6 42.5 28.3C42.4 26.7 42.4 26.5 42.2 25.8C41.9 25.1 41.3 24.1 40.7 23.6C40.2 23.1 39.4 22.6 38.5 22.3C37.6 22 38.3 22 29.8 22C24.2 22 22.2 22 22.1 21.9C20.7 21.5 20 20.8 19.6 19.6C19.5 19.2 19.5 18.6 19.5 15.8C19.5 12.7 19.5 12.6 19.8 12.2C20.1 11.8 20.6 11.4 21.1 11.2C21.3 11.2 23.6 11.2 30 11.2C34.7 11.2 38.8 11.2 39.1 11.2C41.1 11.3 43.5 12.1 45.3 13.2C46.6 14 47.4 14.7 48.5 15.7C50.3 17.5 51.8 20 52.5 22.6C53 24.2 53.1 25.7 53 27.4C53 28.1 52.9 28.6 52.7 29.5C52.5 30.4 52 31.6 51.5 32.5C50.5 34.2 49 35.7 47.4 36.8C47 37 46 37.5 45.7 37.6C45.6 37.7 45.4 37.8 45.3 37.8C44.1 38.3 43 38.5 41.5 38.6C40.9 38.7 36.7 38.7 36.3 38.6Z" fill="#faf8f5"/><path d="M9.7 56.2C9.4 56.1 9.1 55.8 9 55.5C8.9 55.3 8.9 46.1 9 44.8C9 43.8 9.1 42.8 9.2 42.2C9.3 41.7 9.5 41 9.6 40.7C9.6 40.6 9.7 40.4 9.7 40.2C9.8 40 9.8 39.9 9.9 39.8C9.9 39.8 9.9 39.6 10 39.5C10 39.4 10.1 39.2 10.1 39.2C10.1 39.2 10.2 39 10.2 38.9C10.2 38.8 10.3 38.7 10.3 38.6C10.4 38.5 10.4 38.4 10.5 38.3C10.6 38.1 10.8 37.6 10.9 37.4C11.6 36.2 11.8 35.9 12.3 35.2C13.1 34 14.4 32.7 15.4 31.9C16.1 31.4 17 30.7 17.1 30.7C17.1 30.7 17.1 30.7 17.2 30.6C17.3 30.5 17.4 30.4 17.5 30.4C17.6 30.4 17.8 30.2 18 30.1C18.3 30 19.3 29.5 19.7 29.3C19.8 29.3 20 29.2 20.2 29.1C20.4 29 20.6 28.9 20.6 28.9C20.7 28.9 20.8 28.9 20.8 28.9C20.9 28.9 20.9 28.8 21 28.8C21.2 28.8 21.8 28.6 22.2 28.4C22.7 28.3 23.6 28.1 23.9 28.1C23.9 28.1 24.1 28.1 24.1 28.1C24.2 28.1 24.7 28 25.3 28C26.2 27.9 26.8 27.9 34.4 27.9L42.4 27.9L42.5 29C42.5 31.5 42.3 32.9 41.7 34.3C41.3 35 41.1 35.4 40.8 35.9C40.4 36.4 39.8 36.9 39.3 37.3C38.5 37.9 37.4 38.4 36.5 38.5C36.3 38.6 36.1 38.6 36.1 38.6C36 38.6 33.6 38.6 30.7 38.7C26.1 38.7 25.5 38.7 25.2 38.8C24.6 38.9 24.4 39 23.8 39.2C22.1 39.9 20.8 41.1 20.1 42.8C19.8 43.6 19.6 44.2 19.6 45C19.5 46.7 19.4 46.9 19.3 47.5C19.1 48.7 18.8 49.6 18.1 50.8C17.4 52 16.2 53.3 14.9 54.2C14.5 54.5 13.8 54.9 13.2 55.2C12 55.8 10.2 56.3 9.7 56.2Z" fill="#fd7b5d"/></svg></span><div class="msg-body">${N("70%",14)}<div style="height:8px"></div>${N("50%",14)}</div></div>`:E(),M(),a)try{let v=await D(`/api/v1/chats/${encodeURIComponent(a)}`);if(!t.alive())return;c("chat-title").textContent=v.chat.title||"New chat",m.innerHTML=v.messages.map(g=>g.role==="user"?gt(g):bt(g)).join(""),v.messages.length||E(),w(!0)}catch{if(!t.alive())return;m.innerHTML='<div class="chat-empty"><h2>Chat not found</h2><p>It may have been deleted.</p><a class="btn primary sm" href="/app/chat">Start a new chat</a></div>';return}$(),C?S(C):matchMedia("(min-width: 900px)").matches&&h.focus()}var vt;function Tn(){let e=window;return e.Stripe?Promise.resolve(e.Stripe):(vt??=new Promise((t,a)=>{let n=document.createElement("script");n.src="https://js.stripe.com/v3/",n.onload=()=>e.Stripe?t(e.Stripe):a(new Error("Stripe.js did not load")),n.onerror=()=>{vt=void 0,a(new Error("Could not load Stripe.js. Check your connection or ad blocker."))},document.head.append(n)}),vt)}async function ra(){let[e,t]=await Promise.all([Tn(),O("/api/v1/connections/bank/session")]),a=await e(t.publishableKey).collectFinancialConnectionsAccounts({clientSecret:t.clientSecret});if(a.error)throw new Error(a.error.message??"Stripe could not link the account");return a.financialConnectionsSession?.accounts.length?O("/api/v1/connections/bank/complete",{sessionId:t.sessionId}):[]}function ia(e){return e instanceof Uint8Array||ArrayBuffer.isView(e)&&e.constructor.name==="Uint8Array"&&"BYTES_PER_ELEMENT"in e&&e.BYTES_PER_ELEMENT===1}var wt=e=>e?`"${e}" `:"";function Ve(e,t=""){if(typeof e!="number")throw new TypeError(wt(t)+"expected number, got "+typeof e);if(!Number.isSafeInteger(e)||e<0)throw new RangeError(wt(t)+"expected integer >= 0, got "+e);return e}function qe(e,t,a=""){if(ia(e)&&(t===void 0||e.length===t))return e;t!==void 0&&Ve(t,"length");let n=ia(e),r=t!==void 0?` of length ${t}`:"",o=n?`length=${e.length}`:`type=${typeof e}`,i=wt(a)+"expected Uint8Array"+r+", got "+o;throw n?new RangeError(i):new TypeError(i)}var Sn=(e,t)=>{if(e===null||typeof e!="object"||Array.isArray(e))throw new TypeError((t==="object"?"":`"${t}" `)+"expected object, got type="+typeof e)},ca=(e,t)=>{Sn(e,t);let a=Object.getPrototypeOf(e);if(a!==Object.prototype&&a!==null)throw new TypeError(`"${t}" expected plain object`);if(Object.hasOwn(e,"__proto__"))throw new TypeError(`"${t}.__proto__" is not allowed`)};function $t(e,t=!0){if(e.destroyed)throw new Error("hash was destroyed");if(t&&e.finished)throw new Error("digest() was already called")}function la(e,t){qe(e,void 0,"output");let a=t.outputLen;if(!(e.length>=a))throw new RangeError('"output" expected length >= '+a)}function xt(...e){for(let t=0;t<e.length;t++)e[t].fill(0)}function Je(e){return new DataView(e.buffer,e.byteOffset,e.byteLength)}function se(e,t){return e<<32-t|e>>>t}function Hn(e,t,a="opts"){return ca(e,"defaults"),t!==void 0&&ca(t,a),Object.assign(Object.create(null),e,t)}function da(e,t={}){if(typeof e!="function")throw new TypeError('"hashCons" expected function, got type='+typeof e);t=Hn({},t,"info");let a=(r,o)=>e(o).update(r).digest(),n=e(void 0);return a.outputLen=n.outputLen,a.blockLen=n.blockLen,a.canXOF=n.canXOF,a.create=r=>e(r),Object.assign(a,t),Object.freeze(a)}function ua(e=32){Ve(e,"bytesLength");let t=typeof globalThis=="object"?globalThis.crypto:null;if(typeof t?.getRandomValues!="function")throw new Error("crypto.getRandomValues must be defined");if(e>65536)throw new RangeError(`"bytesLength" expected <= 65536, got ${e}`);return t.getRandomValues(new Uint8Array(e))}var pa=e=>({oid:Uint8Array.from([6,9,96,134,72,1,101,3,4,2,e])});var Pn=e=>e/2**32|0,Dn=e=>e>>>0;function ma(e,t,a,n){let r=Pn(a),o=Dn(a);e.setUint32(t,n?o:r,n),e.setUint32(t+4,n?r:o,n)}function ha(e,t,a){return e&t^~e&a}function fa(e,t,a){return e&t^e&a^t&a}var Ze=class{blockLen;outputLen;canXOF=!1;padOffset;isLE;buffer;view;finished=!1;length=0;pos=0;destroyed=!1;constructor(t,a,n,r){this.blockLen=t,this.outputLen=a,this.padOffset=n,this.isLE=r,this.buffer=new Uint8Array(t),this.view=Je(this.buffer)}update(t){$t(this),qe(t);let{view:a,buffer:n,blockLen:r}=this,o=t.length,i=!1;for(let l=0;l<o;){let c=Math.min(r-this.pos,o-l);if(c===r){let d=Je(t);for(;r<=o-l;l+=r)this.process(d,l);i=!0;continue}n.set(l===0&&c===o?t:t.subarray(l,l+c),this.pos),this.pos+=c,l+=c,this.pos===r&&(this.process(a,0),this.pos=0,i=!0)}return this.length+=t.length,i&&this.roundClean(),this}digestInto(t){$t(this),la(t,this),this.finished=!0;let{buffer:a,view:n,blockLen:r,isLE:o}=this,{pos:i}=this;a[i++]=128,a.fill(0,i),this.padOffset>r-i&&(this.process(n,0),a.fill(0)),ma(n,r-8,this.length*8,o),this.process(n,0),this.roundClean();let l=t===a?n:Je(t),c=this.outputLen,d=c/4,m=this.get();if(c%4||d>m.length)throw new Error("invalid outputLen");for(let h=0;h<d;h++)l.setUint32(4*h,m[h],o)}digest(){let{buffer:t,outputLen:a}=this;this.digestInto(t);let n=t.slice(0,a);return this.destroy(),n}_cloneIntoMeta(t){let{buffer:a,length:n,finished:r,destroyed:o,pos:i}=this;return t.destroyed=o,t.finished=r,t.length=n,t.pos=i,i&&t.buffer.set(a),t}clone(){return this._cloneInto()}},ya=Uint32Array.from([1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225]);var Un=Uint32Array.from([1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298]),de=new Uint32Array(64),kt=class extends Ze{A=0;B=0;C=0;D=0;E=0;F=0;G=0;H=0;constructor(t,a){super(64,t,8,!1),this.A=a[0]|0,this.B=a[1]|0,this.C=a[2]|0,this.D=a[3]|0,this.E=a[4]|0,this.F=a[5]|0,this.G=a[6]|0,this.H=a[7]|0}get(){let{A:t,B:a,C:n,D:r,E:o,F:i,G:l,H:c}=this;return[t,a,n,r,o,i,l,c]}set(t,a,n,r,o,i,l,c){this.A=t|0,this.B=a|0,this.C=n|0,this.D=r|0,this.E=o|0,this.F=i|0,this.G=l|0,this.H=c|0}_cloneInto(t){return(t||=new this.constructor).set(...this.get()),this._cloneIntoMeta(t)}process(t,a){for(let h=0;h<16;h++,a+=4)de[h]=t.getUint32(a,!1);for(let h=16;h<64;h++){let f=de[h-15],p=de[h-2],y=se(f,7)^se(f,18)^f>>>3,w=se(p,17)^se(p,19)^p>>>10;de[h]=w+de[h-7]+y+de[h-16]|0}let{A:n,B:r,C:o,D:i,E:l,F:c,G:d,H:m}=this;for(let h=0;h<64;h++){let f=se(l,6)^se(l,11)^se(l,25),p=m+f+ha(l,c,d)+Un[h]+de[h]|0,w=(se(n,2)^se(n,13)^se(n,22))+fa(n,r,o)|0;m=d,d=c,c=l,l=i+p|0,i=o,o=r,r=n,n=p+w|0}n=n+this.A|0,r=r+this.B|0,o=o+this.C|0,i=i+this.D|0,l=l+this.E|0,c=c+this.F|0,d=d+this.G|0,m=m+this.H|0,this.set(n,r,o,i,l,c,d,m)}roundClean(){xt(de)}destroy(){this.destroyed=!0,this.set(0,0,0,0,0,0,0,0),xt(this.buffer)}},Ct=class extends kt{constructor(){super(32,ya)}};var ga=da(()=>new Ct,pa(1));var In=e=>e[0]==="\u3042\u3044\u3053\u304F\u3057\u3093";function ba(e){for(let t=0;t<e.length;t++){let a=e.charCodeAt(t);if(a>=55296&&a<=56319){if(t+1>=e.length)return!1;let n=e.charCodeAt(++t);if(n<56320||n>57343)return!1}else if(a>=56320&&a<=57343)return!1}return!0}function Bn(e){if(typeof e!="string")throw new TypeError("invalid mnemonic type: "+typeof e);if(!ba(e))throw new TypeError("expected well-formed Unicode string");return e.normalize("NFKD")}function Nn(e){let t=Bn(e),a=t.split(" ");if(![12,15,18,21,24].includes(a.length))throw new Error("Invalid mnemonic");return{nfkd:t,words:a}}function va(e){if(qe(e),![16,20,24,28,32].includes(e.length))throw new RangeError("invalid entropy length")}function wa(e,t=128){if(Ve(t),t%32!==0||t>256)throw new RangeError("Invalid entropy");return jn(ua(t/8),e)}var $a=e=>{let t=8-e.length/4;return ga(e)[0]>>t<<t};function xa(e){if(!Array.isArray(e)||e.length!==2048||typeof e[0]!="string")throw new TypeError("Wordlist: expected array of 2048 strings");e.forEach(t=>{if(typeof t!="string")throw new TypeError("wordlist: non-string element: "+t);if(!ba(t))throw new TypeError("wordlist: expected well-formed Unicode string")})}function qn(e,t){xa(t);let a=new Uint8Array(e.length+1);a.set(e),a[e.length]=$a(e);let n=[],r=0,o=0;for(let i of a)r=r<<8|i,o+=8,o>=11&&(o-=11,n.push(t[r>>>o&2047]),r&=(1<<o)-1);return n}function Rn(e,t){xa(t);let a=e.length/3*4,n=new Uint8Array(a+1),r=0,o=0,i=0;for(let c of e){let d=t.indexOf(c);if(d===-1)throw new Error("Unknown word: "+c);for(r=r<<11|d,o+=11;o>=8;)o-=8,n[i++]=r>>>o&255;r&=(1<<o)-1}o>0&&(n[i]=r<<8-o);let l=n.subarray(0,a);if(n[a]!==$a(l))throw new Error("Invalid checksum");return Uint8Array.from(l)}function _n(e,t){let{words:a}=Nn(e),n=Rn(a,t);return va(n),n}function jn(e,t){return va(e),qn(e,t).join(In(t)?"\u3000":" ")}function ka(e,t){try{_n(e,t)}catch{return!1}return!0}var Mt=Object.freeze(`abandon
ability
able
about
above
absent
absorb
abstract
absurd
abuse
access
accident
account
accuse
achieve
acid
acoustic
acquire
across
act
action
actor
actress
actual
adapt
add
addict
address
adjust
admit
adult
advance
advice
aerobic
affair
afford
afraid
again
age
agent
agree
ahead
aim
air
airport
aisle
alarm
album
alcohol
alert
alien
all
alley
allow
almost
alone
alpha
already
also
alter
always
amateur
amazing
among
amount
amused
analyst
anchor
ancient
anger
angle
angry
animal
ankle
announce
annual
another
answer
antenna
antique
anxiety
any
apart
apology
appear
apple
approve
april
arch
arctic
area
arena
argue
arm
armed
armor
army
around
arrange
arrest
arrive
arrow
art
artefact
artist
artwork
ask
aspect
assault
asset
assist
assume
asthma
athlete
atom
attack
attend
attitude
attract
auction
audit
august
aunt
author
auto
autumn
average
avocado
avoid
awake
aware
away
awesome
awful
awkward
axis
baby
bachelor
bacon
badge
bag
balance
balcony
ball
bamboo
banana
banner
bar
barely
bargain
barrel
base
basic
basket
battle
beach
bean
beauty
because
become
beef
before
begin
behave
behind
believe
below
belt
bench
benefit
best
betray
better
between
beyond
bicycle
bid
bike
bind
biology
bird
birth
bitter
black
blade
blame
blanket
blast
bleak
bless
blind
blood
blossom
blouse
blue
blur
blush
board
boat
body
boil
bomb
bone
bonus
book
boost
border
boring
borrow
boss
bottom
bounce
box
boy
bracket
brain
brand
brass
brave
bread
breeze
brick
bridge
brief
bright
bring
brisk
broccoli
broken
bronze
broom
brother
brown
brush
bubble
buddy
budget
buffalo
build
bulb
bulk
bullet
bundle
bunker
burden
burger
burst
bus
business
busy
butter
buyer
buzz
cabbage
cabin
cable
cactus
cage
cake
call
calm
camera
camp
can
canal
cancel
candy
cannon
canoe
canvas
canyon
capable
capital
captain
car
carbon
card
cargo
carpet
carry
cart
case
cash
casino
castle
casual
cat
catalog
catch
category
cattle
caught
cause
caution
cave
ceiling
celery
cement
census
century
cereal
certain
chair
chalk
champion
change
chaos
chapter
charge
chase
chat
cheap
check
cheese
chef
cherry
chest
chicken
chief
child
chimney
choice
choose
chronic
chuckle
chunk
churn
cigar
cinnamon
circle
citizen
city
civil
claim
clap
clarify
claw
clay
clean
clerk
clever
click
client
cliff
climb
clinic
clip
clock
clog
close
cloth
cloud
clown
club
clump
cluster
clutch
coach
coast
coconut
code
coffee
coil
coin
collect
color
column
combine
come
comfort
comic
common
company
concert
conduct
confirm
congress
connect
consider
control
convince
cook
cool
copper
copy
coral
core
corn
correct
cost
cotton
couch
country
couple
course
cousin
cover
coyote
crack
cradle
craft
cram
crane
crash
crater
crawl
crazy
cream
credit
creek
crew
cricket
crime
crisp
critic
crop
cross
crouch
crowd
crucial
cruel
cruise
crumble
crunch
crush
cry
crystal
cube
culture
cup
cupboard
curious
current
curtain
curve
cushion
custom
cute
cycle
dad
damage
damp
dance
danger
daring
dash
daughter
dawn
day
deal
debate
debris
decade
december
decide
decline
decorate
decrease
deer
defense
define
defy
degree
delay
deliver
demand
demise
denial
dentist
deny
depart
depend
deposit
depth
deputy
derive
describe
desert
design
desk
despair
destroy
detail
detect
develop
device
devote
diagram
dial
diamond
diary
dice
diesel
diet
differ
digital
dignity
dilemma
dinner
dinosaur
direct
dirt
disagree
discover
disease
dish
dismiss
disorder
display
distance
divert
divide
divorce
dizzy
doctor
document
dog
doll
dolphin
domain
donate
donkey
donor
door
dose
double
dove
draft
dragon
drama
drastic
draw
dream
dress
drift
drill
drink
drip
drive
drop
drum
dry
duck
dumb
dune
during
dust
dutch
duty
dwarf
dynamic
eager
eagle
early
earn
earth
easily
east
easy
echo
ecology
economy
edge
edit
educate
effort
egg
eight
either
elbow
elder
electric
elegant
element
elephant
elevator
elite
else
embark
embody
embrace
emerge
emotion
employ
empower
empty
enable
enact
end
endless
endorse
enemy
energy
enforce
engage
engine
enhance
enjoy
enlist
enough
enrich
enroll
ensure
enter
entire
entry
envelope
episode
equal
equip
era
erase
erode
erosion
error
erupt
escape
essay
essence
estate
eternal
ethics
evidence
evil
evoke
evolve
exact
example
excess
exchange
excite
exclude
excuse
execute
exercise
exhaust
exhibit
exile
exist
exit
exotic
expand
expect
expire
explain
expose
express
extend
extra
eye
eyebrow
fabric
face
faculty
fade
faint
faith
fall
false
fame
family
famous
fan
fancy
fantasy
farm
fashion
fat
fatal
father
fatigue
fault
favorite
feature
february
federal
fee
feed
feel
female
fence
festival
fetch
fever
few
fiber
fiction
field
figure
file
film
filter
final
find
fine
finger
finish
fire
firm
first
fiscal
fish
fit
fitness
fix
flag
flame
flash
flat
flavor
flee
flight
flip
float
flock
floor
flower
fluid
flush
fly
foam
focus
fog
foil
fold
follow
food
foot
force
forest
forget
fork
fortune
forum
forward
fossil
foster
found
fox
fragile
frame
frequent
fresh
friend
fringe
frog
front
frost
frown
frozen
fruit
fuel
fun
funny
furnace
fury
future
gadget
gain
galaxy
gallery
game
gap
garage
garbage
garden
garlic
garment
gas
gasp
gate
gather
gauge
gaze
general
genius
genre
gentle
genuine
gesture
ghost
giant
gift
giggle
ginger
giraffe
girl
give
glad
glance
glare
glass
glide
glimpse
globe
gloom
glory
glove
glow
glue
goat
goddess
gold
good
goose
gorilla
gospel
gossip
govern
gown
grab
grace
grain
grant
grape
grass
gravity
great
green
grid
grief
grit
grocery
group
grow
grunt
guard
guess
guide
guilt
guitar
gun
gym
habit
hair
half
hammer
hamster
hand
happy
harbor
hard
harsh
harvest
hat
have
hawk
hazard
head
health
heart
heavy
hedgehog
height
hello
helmet
help
hen
hero
hidden
high
hill
hint
hip
hire
history
hobby
hockey
hold
hole
holiday
hollow
home
honey
hood
hope
horn
horror
horse
hospital
host
hotel
hour
hover
hub
huge
human
humble
humor
hundred
hungry
hunt
hurdle
hurry
hurt
husband
hybrid
ice
icon
idea
identify
idle
ignore
ill
illegal
illness
image
imitate
immense
immune
impact
impose
improve
impulse
inch
include
income
increase
index
indicate
indoor
industry
infant
inflict
inform
inhale
inherit
initial
inject
injury
inmate
inner
innocent
input
inquiry
insane
insect
inside
inspire
install
intact
interest
into
invest
invite
involve
iron
island
isolate
issue
item
ivory
jacket
jaguar
jar
jazz
jealous
jeans
jelly
jewel
job
join
joke
journey
joy
judge
juice
jump
jungle
junior
junk
just
kangaroo
keen
keep
ketchup
key
kick
kid
kidney
kind
kingdom
kiss
kit
kitchen
kite
kitten
kiwi
knee
knife
knock
know
lab
label
labor
ladder
lady
lake
lamp
language
laptop
large
later
latin
laugh
laundry
lava
law
lawn
lawsuit
layer
lazy
leader
leaf
learn
leave
lecture
left
leg
legal
legend
leisure
lemon
lend
length
lens
leopard
lesson
letter
level
liar
liberty
library
license
life
lift
light
like
limb
limit
link
lion
liquid
list
little
live
lizard
load
loan
lobster
local
lock
logic
lonely
long
loop
lottery
loud
lounge
love
loyal
lucky
luggage
lumber
lunar
lunch
luxury
lyrics
machine
mad
magic
magnet
maid
mail
main
major
make
mammal
man
manage
mandate
mango
mansion
manual
maple
marble
march
margin
marine
market
marriage
mask
mass
master
match
material
math
matrix
matter
maximum
maze
meadow
mean
measure
meat
mechanic
medal
media
melody
melt
member
memory
mention
menu
mercy
merge
merit
merry
mesh
message
metal
method
middle
midnight
milk
million
mimic
mind
minimum
minor
minute
miracle
mirror
misery
miss
mistake
mix
mixed
mixture
mobile
model
modify
mom
moment
monitor
monkey
monster
month
moon
moral
more
morning
mosquito
mother
motion
motor
mountain
mouse
move
movie
much
muffin
mule
multiply
muscle
museum
mushroom
music
must
mutual
myself
mystery
myth
naive
name
napkin
narrow
nasty
nation
nature
near
neck
need
negative
neglect
neither
nephew
nerve
nest
net
network
neutral
never
news
next
nice
night
noble
noise
nominee
noodle
normal
north
nose
notable
note
nothing
notice
novel
now
nuclear
number
nurse
nut
oak
obey
object
oblige
obscure
observe
obtain
obvious
occur
ocean
october
odor
off
offer
office
often
oil
okay
old
olive
olympic
omit
once
one
onion
online
only
open
opera
opinion
oppose
option
orange
orbit
orchard
order
ordinary
organ
orient
original
orphan
ostrich
other
outdoor
outer
output
outside
oval
oven
over
own
owner
oxygen
oyster
ozone
pact
paddle
page
pair
palace
palm
panda
panel
panic
panther
paper
parade
parent
park
parrot
party
pass
patch
path
patient
patrol
pattern
pause
pave
payment
peace
peanut
pear
peasant
pelican
pen
penalty
pencil
people
pepper
perfect
permit
person
pet
phone
photo
phrase
physical
piano
picnic
picture
piece
pig
pigeon
pill
pilot
pink
pioneer
pipe
pistol
pitch
pizza
place
planet
plastic
plate
play
please
pledge
pluck
plug
plunge
poem
poet
point
polar
pole
police
pond
pony
pool
popular
portion
position
possible
post
potato
pottery
poverty
powder
power
practice
praise
predict
prefer
prepare
present
pretty
prevent
price
pride
primary
print
priority
prison
private
prize
problem
process
produce
profit
program
project
promote
proof
property
prosper
protect
proud
provide
public
pudding
pull
pulp
pulse
pumpkin
punch
pupil
puppy
purchase
purity
purpose
purse
push
put
puzzle
pyramid
quality
quantum
quarter
question
quick
quit
quiz
quote
rabbit
raccoon
race
rack
radar
radio
rail
rain
raise
rally
ramp
ranch
random
range
rapid
rare
rate
rather
raven
raw
razor
ready
real
reason
rebel
rebuild
recall
receive
recipe
record
recycle
reduce
reflect
reform
refuse
region
regret
regular
reject
relax
release
relief
rely
remain
remember
remind
remove
render
renew
rent
reopen
repair
repeat
replace
report
require
rescue
resemble
resist
resource
response
result
retire
retreat
return
reunion
reveal
review
reward
rhythm
rib
ribbon
rice
rich
ride
ridge
rifle
right
rigid
ring
riot
ripple
risk
ritual
rival
river
road
roast
robot
robust
rocket
romance
roof
rookie
room
rose
rotate
rough
round
route
royal
rubber
rude
rug
rule
run
runway
rural
sad
saddle
sadness
safe
sail
salad
salmon
salon
salt
salute
same
sample
sand
satisfy
satoshi
sauce
sausage
save
say
scale
scan
scare
scatter
scene
scheme
school
science
scissors
scorpion
scout
scrap
screen
script
scrub
sea
search
season
seat
second
secret
section
security
seed
seek
segment
select
sell
seminar
senior
sense
sentence
series
service
session
settle
setup
seven
shadow
shaft
shallow
share
shed
shell
sheriff
shield
shift
shine
ship
shiver
shock
shoe
shoot
shop
short
shoulder
shove
shrimp
shrug
shuffle
shy
sibling
sick
side
siege
sight
sign
silent
silk
silly
silver
similar
simple
since
sing
siren
sister
situate
six
size
skate
sketch
ski
skill
skin
skirt
skull
slab
slam
sleep
slender
slice
slide
slight
slim
slogan
slot
slow
slush
small
smart
smile
smoke
smooth
snack
snake
snap
sniff
snow
soap
soccer
social
sock
soda
soft
solar
soldier
solid
solution
solve
someone
song
soon
sorry
sort
soul
sound
soup
source
south
space
spare
spatial
spawn
speak
special
speed
spell
spend
sphere
spice
spider
spike
spin
spirit
split
spoil
sponsor
spoon
sport
spot
spray
spread
spring
spy
square
squeeze
squirrel
stable
stadium
staff
stage
stairs
stamp
stand
start
state
stay
steak
steel
stem
step
stereo
stick
still
sting
stock
stomach
stone
stool
story
stove
strategy
street
strike
strong
struggle
student
stuff
stumble
style
subject
submit
subway
success
such
sudden
suffer
sugar
suggest
suit
summer
sun
sunny
sunset
super
supply
supreme
sure
surface
surge
surprise
surround
survey
suspect
sustain
swallow
swamp
swap
swarm
swear
sweet
swift
swim
swing
switch
sword
symbol
symptom
syrup
system
table
tackle
tag
tail
talent
talk
tank
tape
target
task
taste
tattoo
taxi
teach
team
tell
ten
tenant
tennis
tent
term
test
text
thank
that
theme
then
theory
there
they
thing
this
thought
three
thrive
throw
thumb
thunder
ticket
tide
tiger
tilt
timber
time
tiny
tip
tired
tissue
title
toast
tobacco
today
toddler
toe
together
toilet
token
tomato
tomorrow
tone
tongue
tonight
tool
tooth
top
topic
topple
torch
tornado
tortoise
toss
total
tourist
toward
tower
town
toy
track
trade
traffic
tragic
train
transfer
trap
trash
travel
tray
treat
tree
trend
trial
tribe
trick
trigger
trim
trip
trophy
trouble
truck
true
truly
trumpet
trust
truth
try
tube
tuition
tumble
tuna
tunnel
turkey
turn
turtle
twelve
twenty
twice
twin
twist
two
type
typical
ugly
umbrella
unable
unaware
uncle
uncover
under
undo
unfair
unfold
unhappy
uniform
unique
unit
universe
unknown
unlock
until
unusual
unveil
update
upgrade
uphold
upon
upper
upset
urban
urge
usage
use
used
useful
useless
usual
utility
vacant
vacuum
vague
valid
valley
valve
van
vanish
vapor
various
vast
vault
vehicle
velvet
vendor
venture
venue
verb
verify
version
very
vessel
veteran
viable
vibrant
vicious
victory
video
view
village
vintage
violin
virtual
virus
visa
visit
visual
vital
vivid
vocal
voice
void
volcano
volume
vote
voyage
wage
wagon
wait
walk
wall
walnut
want
warfare
warm
warrior
wash
wasp
waste
water
wave
way
wealth
weapon
wear
weasel
weather
web
wedding
weekend
weird
welcome
west
wet
whale
what
wheat
wheel
when
where
whip
whisper
wide
width
wife
wild
will
win
window
wine
wing
wink
winner
winter
wire
wisdom
wise
wish
witness
wolf
woman
wonder
wood
wool
word
work
world
worry
worth
wrap
wreck
wrestle
wrist
write
wrong
yard
year
yellow
you
young
youth
zebra
zero
zone
zoo`.split(`
`));var Fn="qpzry9x8gf2tvdw0s3jn54khce6mua7l",On=[996825010,642813549,513874426,1027748829,705979059];function Wn(e){let t=1;for(let a of e){let n=t>>>25;t=(t&33554431)<<5^a;for(let r=0;r<5;r++)n>>>r&1&&(t^=On[r])}return t}function zn(e){let t=[...e].map(a=>a.charCodeAt(0));return[...t.map(a=>a>>5),0,...t.map(a=>a&31)]}function Yn(e){let t=[],a=0,n=0;for(let r of e)for(a=(a<<8|r)&4095,n+=8;n>=5;)n-=5,t.push(a>>>n&31);return n>0&&t.push(a<<5-n&31),t}function Ca(e,t){let a=Yn(t),n=Wn([...zn(e),...a,0,0,0,0,0,0])^1,r=Array.from({length:6},(o,i)=>n>>>5*(5-i)&31);return`${e}1${[...a,...r].map(o=>Fn[o]).join("")}`}function Kn(e){if(!/^(?:[0-9a-fA-F]{2})+$/.test(e))throw new Error("not hex");return Uint8Array.from(e.match(/../g),t=>parseInt(t,16))}function Lt(e){let t=Kn(e);t[0]===88&&t[1]===t.length-2&&(t=t.subarray(2));let a=t[0];if(a===void 0)throw new Error("empty address");let n=a>>4,r=(a&15)===0;if(n<=7)return Ca(r?"addr_test":"addr",t);if(n===14||n===15)return Ca(r?"stake_test":"stake",t);throw new Error("unsupported Cardano address type")}var Qe=()=>window;function et(){let e=Qe().cardano;if(!e||typeof e!="object")return[];let t=new Set,a=[];for(let[n,r]of Object.entries(e)){if(!r||typeof r.enable!="function"||typeof r.name!="string"||t.has(r.name))continue;t.add(r.name);let o=typeof r.icon=="string"&&/^(data:image\/|https:)/.test(r.icon)?r.icon:void 0;a.push({id:n,name:r.name,...o?{icon:o}:{}})}return a}var Ma=()=>typeof Qe().ethereum?.request=="function";async function La(e){let t=Qe().cardano?.[e];if(!t?.enable)throw new Error("That wallet is no longer available in this browser.");let a;try{a=await t.enable()}catch{throw new Error("The wallet did not allow the connection.")}if(await a.getNetworkId()!==0)throw new Error("The wallet is on mainnet. Switch it to Preprod (testnet) and try again.");return a}async function Ea(e){let t=await La(e),a=await t.getUsedAddresses().catch(()=>[]),n=Lt(a[0]??await t.getChangeAddress());if(!n.startsWith("addr_test1"))throw new Error("The wallet returned no payment address.");return n}async function Aa(e,t){let a=await La(e),n=await a.getUsedAddresses().catch(()=>[]),r=await a.getChangeAddress();if(![...n,r].map(l=>{try{return Lt(l)}catch{return""}}).includes(t))throw new Error(`This wallet does not hold ${t.slice(0,20)}\u2026, the wallet connected for payments. Open that wallet.`);let i=await a.getUtxos().catch(()=>null)??[];if(!i.length)throw new Error("This wallet has no funds on Cardano Preprod. Top it up from the Preprod faucet.");return{funds:{utxos:i,changeAddress:r,addresses:n},async sign(l){try{return await a.signTx(l,!0)}catch{throw new Error("Not signed in the wallet: nothing was sent. Sign again, or cancel the payment.")}}}}async function Ta(){let e=Qe().ethereum;if(!e)throw new Error("No browser wallet found.");let t;try{t=await e.request({method:"eth_requestAccounts"})}catch{throw new Error("The wallet did not allow the connection.")}let a=Array.isArray(t)?t[0]:void 0;if(typeof a!="string"||!/^0x[0-9a-fA-F]{40}$/.test(a))throw new Error("The wallet returned no account.");return a}var Xn={cardano_agent_wallet:"bot",cardano_wallet:"wallet",evm_wallet:"globe",cashxchain:"zap",bank:"bank"},Pa="/brand/cashxchain-mark.svg";function Da(e,t=20){return e==="cashxchain"?`<img class="cxc-logo" src="${Pa}" alt="" width="${Math.round(t*.82)}" height="${Math.round(t*.94)}">`:u(Xn[e]??"link",t)}var Gn={"cardano:preprod":["Cardano Preprod","testnet"],"cardano:mainnet":["Cardano",""],ethereum:["Ethereum",""],"cashxchain:sandbox":["CashXChain","sandbox"],bank:["Bank",""]},Vn={cardano_wallet:"addr_test1\u2026",evm_wallet:"0x\u2026"},Jn=/^cxc_(sk|rk)_sandbox_[A-Za-z0-9]+$/,Et=!1;function Zn(e){return e.kind==="cardano_agent_wallet"?e.keyHint?`<div class="addr-row owner"><span class="muted small">Your agent wallet \xB7 ${s(e.keyHint)}, stored encrypted</span></div>`:`<div class="addr-row owner"><span class="muted small">PayLorya AI's shared wallet: remove it and connect your own</span></div>`:e.kind!=="cashxchain"?"":e.keyHint?`<div class="addr-row owner"><span class="muted small">Your account \xB7 key</span><span class="mono" title="Stored encrypted">${s(e.keyHint)}</span></div>`:`<div class="addr-row owner"><span class="muted small">${Et?"Your linked CashXChain sub-account \xB7 payouts need your API key":"No API key: remove and connect again with your key"}</span></div>`}function Qn(e){if(e!=="cardano_wallet"&&e!=="evm_wallet")return"";let t=e==="cardano_wallet"?et():Ma()?[{id:"ethereum",name:"browser wallet"}]:[];if(!t.length){let a=e==="cardano_wallet"?"a Cardano wallet such as Lace or Eternl":"an EVM wallet such as MetaMask";return`<p class="fine">${u("info",13)} No browser wallet found. Install ${a} to connect with one click, or paste the address.</p>`}return`<div class="field"><span class="lbl">Connect a wallet</span><div class="wallet-pick">${t.map(a=>`<button type="button" class="btn ghost sm" data-wallet="${s(a.id)}">${a.icon?`<img src="${s(a.icon)}" alt="" width="18" height="18">`:u("wallet",16)}Connect ${s(a.name)}</button>`).join("")}</div><span class="fine">Your wallet asks for permission and shares this address only. The AI CFO never holds your keys: with read &amp; write, you sign each payment in your wallet.</span></div>`}function es(e){let[t,a]=Gn[e]??[e,""];return`<span class="net">${s(t)}${a?`<em>${s(a)}</em>`:""}</span>`}var ue,At=e=>`${(Number(e??0)/1e6).toLocaleString("en-US",{maximumFractionDigits:6})} test tADA`;function ts(e){if(e.kind!=="cardano_agent_wallet"||!e.keyHint||!ue)return"";let t=ue.granted;if(t){let a=t.txHash&&t.explorerUrl?` \xB7 <a href="${s(t.explorerUrl)}" target="_blank" rel="noopener noreferrer">transaction ${u("external",11)}</a>`:"";return`<div class="addr-row owner"><span class="muted small">Received ${s(At(t.lovelace))} from PayLorya AI${a}</span></div>`}return ue.available?`<div class="fund-row"><button type="button" class="btn primary xs" data-fund>${u("plus",14,2.4)}Get ${s(At(ue.lovelace))}</button><span class="fine">Once per account, sent to this wallet. Arrives in about a minute.</span></div>`:""}function Sa(e,t){let a=e.balances.reduce((r,o)=>r+(o.usdMinor??0),0),n=e.balances.some(r=>r.usdMinor!=null);return`<article class="card conn reveal ${e.status}" data-id="${s(e.id)}" style="--d:${t*40}ms">
    <div class="conn-head">
      <span class="conn-ic k-${e.kind}">${Da(e.kind)}</span>
      <div class="conn-t"><h3>${s(e.label)}</h3>${es(e.network)}</div>
      <span class="pill ${e.status==="active"?"t-ok":e.status==="error"?"t-bad":"t-neutral"}">${e.status==="active"?'<i class="live"></i>Active':e.status==="error"?"Error":"Coming soon"}</span>
    </div>
    ${Zn(e)}
    ${ts(e)}
    ${e.address?`<div class="addr-row"><span class="mono" title="${s(e.address)}">${s(me(e.address))}</span><button type="button" class="icon-btn xs" data-copy="${s(e.address)}" aria-label="Copy address">${u("copy",13)}</button></div>`:""}
    ${e.error?`<div class="callout bad sm">${u("alert",14)}<span>${s(e.error)}</span></div>`:""}
    <div class="conn-bal">
      ${n?`<b class="conn-total">${s(H(a))}</b><span class="muted small">indicative USD</span>`:""}
      <ul>${e.balances.length?e.balances.map(r=>`<li><span>${s(r.asset)}</span><b>${s(He(r))}</b></li>`).join(""):'<li class="muted small">No balances reported</li>'}</ul>
    </div>
    <div class="conn-access">
      <span class="label-sm">Agent access</span>
      <div class="seg${e.supports.write?"":" disabled"}" role="radiogroup" aria-label="Access for ${s(e.label)}">
        <button type="button" role="radio" aria-checked="${e.access==="read"}" data-access="read" ${e.supports.write?"":"disabled"}>${u("eye",14)}Read-only</button>
        <button type="button" role="radio" aria-checked="${e.access==="read_write"}" data-access="read_write" ${e.supports.write?"":"disabled"}>${u("pay",14)}Read &amp; write</button>
      </div>
      ${e.supports.write?e.kind==="cardano_wallet"?'<span class="fine">Read &amp; write: you sign each tADA payout in your wallet. No keys are stored.</span>':"":`<span class="fine">${e.kind==="cardano_agent_wallet"?"Pays the x402 verification fees only; payouts leave from your own wallet.":e.kind==="bank"?"Read-only through Stripe: balances only, no money moves.":"Watch-only: this connection cannot send payments."}</span>`}
    </div>
    <div class="conn-foot"><span class="muted small">Added ${s(xe(e.createdAt))}</span>
      <span><button type="button" class="icon-btn" data-rename aria-label="Rename">${u("edit",16)}</button><button type="button" class="icon-btn" data-refresh aria-label="Refresh balances" title="Refresh balances">${u("refresh",16)}</button><button type="button" class="icon-btn danger-h" data-remove aria-label="Remove connection" title="Remove">${u("trash",16)}</button></span></div>
  </article>`}var Ha={needs_signup:e=>`Sign up at the CashXChain sandbox with <b>${s(e)}</b>, sign in once, then link.`,needs_signin:e=>`<b>${s(e)}</b> has a CashXChain account that was never signed in to. Sign in once, then link.`,other_platform:e=>`<b>${s(e)}</b> already belongs to another CashXChain platform. Use another email, or end that grant in CashXChain first.`,error:()=>"CashXChain could not be reached or refused the link. Try again."};function as(e){if(!e.platform)return"";let t=e.link;if(t?.status==="linked"){let n=e.accounts?.length?`<ul class="cxc-acc">${e.accounts.map(r=>`<li><span>${s(r.currency)}</span><b>${s(r.available??"\u2013")}</b></li>`).join("")}</ul>`:e.accountsError?`<span class="muted small">${s(e.accountsError)}</span>`:'<span class="muted small">No currency accounts yet.</span>';return`<div class="callout info"><span class="cxc-chip"><img src="${Pa}" alt="" width="12" height="14"></span><div><b>CashXChain sub-account linked</b> <span class="pill t-neutral">sandbox</span><br>
      <span class="mono small">${s(t.accountId??"")}</span> \xB7 KYB ${s(t.kybStatus??"unknown")} \xB7 ${s(t.email)}<br>
      ${n}
      <span class="fine">Your CashXChain connection reads this account. Payouts from it need CashXChain's money permission for this platform${t.canMoveMoney?" (granted)":" (not granted yet)"}.</span></div></div>`}let a=t?(Ha[t.status]??Ha.error)(t.email):"Linking your CashXChain sandbox sub-account\u2026";return`<div class="callout${t?.status==="error"?" bad":""}">${u("link",18)}<div><b>CashXChain sub-account not linked yet</b><br>${a}
    ${t?.detail?`<br><span class="fine">${s(t.detail)}</span>`:""}
    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><a class="btn ghost xs" href="${s(e.signupUrl)}" target="_blank" rel="noopener">${u("external",14)}CashXChain sign-up</a><button type="button" class="btn primary xs" data-cxc-link>${u("link",14)}Link now</button></div></div></div>`}async function ns(e){let t=null;return await X({title:`Connect ${e.name}`,submit:"Connect",body:`<p class="dlg-text">${s(e.description)}</p>
      <div class="field"><label for="c-label">Name <span class="opt-l">optional</span></label><input id="c-label" name="label" placeholder="${s(e.name)}" autocomplete="off"></div>
      ${e.needsAddress?Qn(e.kind):""}
      ${e.needsAddress?`<div class="field"><label for="c-addr">Address</label><input id="c-addr" name="address" class="mono" placeholder="${s(Vn[e.kind]??"Address")}" autocomplete="off" spellcheck="false"></div>`:""}
      ${e.acceptsApiKey?`<div class="field"><label for="c-key">API key${e.linkedFallback?' <span class="opt-l">optional</span>':""}</label><input id="c-key" name="apiKey" type="password" class="mono" placeholder="cxc_sk_sandbox_\u2026" autocomplete="off" spellcheck="false">
        <span class="fine">From your CashXChain sandbox dashboard: a secret key, or a restricted key with accounts:read (to pay, also payments:read, payments:write and beneficiaries:write). Stored encrypted; shown again only by its last four characters.${e.linkedFallback?" Leave empty to read your linked CashXChain sub-account; payouts need the key.":""}</span></div>`:""}
      ${e.acceptsRecoveryPhrase?`<div class="field"><label for="c-phrase">Recovery phrase</label><textarea id="c-phrase" name="recoveryPhrase" class="mono" rows="3" placeholder="12, 15 or 24 words" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>
        <span class="fine">Use a wallet made for PayLorya AI that holds test tADA only, never the phrase of a wallet with real funds. Stored encrypted; the AI CFO signs with it on Cardano Preprod only, within your policy.</span>
        <div style="margin-top:8px"><button type="button" class="btn ghost xs" data-new-wallet>${u("plus",14,2.4)}Create a new wallet</button></div>
        <div class="callout info sm" id="c-phrase-new" hidden>${u("info",14)}<span>New wallet created in your browser. Write the phrase down now: it is the only way to recover this wallet. After connecting, fund its address from the Cardano Preprod faucet.</span></div></div>`:""}
      <div class="field"><span class="lbl">Agent access</span>
        <div class="radio-cards">
          <label><input type="radio" name="access" value="read" checked><span>${u("eye",16)}<b>Read-only</b><em>See balances and history</em></span></label>
          <label class="${e.supports.write?"":"off"}"><input type="radio" name="access" value="read_write" ${e.supports.write?"":"disabled"}><span>${u("pay",16)}<b>Read &amp; write</b><em>${e.supports.write?e.kind==="cardano_wallet"?"Pays tADA: you sign each payment in your wallet":e.kind==="cardano_agent_wallet"?"Pays verifications and tADA on its own, within your policy":"May also send payments, within your policy":"Not supported by this connection"}</em></span></label>
        </div>
      </div>
      ${e.kind==="cardano_agent_wallet"||e.kind==="cardano_wallet"?`<p class="fine">${u("info",13)} Cardano Preprod is a test network. Balances are tADA with no real value.</p>`:""}
      ${e.kind==="cashxchain"?`<p class="fine">${u("info",13)} CashXChain sandbox: a test ledger, no real money moves.</p>`:""}`,onOpen:a=>{a.addEventListener("click",n=>{if(!n.target.closest("[data-new-wallet]"))return;let r=a.elements.namedItem("recoveryPhrase");if(!r)return;r.value=wa(Mt,256),a.querySelector("#c-phrase-new").hidden=!1;let o=a.querySelector('input[name="access"][value="read_write"]');o&&(o.checked=!0)}),a.addEventListener("click",async n=>{let r=n.target.closest("[data-wallet]");if(!(!r||r.disabled)){r.disabled=!0,r.classList.add("loading");try{let o=e.kind==="cardano_wallet"?await Ea(r.dataset.wallet):await Ta(),i=a.elements.namedItem("address");i&&(i.value=o,i.closest(".field")?.classList.remove("invalid")),P("Address taken from your wallet","ok")}catch(o){I(a,"address",o instanceof Error?o.message:"The wallet could not be connected.")}finally{r.disabled=!1,r.classList.remove("loading")}}})},onSubmit:async a=>{let n={kind:e.kind,access:B(a,"access")||"read"},r=B(a,"label");if(r&&(n.label=r),e.acceptsRecoveryPhrase){let o=B(a,"recoveryPhrase").toLowerCase().replace(/\s+/g," ");if(!o)return I(a,"recoveryPhrase","Paste the wallet's recovery phrase, or create a new wallet.");if(!ka(o,Mt))return I(a,"recoveryPhrase","That is not a valid recovery phrase: 12, 15 or 24 English words.");n.recoveryPhrase=o}if(e.acceptsApiKey){let o=B(a,"apiKey");if(o&&!Jn.test(o))return I(a,"apiKey","Use a CashXChain sandbox key: cxc_sk_sandbox_\u2026 or cxc_rk_sandbox_\u2026");if(!o&&!e.linkedFallback)return I(a,"apiKey","Paste your CashXChain sandbox API key.");o&&(n.apiKey=o)}if(e.needsAddress){let o=B(a,"address");if(!o)return I(a,"address","Paste the wallet address.");if(e.kind==="cardano_wallet"&&!/^addr_test1[0-9a-z]{20,}$/.test(o))return I(a,"address","Use a Cardano Preprod address (addr_test1\u2026).");if(e.kind==="evm_wallet"&&!/^0x[0-9a-fA-F]{40}$/.test(o))return I(a,"address","Use an EVM address (0x followed by 40 hex characters).");n.address=o}return t=await O("/api/v1/connections",n),P(`${t.label} connected`,"ok"),!0}}),t}async function Ua(e,t){let a=[],n=[];e.innerHTML=`${K("Connections","Wallets and accounts your AI CFO can see, and the ones it may pay from.",`<a class="btn primary sm" href="#add" id="c-add-top">${u("plus",16,2.4)}Add connection</a>`)}
    <div id="c-cxc"></div>
    <section class="conn-grid" id="c-grid">${Array.from({length:3},()=>`<div class="card">${N("50%",18)}<div style="height:14px"></div>${N("30%",12)}<div style="height:28px"></div>${N("60%",26)}<div style="height:22px"></div>${N("100%",38,12)}</div>`).join("")}</section>
    <section class="catalog" id="add"><div class="section-h"><h2>Add a connection</h2><p class="muted">Read-only by default. Grant write access only where you want the agent to be able to pay from.</p></div><div class="cat-grid" id="c-cat"></div></section>`;let r=e.querySelector("#c-grid"),o=e.querySelector("#c-cat"),i=e.querySelector("#c-cxc"),l=p=>{i.innerHTML=as(p);let y=p.link?.status==="linked";y!==Et&&(Et=y,a.some(w=>w.kind==="cashxchain"&&!w.keyHint)&&c())};D("/api/v1/cashxchain",!0).then(p=>t.alive()&&l(p),()=>{}),i.addEventListener("click",async p=>{let y=p.target.closest("[data-cxc-link]");if(y){y.disabled=!0,y.classList.add("loading");try{let w=await O("/api/v1/cashxchain/link");if(!t.alive())return;l(w),P(w.link?.status==="linked"?"CashXChain sub-account linked":"Not linked yet: see the note",w.link?.status==="linked"?"ok":void 0)}catch{y.disabled=!1,y.classList.remove("loading")}}});let c=()=>{r.innerHTML=a.length?a.map(Sa).join(""):`<div class="card wide-empty">${j({icon:"link",title:"No connections yet",text:"Start with your agent wallet: it pays the verification on Cardano before every payout. Then add your CashXChain sandbox account, or wallets to watch."})}</div>`},d=()=>{o.innerHTML=n.map(p=>`<button type="button" class="cat-item${p.available?"":" soon"}" data-kind="${s(p.kind)}" ${p.available?"":"disabled"}>
        <span class="conn-ic k-${p.kind}">${Da(p.kind)}</span>
        <span class="cat-t"><b>${s(p.name)}</b><span>${s(p.description)}</span></span>
        <span class="cat-f">${p.available?`<span class="caps">${p.supports.write?"Read &amp; write":"Read-only"}</span><span class="cat-go">${u("plus",16,2.4)}</span>`:'<span class="pill t-neutral">Coming soon</span>'}</span>
      </button>`).join("")},m=p=>{a=a.map(w=>w.id===p.id?p:w);let y=r.querySelector(`[data-id="${CSS.escape(p.id)}"]`);if(y){let w=document.createElement("div");w.innerHTML=Sa(p,0);let $=w.firstElementChild;$.classList.remove("reveal"),y.replaceWith($)}};e.querySelector("#c-add-top").addEventListener("click",p=>{p.preventDefault(),e.querySelector("#add").scrollIntoView({behavior:"smooth",block:"start"})}),o.addEventListener("click",async p=>{let y=p.target.closest("[data-kind]"),w=y&&n.find(x=>x.kind===y.dataset.kind);if(!w||!w.available)return;if(w.viaStripe){y.disabled=!0;try{let x=await ra();if(!t.alive())return;let L=x[0];L&&(a.push(...x),c(),P(x.length===1?`${L.label} connected`:`${x.length} bank accounts connected`,"ok"),r.querySelector(`[data-id="${CSS.escape(L.id)}"]`)?.scrollIntoView({behavior:"smooth",block:"center"}))}catch(x){!(x instanceof J)&&x instanceof Error&&P(x.message,"error")}finally{y.disabled=!1}return}let $=await ns(w);$&&t.alive()&&(a.push($),$.kind==="cardano_agent_wallet"&&(ue=await D("/api/v1/funding",!0).catch(()=>{})),c(),r.querySelector(`[data-id="${CSS.escape($.id)}"]`)?.scrollIntoView({behavior:"smooth",block:"center"}))}),r.addEventListener("click",async p=>{let y=p.target,w=y.closest("[data-copy]");if(w)return void ge(w.dataset.copy);let $=y.closest("[data-fund]");if($){$.disabled=!0,$.classList.add("loading");try{let A=await O("/api/v1/funding");ue={available:!1,granted:A},P(`${At(A.lovelace)} on the way to your agent wallet. Refresh its balance in a minute.`,"ok"),c()}catch{$.disabled=!1,$.classList.remove("loading")}return}let x=y.closest(".conn"),L=x&&a.find(A=>A.id===x.dataset.id);if(!L||!x)return;let M=`/api/v1/connections/${encodeURIComponent(L.id)}`,E=y.closest("[data-access]");if(E&&!E.disabled){let A=E.dataset.access;if(A===L.access||A==="read_write"&&!await Q("Allow payments from this connection?",`With read & write access the agent can send payments from \u201C${L.label}\u201D, always within your agent access policy and limits.`,"Allow read & write"))return;try{m(await ee(M,{access:A})),P(A==="read"?`${L.label} is now read-only`:`${L.label} can now be used for payments`,"ok")}catch{}return}if(y.closest("[data-refresh]")){let A=y.closest("[data-refresh]");A.classList.add("spinning"),A.disabled=!0;try{m(await O(`${M}/refresh`)),P("Balances refreshed","ok")}catch{A.classList.remove("spinning"),A.disabled=!1}return}if(y.closest("[data-rename]")){await X({title:"Rename connection",submit:"Save",body:`<div class="field"><label for="r-label">Name</label><input id="r-label" name="label" value="${s(L.label)}" autocomplete="off"></div>`,onSubmit:async A=>{let T=B(A,"label");return T?(m(await ee(M,{label:T})),!0):I(A,"label","Enter a name.")}});return}if(y.closest("[data-remove]")){if(!await Q(`Remove ${L.label}?`,"Your AI CFO will stop reading this connection and can no longer pay from it. Nothing on-chain or in your account changes.","Remove",!0))return;try{await te(M),a=a.filter(A=>A.id!==L.id),c(),P("Connection removed","ok")}catch{}}});let[h,f]=await Promise.all([D("/api/v1/connections"),D("/api/v1/connections/catalog",!0).catch(()=>[])]);t.alive()&&(a=h,n=f.sort((p,y)=>Number(y.available)-Number(p.available)),c(),d(),a.some(p=>p.kind==="cardano_agent_wallet"&&p.keyHint)&&(ue=await D("/api/v1/funding",!0).catch(()=>{}),t.alive()&&ue&&c()))}var tt=class extends Error{constructor(){super("Not approved")}};function ss(e){return[e?.iban?`IBAN ${e.iban}`:"",e?.bic?`BIC ${e.bic}`:"",e?.routingNumber?`ABA routing ${e.routingNumber}, account ${e.accountNumber??"?"}`:"",e?.cardanoAddress?`Cardano ${e.cardanoAddress}`:""].filter(Boolean)}async function os(e){let[t,a]=await Promise.all([D("/api/v1/payments"),D("/api/v1/payees").catch(()=>[])]),n=t.find(d=>d.id===e);if(!n)throw new Error("This payment no longer exists");if(n.status!=="pending_approval"&&n.status!=="blocked")throw new Error(`This payment is already ${rs(n)}`);let r=n.payeeId?a.find(d=>d.id===n.payeeId):void 0,o=ss(r??n.destination),i=!r||n.policy.checks.some(d=>d.id==="account"||d.id==="payee"&&d.status!=="pass"),l=G(n.amountMinor,n.currency);if(!await X({title:"Approve this payment?",submit:`Approve and pay ${l}`,wide:!0,body:`<dl class="appr-sum">
        <dt>Amount</dt><dd><b class="appr-amt">${s(l)}</b>${n.currency==="USD"?"":` <span class="muted small">\u2248 ${s(H(n.usdMinor))} indicative</span>`}</dd>
        <dt>To</dt><dd><b>${s(n.payeeName)}</b> ${r?'<span class="pill t-ok">saved payee</span>':'<span class="pill t-warn">not a saved payee</span>'}</dd>
        <dt>Account</dt><dd>${o.length?o.map(d=>`<div class="mono appr-acct">${s(d)}</div>`).join(""):'<span class="muted">No account details</span>'}</dd>
        <dt>Rail</dt><dd>${je(n.rail)}</dd>
        <dt>Reason</dt><dd>${s(n.reason)}</dd>
      </dl>
      <div class="appr-checks">${Na(n)}</div>
      ${i?`<div class="field appr-field"><label class="appr-tick"><input type="checkbox" name="verified"> <span>I checked this account with ${s(n.payeeName)} through a channel I trust, not from the invoice, an email or a chat message.</span></label></div>`:""}
      <p class="muted small">${n.rail==="cardano_preprod"?"Next, you sign the payout in your wallet.":"The payout starts as soon as you approve."} Test money only: CashXChain sandbox and Cardano Preprod.</p>`,onOpen:d=>d.querySelector(".dlg-foot [data-close]")?.focus(),onSubmit:d=>i&&!d.elements.namedItem("verified")?.checked?I(d,"verified","Tick this to confirm you checked the account"):!0}))throw new tt;return n}var rs=e=>e.status.replace(/_/g," ");async function St(e,t){let a;try{a=t==="approve"?await os(e):void 0}catch(r){throw r instanceof tt||P(r instanceof Error?r.message:String(r),"error"),r}let n=await O(`/api/v1/payments/${encodeURIComponent(e)}/${t}`,a?{amountMinor:a.amountMinor,currency:a.currency}:{});return P(t==="approve"?n.status==="executed"?`Approved and paid ${n.payeeName}`:n.status==="failed"||n.status==="blocked"?`Approved, but the payment ${n.status==="failed"?"failed":"was blocked"}`:n.currency==="ADA"?`Approved. Sign the payment to ${n.payeeName} in your wallet in a moment.`:`Approved. Paying ${n.payeeName}\u2026`:`Rejected payment to ${n.payeeName}`,t==="approve"&&(n.status==="failed"||n.status==="blocked")?"error":"ok"),Be(),n}var is={pass:"check",warn:"alert",fail:"x"};function Na(e){return e.policy.checks.length?`<ul class="checks">${e.policy.checks.map(t=>`<li class="ck-${t.status}"><span class="ck-ic">${u(is[t.status],12,2.8)}</span><span>${s(t.message)}</span></li>`).join("")}</ul>`:'<p class="muted small">No policy checks recorded.</p>'}var Ia={auto:["Within agent limits","t-ok"],approval:["Needs your approval","t-warn"],blocked:["Blocked by policy","t-bad"]};function cs(e){let t=e.destination,a=[t?.iban?`IBAN ${t.iban}`:"",t?.bic?`BIC ${t.bic}`:"",t?.routingNumber?`ABA ${t.routingNumber} / ${t.accountNumber??"?"}`:"",t?.cardanoAddress?me(t.cardanoAddress):""].filter(Boolean);return a.length?`<span class="mono">${s(a.join(" \xB7 "))}</span> <span class="pill t-warn">not saved</span>`:'<span class="muted">No account details</span>'}function ls(e){let t=e.policy.checks,a=t.filter(o=>o.status==="fail").length,n=t.filter(o=>o.status==="warn").length,r=t.filter(o=>o.status==="pass").length;return`<span class="ck-sum">${r?`<span class="ck-pass">${u("check",11,3)}${r}</span>`:""}${n?`<span class="ck-warn">${u("alert",11,2.6)}${n}</span>`:""}${a?`<span class="ck-fail">${u("x",11,3)}${a}</span>`:""}</span>`}var Tt=new Set;function ds(e){let t=Tt.has(e.id),a=et(),n=`data-pid="${s(e.id)}" data-from="${s(e.cardano?.from??"")}"`,r=a.length?a.map(o=>`<button type="button" class="btn primary xs${t?" loading":""}" data-act="sign" data-wallet="${s(o.id)}" ${n} ${t?"disabled":""}>${u("wallet",14)}Sign with ${s(o.name)}</button>`).join(""):'<span class="muted small">Install Lace or Eternl to sign</span>';return`<span class="decide"><button type="button" class="btn ghost xs" data-act="decline" ${n} ${t?"disabled":""}>Cancel</button>${r}</span>`}var Ba=e=>e.status==="pending_approval"||e.status==="awaiting_signature",us=e=>e.status==="pending_approval"||e.status==="blocked"?`<span class="decide"><button type="button" class="btn ghost xs" data-act="reject" data-pid="${s(e.id)}">Reject</button><button type="button" class="btn primary xs" data-act="approve" data-pid="${s(e.id)}" ${e.status==="blocked"?'title="Checks everything again; pays only if it passes now"':""}>${u("check",14,2.6)}${e.status==="blocked"?"Check again":"Approve"}</button></span>`:e.status==="awaiting_signature"?ds(e):"";function ps(e){let t=e.verification??e.cardano?.verification;return t?`<dt>Verified</dt><dd>x402 report paid on Cardano from your agent wallet ${qa(t.txHash,t.explorerUrl)}</dd>`:""}var qa=(e,t)=>t?`<a class="mono" href="${s(t)}" target="_blank" rel="noopener noreferrer">${s(rt(e))} ${u("external",12)}</a>`:`<span class="mono">${s(rt(e))}</span>`;function ms(e){let t=e.cardano;return e.status==="executing"&&!t?.submitted?`<div class="callout info">${u("clock",15)}<span>${e.rail==="cardano_preprod"||e.rail==="cashxchain"?"Verifying on Cardano (x402), then paying. This takes up to a few minutes; the page updates by itself.":"Running."}</span></div>`:t?e.status==="awaiting_signature"?`<div class="callout info">${u("wallet",15)}<span>Checked and ready. Sign it in your wallet: the transaction is built from your wallet's funds when you click, and your wallet shows payee, amount and fee before you confirm. Nothing is sent without your signature.</span></div>`:e.status==="executing"&&t.submitted?`<div class="callout info">${u("clock",15)}<span>Sent to Cardano Preprod${t.byAgent?" from your agent wallet":""}; waiting for it to reach a block.</span></div>`:"":""}function hs(e){if(e.status==="executed"){let t=e.executedAt??e.decidedAt??e.createdAt,a=new Date(t).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"});return`<b>${s(R(t))}</b><span>${s(a)}</span>`}return e.status==="approved"||e.status==="executing"||e.status==="awaiting_signature"?'<span class="pp-wait">Not yet</span>':'<span class="pp-none" aria-label="Not paid">\u2014</span>'}function fs(e,t=!1){let a=e.currency==="ADA";return`<li class="pay-row${t?" open":""}" data-row="${s(e.id)}" id="pay-${s(e.id)}">
    <div class="pay-main" role="button" tabindex="0" aria-expanded="${t}" data-toggle>
      ${ne(e.payeeName)}
      <div class="pay-who"><b>${s(e.payeeName)}</b><span>${s(e.reason||"No reason given")}</span></div>
      <div class="pay-rail">${je(e.rail)}</div>
      <div class="pay-by"><span class="by by-${e.requestedBy}">${u(e.requestedBy==="agent"?"bot":"user",13,2)}${e.requestedBy==="agent"?"Agent":"You"}</span><em>${s(R(e.createdAt))}</em></div>
      <div class="pay-amt"><b>${s(G(e.amountMinor,e.currency))}</b>${a||e.currency!=="USD"?`<span>\u2248 ${s(H(e.usdMinor))}</span>`:""}</div>
      <div class="pay-status">${Fe(e.status)}${ls(e)}</div>
      <div class="pay-paid">${hs(e)}</div>
      <div class="pay-act">${us(e)}<span class="chev">${u("chevronDown",16)}</span></div>
    </div>
    <div class="pay-detail"><div class="pay-detail-in">
      <div class="pd-col">
        <div class="pd-h">Policy checks <span class="pill ${Ia[e.policy.decision][1]}">${Ia[e.policy.decision][0]}</span></div>
        ${Na(e)}
        ${ms(e)}
        ${e.error?`<div class="callout bad">${u("alert",15)}<span>${s(e.error)}</span></div>`:""}
      </div>
      <dl class="pd-col kv">
        <dt>Amount</dt><dd>${s(G(e.amountMinor,e.currency))}${a?' <span class="pill t-neutral">testnet</span>':""}</dd>
        <dt>Rail</dt><dd>${je(e.rail)}</dd>
        <dt>Pays to</dt><dd>${e.payeeId?"Saved payee account":cs(e)}</dd>
        <dt>Requested by</dt><dd>${e.requestedBy==="agent"?"AI CFO agent":"You"}${e.runId?` <span class="mono muted">${s(e.runId)}</span>`:""}</dd>
        ${e.cardano?`<dt>From</dt><dd><span class="mono" title="${s(e.cardano.from)}">${s(me(e.cardano.from))}</span> <span class="muted small">${e.cardano.byAgent?"your agent wallet":"your wallet"}</span></dd>`:""}
        ${ps(e)}
        ${e.reference&&!e.txHash?`<dt>Reference</dt><dd class="mono">${s(e.reference)}</dd>`:""}
        ${e.txHash?`<dt>Transaction</dt><dd>${qa(e.txHash,e.explorerUrl)}${e.cardano?e.cardano.confirmedAt?' <span class="pill t-ok">in a block</span>':' <span class="pill t-neutral">waiting for a block</span>':""}</dd>`:""}
        ${e.documentId?`<dt>Document</dt><dd><a href="/app/documents/${s(e.documentId)}">Open source document</a></dd>`:""}
        <dt>Created</dt><dd>${s($e(e.createdAt))}</dd>
        ${e.decidedAt?`<dt>Decided</dt><dd>${s($e(e.decidedAt))}</dd>`:""}
        ${e.executedAt?`<dt>Executed</dt><dd>${s($e(e.executedAt))}</dd>`:""}
      </dl>
    </div></div>
  </li>`}function ys(e,t){e.addEventListener("click",async a=>{let n=a.target,r=n.closest("[data-act]");if(r&&(r.dataset.act==="sign"||r.dataset.act==="decline")){a.stopPropagation();let i=r.dataset.pid,l=r.closest(".decide");for(let c of l?.querySelectorAll("button")??[])c.disabled=!0;r.classList.add("loading"),Tt.add(i);try{let c=`/api/v1/payments/${encodeURIComponent(i)}`;if(r.dataset.act==="sign"){let d=await Aa(r.dataset.wallet,r.dataset.from),m=await O(`${c}/transaction`,d.funds),h=await d.sign(m.txCbor),f=await O(`${c}/signature`,{txHash:m.txHash,witnessSet:h});P(f.status==="executed"?`Sent to ${f.payeeName} on Cardano Preprod`:"Signed. Waiting for the network to confirm\u2026","ok")}else await O(`${c}/signature`,{declined:!0}),P("Payment cancelled: nothing was sent","ok")}catch(c){c instanceof Error&&!(c instanceof J)&&P(c.message,"error")}finally{Tt.delete(i);let c=(await D("/api/v1/payments").catch(()=>[])).find(d=>d.id===i);c&&t(c)}return}if(r){a.stopPropagation();let i=r.dataset.pid,l=r.dataset.act,c=r.closest(".decide");for(let d of c?.querySelectorAll("button")??[])d.disabled=!0;r.classList.add("loading");try{t(await St(i,l))}catch{for(let d of c?.querySelectorAll("button")??[])d.disabled=!1;r.classList.remove("loading")}return}let o=n.closest("[data-toggle]");if(o&&!n.closest("a")){let i=o.closest(".pay-row");i.classList.toggle("open"),o.setAttribute("aria-expanded",String(i.classList.contains("open")))}}),e.addEventListener("keydown",a=>{let n=a.target;(a.key==="Enter"||a.key===" ")&&n.matches("[data-toggle]")&&(a.preventDefault(),n.click())})}var gs=[["USD","USD"],["EUR","EUR"],["GBP","GBP"],["CHF","CHF"],["ADA","tADA (Cardano Preprod)"]],bs=(e="USD")=>gs.map(([t,a])=>`<option value="${t}"${t===e?" selected":""}>${a}</option>`).join("");function vs(e,t){return e==null?"":String(e/10**(t==="ADA"?6:t==="JPY"?0:2))}async function Ht(e={}){let t=await D("/api/v1/payees"),a=e.counterparty?t.find(i=>i.name.toLowerCase()===e.counterparty.toLowerCase()):void 0,n=e.payeeId??a?.id??"",r=e.currency??"USD",o=null;return await X({title:"New payment",submit:"Create payment",body:`
      <div class="field"><label for="np-payee">Payee</label>
        <select id="np-payee" name="payeeId">
          <option value="" disabled${n?"":" selected"}>Choose a payee\u2026</option>
          ${t.map(i=>`<option value="${s(i.id)}"${i.id===n?" selected":""}>${s(i.name)}${i.cardanoAddress?" \xB7 Cardano":i.iban?" \xB7 IBAN":i.accountNumber?" \xB7 ACH":""}</option>`).join("")}
          <option value="__new">+ Add a new payee\u2026</option>
        </select>
      </div>
      <div class="np-new" hidden>
        <div class="sub-card">
          <div class="field"><label for="np-name">Payee name</label><input id="np-name" name="newName" autocomplete="off" value="${s(a?"":e.counterparty??"")}" placeholder="Acme GmbH"></div>
          <div class="grid2">
            <div class="field"><label for="np-iban">IBAN <span class="opt-l">optional</span></label><input id="np-iban" name="newIban" autocomplete="off" placeholder="DE89 3704 0044 \u2026"></div>
            <div class="field"><label for="np-country">Country <span class="opt-l">optional</span></label><input id="np-country" name="newCountry" maxlength="2" placeholder="DE"></div>
          </div>
          <div class="field"><label for="np-ada">Cardano address <span class="opt-l">optional, Preprod</span></label><input id="np-ada" name="newAda" class="mono" autocomplete="off" placeholder="addr_test1\u2026"></div>
          <p class="fine">Saved to your payee directory. Add full bank details later on the Payees page.</p>
        </div>
      </div>
      <div class="grid2 amt-grid">
        <div class="field"><label for="np-amount">Amount</label><input id="np-amount" name="amount" inputmode="decimal" placeholder="0.00" value="${s(vs(e.amountMinor,r))}"></div>
        <div class="field"><label for="np-cur">Currency</label><select id="np-cur" name="currency">${bs(r)}</select></div>
      </div>
      <div class="field"><label for="np-reason">Reason</label><textarea id="np-reason" name="reason" rows="2" placeholder="Invoice INV-1042, October hosting">${s(e.reason??"")}</textarea></div>
      <div class="callout">${u("shield",15)}<span>Code checks every payment against your policy before anything moves. tADA runs on Cardano Preprod (testnet); fiat runs on the CashXChain sandbox rail.</span></div>`,onOpen:i=>{let l=i.elements.namedItem("payeeId"),c=i.querySelector(".np-new"),d=()=>{c.hidden=l.value!=="__new",c.hidden||i.elements.namedItem("newName").focus()};l.addEventListener("change",d),t.length||(l.value="__new",d())},onSubmit:async i=>{let l=B(i,"payeeId"),c=B(i,"currency"),d=he(B(i,"amount"),c),m=B(i,"reason");if(!l)return I(i,"payeeId","Choose who to pay.");if(l==="__new"&&!B(i,"newName"))return I(i,"newName","Enter the payee's name.");let h=B(i,"newAda");if(l==="__new"&&h&&!/^addr_test1[0-9a-z]+$/.test(h))return I(i,"newAda","Use a Cardano Preprod address (addr_test1\u2026).");if(!Number.isFinite(d)||d<=0)return I(i,"amount","Enter an amount above zero.");if(!m)return I(i,"reason","Add a short reason. It appears in the audit log.");if(l==="__new"){let p={name:B(i,"newName")},y=B(i,"newIban").replace(/\s+/g,"").toUpperCase();y&&(p.iban=y);let w=B(i,"newCountry").toUpperCase();w&&(p.country=w),h&&(p.cardanoAddress=h),l=(await O("/api/v1/payees",p)).id}let f={payeeId:l,amountMinor:d,currency:c,reason:m};return e.documentId&&(f.documentId=e.documentId),o=await O("/api/v1/payments",f),P(o.status==="pending_approval"?"Payment created. It is waiting for your approval.":o.status==="blocked"?"Payment blocked by policy. See the checks for why.":"Payment created.",o.status==="blocked"?"error":"ok"),Be(),!0}}),o}async function Ra(e,t){let a=t.query.get("tab")==="all"||t.query.get("id")?"all":"approvals",n="any",r=t.query.get("id");e.innerHTML=`${K("Payments","Every payment is checked by code against your policy. Payouts run on Cardano Preprod (testnet tADA) and the CashXChain sandbox rail.",`<button class="btn primary sm" type="button" id="pay-new">${u("plus",16,2.4)}New payment</button>`)}
  <section class="stat-row" id="pay-stats">${Array.from({length:3},()=>`<div class="stat-card">${V(1)}</div>`).join("")}</section>
  <section class="card list-card">
    <div class="list-head">
      <div class="tabs" role="tablist"><button role="tab" data-tab="approvals">Approvals <em id="n-appr"></em></button><button role="tab" data-tab="all">All payments <em id="n-all"></em></button></div>
      <div class="chips" id="pay-filter" hidden>
        <button data-f="any" class="on">All</button><button data-f="done">Paid</button><button data-f="live">In progress</button><button data-f="stopped">Rejected &amp; failed</button>
      </div>
    </div>
    <div class="filters" role="search">
      <label class="search">${u("search",15)}<input id="pf-q" type="search" autocomplete="off" placeholder="Search payee, reason or amount" aria-label="Search payments"></label>
      <select class="fsel" id="pf-rail" aria-label="Rail"><option value="">All rails</option>${Object.keys(Se).map($=>`<option value="${$}">${s(Se[$].name)}</option>`).join("")}</select>
      <select class="fsel" id="pf-by" aria-label="Requested by"><option value="">Anyone</option><option value="agent">Agent</option><option value="user">You</option></select>
      <select class="fsel" id="pf-period" aria-label="Created"><option value="">Any time</option><option value="month">This month</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select>
      <button type="button" class="link-sm" id="pf-clear" hidden>Clear filters</button>
      <span class="pf-count" id="pf-count" aria-live="polite"></span>
    </div>
    <div class="pay-cols" aria-hidden="true"><span></span><span>Payee</span><span class="pc-rail">Rail</span><span class="pc-by">Requested</span><span class="pc-r">Amount</span><span>Status</span><span>Paid</span><span></span></div>
    <ul class="pay-list" id="pay-list">${V(5)}</ul>
  </section>`;let o=[],i=e.querySelector("#pay-list"),l={q:"",rail:"",by:"",period:""},c=()=>!!(l.q||l.rail||l.by||l.period),d=$=>{if(l.rail&&$.rail!==l.rail||l.by&&$.requestedBy!==l.by||l.period==="month"&&!$.createdAt.startsWith(new Date().toISOString().slice(0,7))||/^\d+$/.test(l.period)&&Date.now()-Date.parse($.createdAt)>Number(l.period)*864e5)return!1;if(l.q){let x=`${$.payeeName} ${$.reason} ${$.reference??""} ${G($.amountMinor,$.currency)} ${H($.usdMinor)}`.toLowerCase();if(!l.q.toLowerCase().split(/\s+/).every(L=>x.includes(L)))return!1}return!0},m=e.querySelector(".filters"),h={q:e.querySelector("#pf-q"),rail:e.querySelector("#pf-rail"),by:e.querySelector("#pf-by"),period:e.querySelector("#pf-period")},f=()=>{l.q=h.q.value.trim(),l.rail=h.rail.value,l.by=h.by.value,l.period=h.period.value;for(let $ of["rail","by","period"])h[$].classList.toggle("on",!!l[$]);y()};m.addEventListener("input",f);let p=()=>{h.q.value=h.rail.value=h.by.value=h.period.value="",f()},y=()=>{for(let S of e.querySelectorAll("[data-tab]"))S.setAttribute("aria-selected",String(S.dataset.tab===a));e.querySelector("#pay-filter").hidden=a!=="all";let $=o.filter(Ba);e.querySelector("#n-appr").textContent=String($.length),e.querySelector("#n-all").textContent=String(o.length);let x={done:["executed"],live:["pending_approval","approved","executing","awaiting_signature"],stopped:["rejected","failed","blocked"]},L=a==="approvals"?$:n==="any"?o:o.filter(S=>x[n].includes(S.status)),M=L.filter(d);e.querySelector("#pf-clear").hidden=!c(),e.querySelector("#pf-count").textContent=c()?`${M.length} of ${L.length}`:"",i.innerHTML=M.length?M.map(S=>fs(S,S.id===r)).join(""):`<li class="list-empty">${L.length&&c()?j({icon:"search",title:"No payments match these filters",text:"Change the search or the filters above.",action:'<button class="btn ghost sm" type="button" data-clear>Clear filters</button>'}):a==="approvals"?j({icon:"shieldCheck",title:"Nothing waiting for you",text:"When the agent or a teammate drafts a payment that needs a human, it shows up here with its policy checks."}):j({icon:"pay",title:"No payments yet",text:"Draft one yourself, or ask the AI CFO to prepare payments from your invoices.",action:`<button class="btn primary sm" type="button" data-new>${u("plus",15,2.4)}New payment</button>`})}</li>`;let E=S=>S.reduce((b,k)=>b+k.usdMinor,0),A=new Date().toISOString().slice(0,7),T=o.filter(S=>S.status==="executed"&&(S.executedAt??S.createdAt).startsWith(A)),q=o.filter(S=>S.status==="blocked"||S.status==="failed");e.querySelector("#pay-stats").innerHTML=`
      <div class="stat-card"><span class="label">Waiting for you</span><b>${s(H(E($)))}</b><span class="sub">${$.length} payment${$.length===1?"":"s"}</span></div>
      <div class="stat-card"><span class="label">Paid this month</span><b>${s(H(E(T)))}</b><span class="sub">${T.length} payment${T.length===1?"":"s"} \xB7 testnet &amp; sandbox</span></div>
      <div class="stat-card"><span class="label">Stopped by policy or errors</span><b>${q.length}</b><span class="sub">blocked or failed</span></div>`,r&&document.getElementById(`pay-${r}`)?.scrollIntoView({block:"center"})},w=async()=>{if(o=await D("/api/v1/payments"),!t.alive())return;o.sort((x,L)=>L.createdAt.localeCompare(x.createdAt)),y();let $=x=>x.status==="executed"&&x.cardano?.submitted&&!x.cardano.confirmedAt&&Date.now()-Date.parse(x.cardano.submitted.at)<15*6e4;if(o.some(x=>x.status==="executing"||x.status==="approved"||$(x))){let x=window.setTimeout(()=>{w().catch(()=>{})},2500);t.onCleanup(()=>window.clearTimeout(x))}};e.addEventListener("click",async $=>{let x=$.target,L=x.closest("[data-tab]");L&&(a=L.dataset.tab,y()),x.closest("#pf-clear, [data-clear]")&&p();let M=x.closest("[data-f]");if(M){n=M.dataset.f;for(let E of e.querySelectorAll("[data-f]"))E.classList.toggle("on",E===M);y()}if(x.closest("#pay-new, [data-new]")){let E=await Ht().catch(()=>null);E&&t.alive()&&(o.unshift(E),a=E.status==="pending_approval"?"approvals":"all",y())}}),ys(i,$=>{let x=o.findIndex(M=>M.id===$.id);x>=0&&(o[x]=$);let L=i.querySelector(`[data-row="${CSS.escape($.id)}"]`);a==="approvals"&&!Ba($)&&L?(L.classList.add("leaving"),window.setTimeout(y,280)):y(),($.status==="executing"||$.status==="approved")&&window.setTimeout(()=>t.alive()&&void w().catch(()=>{}),2e3)}),await w()}var ws={invoice:"Invoices",receipt:"Receipts",bank_statement:"Bank statements",contract:"Contracts",payroll:"Payroll",tax:"Tax",other:"Other"},Re=e=>`/api/v1/documents/${encodeURIComponent(e)}`;function $s(e){return e.status==="processing"?'<span class="pill t-run"><i class="live"></i>Reading</span>':e.status==="failed"?`<span class="pill t-bad" title="${s(e.error??"")}">Failed</span>`:`<span class="pill t-ok">${u("check",11,3)}Ready</span>`}function xs(e){let t=e.dueDate&&e.kind==="invoice"?De(e.dueDate):null;return`<tr data-id="${s(e.id)}" tabindex="0">
    <td class="c-doc"><div class="c-doc-in"><span class="doc-ic ${e.status} k-${s(e.kind??"none")}">${u(jt(e),17)}</span><div><b>${s(e.title||e.filename)}</b><span>${s(e.title?e.filename:ke(e.size))}${e.source==="chat"?" \xB7 from chat":""}</span></div></div></td>
    <td class="c-kind">${e.kind?`<span class="kind k-${e.kind}">${s(fe[e.kind]??e.kind)}</span>`:e.status==="processing"?N("60px",12):'<span class="muted">\u2014</span>'}</td>
    <td class="c-cp">${s(e.counterparty||"\u2014")}</td>
    <td class="c-amt num">${e.amountMinor!=null?s(G(e.amountMinor,e.currency)):'<span class="muted">\u2014</span>'}</td>
    <td class="c-due">${e.dueDate?`<span>${s(R(e.dueDate))}</span>${t&&t.tone&&t.tone!=="t-neutral"?`<em class="${t.tone}">${s(t.text)}</em>`:""}`:'<span class="muted">\u2014</span>'}</td>
    <td class="c-cat">${e.category?`<span class="cat">${s(e.category)}</span>`:'<span class="muted">\u2014</span>'}</td>
    <td class="c-st">${$s(e)}</td>
  </tr>`}async function ja(e,t){let a=[],n="all",r="",o=[],i=0,l=!1,c=new Set;e.innerHTML=`${K("Documents","Upload invoices, receipts, statements, contracts and payroll. Claude reads them and extracts amounts, dates and counterparties.")}
  <label class="drop" id="drop" tabindex="0">
    <input type="file" id="doc-file" multiple accept="${ze}" hidden>
    <span class="drop-ic">${u("upload",22)}</span>
    <span class="drop-t"><b>Drop files here or <u>browse</u></b><span>PDF, photos, CSV or text \xB7 up to 15 MB each \xB7 multiple files at once</span></span>
  </label>
  <ul class="queue" id="queue" hidden></ul>
  <section class="card list-card">
    <div class="list-head">
      <div class="chips" id="kinds"></div>
    </div>
    <div class="filters" id="doc-filters" role="search">
      <label class="search">${u("search",15)}<input id="doc-q" type="search" autocomplete="off" placeholder="Search documents" aria-label="Search documents"></label>
      <select class="fsel" id="df-cat" aria-label="Category"><option value="">All categories</option></select>
      <select class="fsel" id="df-due" aria-label="Due date"><option value="">Any due date</option><option value="overdue">Overdue</option><option value="14">Due in 14 days</option><option value="none">No due date</option></select>
      <select class="fsel" id="df-period" aria-label="Uploaded"><option value="">Uploaded any time</option><option value="month">This month</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option></select>
      <select class="fsel" id="df-src" aria-label="Source"><option value="">All sources</option><option value="upload">Uploaded</option><option value="chat">From chat</option></select>
      <button type="button" class="link-sm" id="df-clear" hidden>Clear filters</button>
      <span class="pf-count" id="df-count" aria-live="polite"></span>
    </div>
    <div class="tbl-wrap" id="doc-table"><div class="pad">${V(6)}</div></div>
  </section>`;let d=e.querySelector("#doc-table"),m={cat:e.querySelector("#df-cat"),due:e.querySelector("#df-due"),period:e.querySelector("#df-period"),src:e.querySelector("#df-src")},h=()=>Object.values(m).some(b=>b.value),f=b=>{if(m.cat.value&&b.category!==m.cat.value||m.src.value&&b.source!==m.src.value)return!1;let k=m.due.value;if(k){let C=Pe(b.dueDate);if(k==="none"?C!=null:C==null||(k==="overdue"?C>=0:C<0||C>Number(k)))return!1}let F=m.period.value;return!(F==="month"&&!b.createdAt.startsWith(new Date().toISOString().slice(0,7))||/^\d+$/.test(F)&&Date.now()-Date.parse(b.createdAt)>Number(F)*864e5)},p="",y=()=>{let b=[...new Set(a.map(C=>C.category).filter(C=>!!C))].sort((C,v)=>C.localeCompare(v)),k=b.join("\0");if(k===p)return;p=k;let F=m.cat.value;m.cat.innerHTML=`<option value="">All categories</option>${b.map(C=>`<option value="${s(C)}">${s(C)}</option>`).join("")}`,m.cat.value=b.includes(F)?F:""},w=e.querySelector("#kinds"),$=e.querySelector("#queue"),x=()=>{let b=new Map;for(let g of a)g.kind&&b.set(g.kind,(b.get(g.kind)??0)+1);let k=a.filter(g=>g.status!=="processed").length;w.innerHTML=`<button data-k="all" class="${n==="all"?"on":""}">All <em>${a.length}</em></button>`+Object.keys(fe).filter(g=>b.get(g)).map(g=>`<button data-k="${g}" class="${n===g?"on":""}">${ws[g]??fe[g]} <em>${b.get(g)}</em></button>`).join("")+(k?`<button data-k="pending" class="${n==="pending"?"on":""}">Processing &amp; failed <em>${k}</em></button>`:"");let F=r.toLowerCase();y();for(let g of Object.values(m))g.classList.toggle("on",!!g.value);let C=a.filter(g=>(n==="all"||(n==="pending"?g.status!=="processed":g.kind===n))&&(!F||[g.title,g.filename,g.counterparty,g.category].some(U=>U?.toLowerCase().includes(F)))),v=C.filter(f);if(e.querySelector("#df-clear").hidden=!h(),e.querySelector("#df-count").textContent=h()?`${v.length} of ${C.length}`:"",!a.length){d.innerHTML=j({icon:"doc",title:"No documents yet",text:"Upload your first invoices, receipts or bank statements above. Your AI CFO reads them and keeps your books, budgets and forecast current."});return}if(!v.length){d.innerHTML=j({icon:"search",title:"No matches",text:"Try another filter or search term.",...h()?{action:'<button class="btn ghost sm" type="button" data-clear-filters>Clear filters</button>'}:{}});return}d.innerHTML=`<table class="tbl docs"><thead><tr><th>Document</th><th class="c-kind">Kind</th><th class="c-cp">Counterparty</th><th class="c-amt num">Amount</th><th class="c-due">Due</th><th class="c-cat">Category</th><th class="c-st">Status</th></tr></thead><tbody>${v.map(xs).join("")}</tbody></table>`},L=b=>{if(c.has(b))return;c.add(b);let k=Date.now(),F=async()=>{if(!t.alive())return;try{let g=await D(Re(b),!0);if(!t.alive())return;if(g.status!=="processing"||Date.now()-k>18e4){c.delete(b);let U=a.findIndex(z=>z.id===b);U>=0?a[U]=g:a.unshift(g);let Y=o.find(z=>z.doc?.id===b);Y&&(Y.doc=g,Y.state=g.status==="processed"?"done":g.status==="failed"?"failed":"processing",Y.error=g.error,E()),x();return}}catch{}let v=window.setTimeout(F,1500);t.onCleanup(()=>window.clearTimeout(v))},C=window.setTimeout(F,1200);t.onCleanup(()=>window.clearTimeout(C))},M={waiting:"Waiting",reading:"Preparing",uploading:"Uploading",processing:"Claude is reading it\u2026",done:"Done",failed:"Failed"},E=()=>{$.hidden=!o.length;let b=o.some(k=>k.state!=="done"&&k.state!=="failed");$.innerHTML=o.map(k=>{let F=k.state==="uploading"?Math.round(k.progress*100):k.state==="waiting"||k.state==="reading"?0:100,C=k.state==="done"&&k.doc?`${fe[k.doc.kind??"other"]??"Document"}${k.doc.counterparty?` from ${k.doc.counterparty}`:""}${k.doc.amountMinor!=null?` \xB7 ${G(k.doc.amountMinor,k.doc.currency)}`:""}`:k.state==="failed"?k.error||"Could not process this file":`${M[k.state]}${k.state==="uploading"?` ${F}%`:""}`;return`<li class="q-item q-${k.state}">
          <span class="q-ic">${k.state==="done"?u("check",16,2.6):k.state==="failed"?u("alert",16):k.state==="processing"?'<i class="spin"></i>':u(Ce(Ue(k.file)),16)}</span>
          <div class="q-body"><div class="q-top"><b>${s(k.file.name)}</b><span>${s(ke(k.file.size))}</span></div>
          <div class="q-bar"><i style="width:${F}%"></i></div><span class="q-state">${s(C)}</span></div>
          ${k.doc&&k.state==="done"?`<a class="btn ghost xs" href="/app/documents/${s(k.doc.id)}">Open</a>`:""}
        </li>`}).join("")+(b?"":'<li class="q-foot"><button type="button" class="link-sm" id="q-clear">Clear finished</button></li>')},A=async()=>{if(!l){l=!0;try{for(;;){let b=o.find(k=>k.state==="waiting");if(!b||!t.alive())break;b.state="reading",E();try{let k={filename:b.file.name,mimeType:Ue(b.file),dataBase64:await Oe(b.file)};b.state="uploading",E();let F=0,C=await Wt("/api/v1/documents",k,v=>{b.progress=v,Date.now()-F>80&&(F=Date.now(),E())});b.doc=C,b.state=C.status==="processing"?"processing":C.status==="failed"?"failed":"done",b.error=C.error,a.unshift(C),x(),C.status==="processing"&&L(C.id)}catch(k){b.state="failed",b.error=k.message,P(`${b.file.name}: ${b.error}`,"error")}E()}}finally{l=!1}}},T=b=>{for(let k of Array.from(b)){if(k.size>We){P(`${k.name} is larger than 15 MB.`,"error");continue}o.push({key:++i,file:k,state:"waiting",progress:0})}E(),A()},q=e.querySelector("#drop"),S=e.querySelector("#doc-file");if(S.addEventListener("change",()=>{S.files&&T(S.files),S.value=""}),q.addEventListener("keydown",b=>{(b.key==="Enter"||b.key===" ")&&(b.preventDefault(),S.click())}),q.addEventListener("dragover",b=>{b.preventDefault(),q.classList.add("over")}),q.addEventListener("dragleave",()=>q.classList.remove("over")),q.addEventListener("drop",b=>{b.preventDefault(),q.classList.remove("over"),b.dataTransfer?.files.length&&T(b.dataTransfer.files)}),$.addEventListener("click",b=>{if(b.target.closest("#q-clear")){for(let k=o.length-1;k>=0;k--)(o[k].state==="done"||o[k].state==="failed")&&o.splice(k,1);E()}}),w.addEventListener("click",b=>{let k=b.target.closest("[data-k]");k&&(n=k.dataset.k,x())}),e.querySelector("#doc-filters").addEventListener("input",()=>x()),e.addEventListener("click",b=>{if(b.target.closest("#df-clear, [data-clear-filters]")){for(let k of Object.values(m))k.value="";x()}}),e.querySelector("#doc-q").addEventListener("input",b=>{r=b.target.value.trim(),x()}),d.addEventListener("click",b=>{let k=b.target.closest("tr[data-id]");k&&re(`/app/documents/${encodeURIComponent(k.dataset.id)}`)}),d.addEventListener("keydown",b=>{let k=b.target.closest("tr[data-id]");k&&b.key==="Enter"&&re(`/app/documents/${encodeURIComponent(k.dataset.id)}`)}),a=await D("/api/v1/documents"),!!t.alive()){a.sort((b,k)=>k.createdAt.localeCompare(b.createdAt)),x();for(let b of a)b.status==="processing"&&L(b.id)}}var at=e=>!!e&&typeof e=="object"&&!Array.isArray(e);function nt(e){return e==null||e===""?'<span class="muted">\u2014</span>':typeof e=="boolean"?e?"Yes":"No":typeof e=="number"?s(e.toLocaleString("en-US")):s(String(e))}function Fa(e,t=0){if(Array.isArray(e)){if(!e.length)return'<span class="muted">None</span>';if(e.every(at)){let a=[...new Set(e.flatMap(n=>Object.keys(n)))].slice(0,6);return`<div class="md-table"><table><thead><tr>${a.map(n=>`<th>${s(dt(n))}</th>`).join("")}</tr></thead><tbody>${e.map(n=>`<tr>${a.map(r=>`<td>${at(n[r])?s(JSON.stringify(n[r])):nt(n[r])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`}return e.map(nt).join(", ")}if(at(e)){let a=Object.entries(e);return a.length?`<dl class="kv ${t?"nested":""}">${a.map(([n,r])=>`<dt>${s(dt(n))}</dt><dd>${at(r)||Array.isArray(r)?Fa(r,t+1):nt(r)}</dd>`).join("")}</dl>`:'<span class="muted">\u2014</span>'}return nt(e)}async function ks(e,t){let a=`${Re(t.id)}/file`;if(t.mimeType.startsWith("image/"))e.innerHTML=`<img src="${s(a)}" alt="${s(t.filename)}" loading="lazy">`;else if(t.mimeType==="application/pdf")e.innerHTML=`<iframe src="${s(a)}#view=FitH&toolbar=0" title="${s(t.filename)}"></iframe><a class="preview-open" href="${s(a)}" target="_blank" rel="noopener">${u("external",13)}Open PDF in a new tab</a>`;else if(t.mimeType.startsWith("text/")||/csv/.test(t.mimeType)){e.innerHTML=`<div class="pad">${N("90%")}<div style="height:8px"></div>${N("70%")}</div>`;try{let o=(await(await fetch(a,{credentials:"same-origin"})).text()).split(`
`);if(/csv/.test(t.mimeType)||t.filename.endsWith(".csv")){let i=o.filter(l=>l.trim()).slice(0,60).map(l=>l.split(",").map(c=>c.replace(/^"|"$/g,"")));e.innerHTML=`<div class="csv"><table>${i.map((l,c)=>`<tr>${l.map(d=>c?`<td>${s(d)}</td>`:`<th>${s(d)}</th>`).join("")}</tr>`).join("")}</table></div>`}else e.innerHTML=`<pre class="txt">${s(o.slice(0,300).join(`
`))}</pre>`}catch{e.innerHTML='<div class="chart-empty">Preview unavailable.</div>'}}else e.innerHTML=`<div class="chart-empty">No preview for this file type. <a href="${s(a)}" download="${s(t.filename)}">Download it</a>.</div>`}async function Oa(e,t){let a=t.params[0];e.innerHTML=`<a class="back" href="/app/documents">${u("chevronLeft",16)}Documents</a>
    <header class="page-head"><div class="page-title">${N("320px",30)}<div style="height:10px"></div>${N("200px",13)}</div></header>
    <div class="doc-grid"><div class="card preview-card">${N("100%",480,14)}</div><div class="col">${_a()}${_a()}</div></div>`;let n;try{n=await D(Re(a),!0)}catch{if(!t.alive())return;e.innerHTML=`<a class="back" href="/app/documents">${u("chevronLeft",16)}Documents</a>${j({icon:"doc",title:"Document not found",text:"It may have been deleted.",action:'<a class="btn primary sm" href="/app/documents">Back to documents</a>'})}`;return}if(!t.alive())return;let r=n.dueDate?De(n.dueDate):null,o=n.status==="processed"&&(n.kind==="invoice"||n.kind==="payroll"||n.kind==="tax"),i=n.payments.some(c=>c.status==="executed"),l=[n.kind?fe[n.kind]:null,n.filename,`${ke(n.size)}`,`uploaded ${R(n.createdAt)}${n.source==="chat"?" in chat":""}`].filter(Boolean).map(c=>s(c)).join(" \xB7 ");if(e.innerHTML=`<a class="back" href="/app/documents">${u("chevronLeft",16)}Documents</a>
  ${K(n.title||n.filename,l,`<button class="btn ghost sm" type="button" id="d-ask">${u("sparkle",16)}Ask CFO about this</button>
     ${n.status==="processed"?`<button class="btn ${o&&!i?"primary":"ghost"} sm" type="button" id="d-pay">${u("pay",16)}Draft payment</button>`:""}
     <a class="icon-btn boxed" href="${s(Re(n.id))}/file" download="${s(n.filename)}" aria-label="Download original" title="Download original">${u("download",17)}</a>
     <button class="icon-btn boxed danger-h" type="button" id="d-del" aria-label="Delete document" title="Delete document">${u("trash",17)}</button>`)}
  ${n.status==="processing"?'<div class="callout run"><i class="spin"></i><span>Claude is reading this document. Fields appear here when it is done.</span></div>':""}
  ${n.status==="failed"?`<div class="callout bad">${u("alert",15)}<span>${s(n.error||"This document could not be processed.")} Try uploading a clearer copy.</span></div>`:""}
  <div class="doc-grid">
    <div class="card preview-card"><div class="preview" id="preview"></div></div>
    <div class="col">
      <section class="card">
        <div class="card-head"><h2>Summary</h2>${n.status==="processed"?'<span class="pill t-ok">'+u("check",11,3)+"Read by Claude</span>":""}</div>
        ${n.summary?`<p class="doc-sum">${s(n.summary)}</p>`:""}
        <dl class="kv">
          <dt>Kind</dt><dd>${n.kind?s(fe[n.kind]??n.kind):"\u2014"}</dd>
          <dt>Counterparty</dt><dd>${s(n.counterparty||"\u2014")}</dd>
          <dt>Amount</dt><dd class="strong">${n.amountMinor!=null?s(G(n.amountMinor,n.currency)):"\u2014"}</dd>
          <dt>Issued</dt><dd>${s(R(n.issueDate,!0))}</dd>
          <dt>Due</dt><dd>${n.dueDate?`${s(R(n.dueDate,!0))} ${r&&!i?`<span class="pill ${r.tone}">${s(r.text)}</span>`:""}`:"\u2014"}</dd>
          <dt>Category</dt><dd>${n.category?`<span class="cat">${s(n.category)}</span>`:"\u2014"}</dd>
        </dl>
      </section>
      ${n.extracted&&Object.keys(n.extracted).length?`<section class="card"><div class="card-head"><h2>Extracted details</h2><span class="count">for reference</span></div><div class="extracted">${Fa(n.extracted)}</div></section>`:""}
      <section class="card">
        <div class="card-head"><h2>Payments</h2></div>
        ${n.payments.length?`<ul class="link-list">${n.payments.map(c=>`<li><a href="/app/payments?id=${s(c.id)}"><div><b>${s(c.payeeName)}</b><span>${s($e(c.createdAt))}</span></div><div class="ll-r"><b>${s(G(c.amountMinor,c.currency))}</b>${Fe(c.status)}</div></a></li>`).join("")}</ul>`:`<p class="muted small">No payments linked to this document${o?". Draft one and it goes through your policy checks.":"."}</p>`}
      </section>
      <section class="card">
        <div class="card-head"><h2>Transactions</h2></div>
        ${n.transactions.length?`<ul class="link-list">${n.transactions.map(c=>`<li><div class="ll"><div><b>${s(c.description)}</b><span>${s(R(c.date))} \xB7 ${s(c.category)}</span></div><div class="ll-r"><b class="${c.amountMinor<0?"":"pos"}">${s(G(c.amountMinor,c.currency))}</b>${c.currency!=="USD"?`<span class="muted small">\u2248 ${s(H(c.usdMinor))}</span>`:""}</div></div></li>`).join("")}</ul>`:'<p class="muted small">No transactions recorded from this document.</p>'}
      </section>
    </div>
  </div>`,ks(e.querySelector("#preview"),n),e.querySelector("#d-ask").addEventListener("click",()=>Ie(`About the document \u201C${n.title||n.filename}\u201D${n.counterparty?` from ${n.counterparty}`:""}: summarise what it says and tell me what I should do about it.`)),e.querySelector("#d-pay")?.addEventListener("click",async()=>{await Ht({amountMinor:n.amountMinor,currency:n.currency,documentId:n.id,counterparty:n.counterparty,reason:[n.title||n.filename,n.counterparty].filter(Boolean).join(" \xB7 ")}).catch(()=>null)&&t.alive()&&t.reload()}),e.querySelector("#d-del").addEventListener("click",async()=>{if(await Q("Delete document?",`\u201C${n.title||n.filename}\u201D and its extracted data will be removed. Payments already made are kept in the audit log.`,"Delete",!0))try{await te(Re(n.id)),P("Document deleted","ok"),re("/app/documents",{replace:!0})}catch{}}),n.status==="processing"){let c=window.setTimeout(()=>t.reload(),2500);t.onCleanup(()=>window.clearTimeout(c))}}function _a(){return`<div class="card">${N("30%",18)}<div style="height:16px"></div>${V(3)}</div>`}var Cs=["Summarise my spending this month","Which invoices are due in the next 14 days?","Forecast my cash for the next 90 days"];function Wa(){let e=new Date().getHours();return e<5?"Good evening":e<12?"Good morning":e<18?"Good afternoon":"Good evening"}function Ms(e){let t=e.limitUsdMinor?e.spentUsdMinor/e.limitUsdMinor*100:0,a=t>100,n=!a&&t>=85;return`<li class="bud ${a?"over":n?"warn":""}">
    <div class="bud-top"><b>${s(e.name)}</b><span>${s(H(e.spentUsdMinor,{cents:!1}))} <em>of ${s(H(e.limitUsdMinor,{cents:!1}))}</em></span></div>
    <div class="meter"><i style="width:${Math.min(100,t).toFixed(1)}%"></i></div>
    <div class="bud-sub"><span>${e.category.toLowerCase()===e.name.toLowerCase()?"":s(e.category)}</span>${a?`<span class="over-l">${u("alert",12,2.4)}${s(H(e.spentUsdMinor-e.limitUsdMinor,{cents:!1}))} over</span>`:`<span>${Math.round(t)}% used</span>`}</div>
  </li>`}var Pt=14;function Ls(e){let t=De(e.dueDate);return`<li><a href="/app/documents/${s(e.id)}"><div><b>${s(e.counterparty||e.title||e.filename)}</b><span>${s(e.title||e.filename)}</span></div><div class="due-r"><b>${s(G(e.amountMinor,e.currency))}</b><span class="pill ${t.tone}">${s(t.text)}</span></div></a></li>`}var za=e=>e?`${e} thing${e===1?" needs":"s need"} you.`:"Nothing needs you right now.",Ya=`<div class="attn-empty">${j({icon:"shieldCheck",title:"All caught up",text:`Nothing to approve and no invoices due in the next ${Pt} days.`})}</div>`;function Es(e){return`<li class="ap" data-row="${s(e.id)}">
    ${ne(e.payeeName)}
    <a class="ap-who" href="/app/payments?id=${s(e.id)}"><b>${s(e.payeeName)}</b><span>${s(e.reason)}</span></a>
    <div class="ap-amt"><b>${s(G(e.amountMinor,e.currency))}</b><span>${e.requestedBy==="agent"?"Agent":"You"} \xB7 ${s(e.rail==="cardano_preprod"?"Preprod testnet":e.rail==="cashxchain"?"Sandbox":"Manual")}</span></div>
    <span class="decide"><button type="button" class="btn ghost xs" data-act="reject" data-pid="${s(e.id)}" aria-label="Reject payment to ${s(e.payeeName)}">${u("x",14,2.4)}</button><button type="button" class="btn primary xs" data-act="approve" data-pid="${s(e.id)}">${u("check",14,2.6)}Approve</button></span>
  </li>`}async function Ka(e,t){let a=_.me?.user.name?.split(" ")[0],n=new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric"});e.innerHTML=`
  <header class="page-head"><div class="page-title"><h1>${s(Wa())}${a?`, ${s(a)}`:""}</h1><p>${s(n)} \xB7 <span id="ov-needs">Here is where your business stands.</span></p></div>
    <div class="page-actions"><a class="btn ghost sm" href="/app/documents">${u("upload",16)}Upload</a><span id="ov-agent"></span></div></header>
  <form class="ask reveal" id="ask">
    <span class="ask-ic">${u("sparkle",20)}</span>
    <input id="ask-in" name="q" autocomplete="off" placeholder="Ask your AI CFO anything about your money\u2026" aria-label="Ask your AI CFO">
    <button class="btn primary sm" type="submit">Ask${u("arrowRight",15,2.2)}</button>
    <div class="ask-chips">${Cs.map(C=>`<button type="button" class="opt" data-q="${s(C)}">${s(C)}</button>`).join("")}</div>
  </form>
  <div id="ov-body">
    <section class="today">${Array.from({length:3},()=>`<div class="today-item">${N("50%",12)}<div style="height:10px"></div>${N("70%",24)}</div>`).join("")}</section>
    <section class="ov-grid">${ye(340)}${ye(340)}</section>
  </div>`,e.querySelector("#ask").addEventListener("submit",C=>{C.preventDefault();let v=(e.querySelector("#ask-in").value||"").trim();v?Ie(v):e.querySelector("#ask-in").focus()});for(let C of e.querySelectorAll("[data-q]"))C.addEventListener("click",()=>Ie(C.dataset.q));a||D("/api/v1/me",!0).then(C=>{let v=C.user.name?.split(" ")[0],g=e.querySelector(".page-head h1");v&&g&&t.alive()&&(g.textContent=`${Wa()}, ${v}`)}).catch(()=>{});let[o,i]=await Promise.all([D("/api/v1/overview"),D("/api/v1/forecast?days=90",!0).catch(()=>null)]);if(!t.alive())return;let l=e.querySelector("#ov-body"),c=o.cash.connections.length===0&&o.documents.total===0,d=o.agent,m=o.monthly[o.monthly.length-1],h=o.spendByCategory.reduce((C,v)=>C+v.usdMinor,0),f=o.approvals.payments.reduce((C,v)=>C+v.usdMinor,0),p=o.payables.upcoming.filter(C=>{let v=Pe(C.dueDate);return v!=null&&v<=Pt}),y=o.approvals.count+p.length,w=o.payables.upcoming.find(C=>C.dueDate);e.querySelector("#ov-needs").textContent=za(y);let $=d.limits.monthlyUsdMinor?Math.min(100,d.executedThisMonthUsdMinor/d.limits.monthlyUsdMinor*100):0;e.querySelector("#ov-agent").outerHTML=`<a class="agent-chip a-${d.autonomy}" href="/app/agent" title="What your agent may do on its own"><i></i><b>${s(Z[d.autonomy].name)}</b><span>${d.autonomy==="read_only"?"drafts only":`${s(H(d.executedThisMonthUsdMinor,{cents:!1}))} of ${s(H(d.limits.monthlyUsdMinor,{cents:!1}))}`}</span>${d.autonomy==="read_only"?"":`<span class="chip-meter ${$>=90?"hot":""}"><i style="width:${$.toFixed(1)}%"></i></span>`}</a>`;let x=c?`<section class="card onboard reveal"><div class="onboard-head"><h2>Set up your AI CFO</h2><p class="muted">Three steps and your AI CFO has the full picture. It reads; code enforces your rules; you approve what moves.</p></div>
      <ol class="steps">
        <li><a href="/app/connections"><span class="step-n">1</span><span class="step-ic">${u("wallet",20)}</span><b>Connect your agent wallet and accounts</b><span>Your agent wallet (recovery phrase) pays on Cardano; add your CashXChain sandbox account (API key) for fiat.</span><em>Connect${u("arrowRight",14,2.2)}</em></a></li>
        <li><a href="/app/documents"><span class="step-n">2</span><span class="step-ic">${u("upload",20)}</span><b>Upload financial documents</b><span>Invoices, receipts, bank statements, contracts. PDFs, photos, CSV.</span><em>Upload${u("arrowRight",14,2.2)}</em></a></li>
        <li><a href="/app/agent"><span class="step-n">3</span><span class="step-ic">${u("shield",20)}</span><b>Decide what the agent may do</b><span>Start read-only. Move to guarded with limits when you are ready.</span><em>Review${u("arrowRight",14,2.2)}</em></a></li>
      </ol></section>`:"",L=o.cash.connections.length;l.innerHTML=`${x}
  <section class="today reveal" aria-label="Today">
    <a class="today-item" href="/app/connections"><span class="label">${u("wallet",14)}Cash position</span><b>${s(H(o.cash.totalUsdMinor,{cents:!1}))}</b><span class="sub">${L?`across ${L} connection${L===1?"":"s"} \xB7 indicative USD`:"No connections yet"}</span></a>
    <a class="today-item ${o.approvals.count?"attn":""}" href="/app/payments" id="today-appr"><span class="label">${u("shieldCheck",14)}To approve</span><b>${o.approvals.count}</b><span class="sub">${o.approvals.count?`${s(H(f,{cents:!1}))} waiting for you`:"You're all caught up"}</span></a>
    <a class="today-item" href="/app/documents"><span class="label">${u("calendar",14)}Payables open</span><b>${s(H(o.payables.totalUsdMinor,{cents:!1}))}</b><span class="sub">${o.payables.count?`${o.payables.count} unpaid${w?` \xB7 next ${s(R(w.dueDate))}`:""}`:"No open invoices"}</span></a>
  </section>

  <section class="ov-grid">
    <div class="card chart-card cash-card reveal" style="--d:80ms">
      <div class="card-head"><div><h2>Cash</h2><p class="muted small" id="cash-sub"></p></div>
        <div class="tabs" role="tablist" aria-label="Cash views">
          <button type="button" role="tab" data-tab="fc" aria-selected="true" aria-controls="tab-fc">Forecast</button>
          <button type="button" role="tab" data-tab="io" aria-selected="false" aria-controls="tab-io" tabindex="-1">In &amp; out</button>
          <button type="button" role="tab" data-tab="cat" aria-selected="false" aria-controls="tab-cat" tabindex="-1">By category</button>
        </div></div>
      <div class="tab-panel" id="tab-fc" role="tabpanel">
        ${i?'<div class="fc-legend"><span class="lg-in">Inflow</span><span class="lg-out">Outflow</span></div>':""}
        <div class="chart-wrap"><div class="chart" id="fc-chart"></div></div>
        ${i&&i.events.length?`<ul class="events">${i.events.slice(0,4).map(C=>`<li>${C.documentId?`<a href="/app/documents/${s(C.documentId)}">`:"<span>"}<em class="${C.usdMinor<0?"out":"in"}"></em><span class="ev-d">${s(R(C.date))}</span><span class="ev-l">${s(C.label)}</span><b>${s(H(C.usdMinor,{sign:!0,cents:!1}))}</b>${C.documentId?"</a>":"</span>"}</li>`).join("")}</ul>`:""}
      </div>
      <div class="tab-panel" id="tab-io" role="tabpanel" hidden>
        <div class="fc-legend"><span class="lg-bin">In</span><span class="lg-bout">Out</span></div>
        <div class="chart" id="io-chart"></div>
      </div>
      <div class="tab-panel" id="tab-cat" role="tabpanel" hidden>
        ${o.spendByCategory.length?ta(o.spendByCategory):j({icon:"budget",title:"No spending this month",text:"Upload receipts and statements and the agent categorises them for you."})}
        <a class="link-sm cat-more" href="/app/budgets">Budgets &amp; categories${u("chevron",14)}</a>
      </div>
    </div>
    <div class="card attn-card reveal" style="--d:120ms">
      <div class="card-head"><h2>Needs your attention</h2><a class="link-sm" href="/app/payments">All payments${u("chevron",14)}</a></div>
      <div id="ov-attn">${y?"":Ya}
        ${o.approvals.payments.length?`<div class="attn-group" id="attn-appr"><div class="attn-label">To approve</div><ul class="ap-list" id="ov-appr">${o.approvals.payments.slice(0,4).map(Es).join("")}</ul></div>`:""}
        ${p.length?`<div class="attn-group"><div class="attn-label">Due in the next ${Pt} days</div><ul class="due-list">${p.slice(0,4).map(Ls).join("")}</ul></div>`:""}
      </div>
    </div>
  </section>

  <section class="ov-grid even">
    <div class="card reveal">
      <div class="card-head"><h2>Budgets</h2><a class="link-sm" href="/app/budgets">Plan${u("chevron",14)}</a></div>
      ${o.budgets.length?`<ul class="bud-list">${o.budgets.slice(0,4).map(Ms).join("")}</ul>`:j({icon:"budget",title:"No budgets yet",text:"Set monthly limits per category. The agent warns you before you go over.",action:`<a class="btn ghost sm" href="/app/budgets">${u("plus",15,2.4)}Create a budget</a>`})}
    </div>
    <div class="card reveal">
      <div class="card-head"><h2>Cash by connection</h2><a class="link-sm" href="/app/connections">Manage${u("chevron",14)}</a></div>
      ${L?`<ul class="conn-mini">${o.cash.connections.map(C=>`<li><span class="cm-ic">${u("wallet",16)}</span><div><b>${s(C.label)}</b><span title="${s(C.balances.map(He).join(" \xB7 "))}">${C.balances.map(v=>s(He(v))).join(" \xB7 ")||"No balance"}</span></div><b class="num">${s(H(C.usdMinor,{cents:!1}))}</b></li>`).join("")}</ul>`:j({icon:"link",title:"Connect your first wallet",text:"Your AI CFO needs at least one connection to see your cash.",action:`<a class="btn primary sm" href="/app/connections">${u("plus",15,2.4)}Add connection</a>`})}
    </div>
  </section>
  ${o.documents.processing?`<p class="fine center">${u("clock",13)} ${o.documents.processing} document${o.documents.processing===1?" is":"s are"} still being read. Figures update when ${o.documents.processing===1?"it is":"they are"} done.</p>`:""}`;let M=m?m.inUsdMinor-m.outUsdMinor:0,E={fc:`Next ${i?.days??90} days from balances and open invoices`,io:`Last 6 months, indicative USD${m?` \xB7 ${s(le(m.month,!0))} net <b class="${M<0?"neg":"pos"}">${s(H(M,{sign:!0,cents:!1}))}</b>`:""}`,cat:`This month \xB7 ${s(H(h,{cents:!1}))} out`},A=e.querySelector("#cash-sub"),T=new Set,q=C=>{if(!T.has(C))if(T.add(C),C==="fc"){let v=e.querySelector("#fc-chart");if(i){let g=Xe(i);t.onCleanup(Ne(v,g.draw,g.wire))}else v.innerHTML='<div class="chart-empty">Forecast unavailable right now.</div>'}else C==="io"&&t.onCleanup(Ne(e.querySelector("#io-chart"),ea(o.monthly)))},S=[...e.querySelectorAll(".cash-card [role=tab]")],b=(C,v=!1)=>{for(let g of S){let U=g.dataset.tab===C;g.setAttribute("aria-selected",String(U)),g.tabIndex=U?0:-1,e.querySelector(`#tab-${g.dataset.tab}`).hidden=!U,U&&v&&g.focus()}A.innerHTML=E[C]??"",q(C)};for(let C of S)C.addEventListener("click",()=>b(C.dataset.tab)),C.addEventListener("keydown",v=>{if(v.key!=="ArrowRight"&&v.key!=="ArrowLeft")return;v.preventDefault();let g=S.indexOf(C)+(v.key==="ArrowRight"?1:-1);b(S[(g+S.length)%S.length].dataset.tab,!0)});b("fc");let k=e.querySelector("#ov-appr"),F=o.approvals.count;k?.addEventListener("click",async C=>{let v=C.target.closest("[data-act]");if(!v)return;let g=v.closest(".ap");for(let U of g.querySelectorAll("button"))U.disabled=!0;v.classList.add("loading");try{await St(v.dataset.pid,v.dataset.act),F=Math.max(0,F-1),y=Math.max(0,y-1),e.querySelector("#ov-needs").textContent=za(y);let U=e.querySelector("#today-appr");U&&(U.querySelector("b").textContent=String(F),F||(U.classList.remove("attn"),U.querySelector(".sub").textContent="You're all caught up")),g.classList.add("leaving"),window.setTimeout(()=>{if(g.remove(),k.querySelector(".ap"))return;if(F){k.innerHTML=`<li class="list-empty"><a class="link-sm" href="/app/payments">${F} more waiting${u("chevron",14)}</a></li>`;return}e.querySelector("#attn-appr")?.remove();let Y=e.querySelector("#ov-attn");Y.querySelector(".attn-group")||(Y.innerHTML=Ya)},280)}catch{for(let U of g.querySelectorAll("button"))U.disabled=!1;v.classList.remove("loading")}})}function As(e){let t=[];return e.cardanoAddress&&t.push('<span class="rail-tag ada">Cardano</span>'),e.iban&&t.push('<span class="rail-tag">IBAN</span>'),e.accountNumber&&t.push('<span class="rail-tag">US account</span>'),t.join("")||'<span class="muted small">No payout details</span>'}async function Xa(e){let t=null,a=e;return await X({title:a?`Edit ${a.name}`:"Add payee",submit:a?"Save payee":"Add payee",wide:!0,body:`<div class="grid2">
        <div class="field"><label for="p-name">Name</label><input id="p-name" name="name" value="${s(a?.name??"")}" placeholder="Acme GmbH" autocomplete="off"></div>
        <div class="field"><label for="p-country">Country <span class="opt-l">ISO code</span></label><input id="p-country" name="country" maxlength="2" value="${s(a?.country??"")}" placeholder="DE"></div>
      </div>
      <fieldset class="fs"><legend>SEPA / international</legend>
        <div class="grid2 r21">
          <div class="field"><label for="p-iban">IBAN</label><input id="p-iban" name="iban" class="mono" value="${s(a?.iban??"")}" placeholder="DE89 3704 0044 0532 0130 00" autocomplete="off"></div>
          <div class="field"><label for="p-bic">BIC</label><input id="p-bic" name="bic" class="mono" value="${s(a?.bic??"")}" placeholder="COBADEFFXXX" autocomplete="off"></div>
        </div>
      </fieldset>
      <fieldset class="fs"><legend>US bank account</legend>
        <div class="grid3">
          <div class="field"><label for="p-routing">Routing number</label><input id="p-routing" name="routingNumber" class="mono" inputmode="numeric" value="${s(a?.routingNumber??"")}" placeholder="021000021"></div>
          <div class="field"><label for="p-acct">Account number</label><input id="p-acct" name="accountNumber" class="mono" inputmode="numeric" value="${s(a?.accountNumber??"")}" placeholder="000123456789"></div>
          <div class="field"><label for="p-type">Type</label><select id="p-type" name="accountType"><option value="">\u2014</option><option value="checking"${a?.accountType==="checking"?" selected":""}>Checking</option><option value="savings"${a?.accountType==="savings"?" selected":""}>Savings</option></select></div>
        </div>
      </fieldset>
      <fieldset class="fs"><legend>Cardano Preprod (testnet)</legend>
        <div class="field"><label for="p-ada">Address</label><input id="p-ada" name="cardanoAddress" class="mono" value="${s(a?.cardanoAddress??"")}" placeholder="addr_test1\u2026" autocomplete="off"></div>
      </fieldset>`,onSubmit:async n=>{let r=B(n,"name");if(!r)return I(n,"name","Enter the payee's name.");let o=B(n,"country").toUpperCase();if(o&&!/^[A-Z]{2}$/.test(o))return I(n,"country","Use a two-letter country code, e.g. DE or US.");let i=B(n,"iban").replace(/\s+/g,"").toUpperCase();if(i&&!/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(i))return I(n,"iban","This does not look like an IBAN.");let l=B(n,"bic").toUpperCase();if(l&&!/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(l))return I(n,"bic","BIC has 8 or 11 characters.");let c=B(n,"routingNumber");if(c&&!/^\d{9}$/.test(c))return I(n,"routingNumber","Routing numbers have 9 digits.");let d=B(n,"accountNumber");if(d&&!/^\d{4,17}$/.test(d))return I(n,"accountNumber","Use 4 to 17 digits.");let m=B(n,"cardanoAddress");if(m&&!/^addr_test1[0-9a-z]{20,}$/.test(m))return I(n,"cardanoAddress","Use a Cardano Preprod address (addr_test1\u2026).");let h=B(n,"accountType"),f={name:r},p=(y,w)=>{w?f[y]=w:a&&a[y]&&(f[y]="")};return p("country",o),p("iban",i),p("bic",l),p("routingNumber",c),p("accountNumber",d),p("accountType",h),p("cardanoAddress",m),t=a?await ee(`/api/v1/payees/${encodeURIComponent(a.id)}`,f):await O("/api/v1/payees",f),P(a?"Payee saved":`${r} added to your payees`,"ok"),!0}}),t}async function Ga(e,t){let a=[],n="",r=_.me?.workspace.limits.knownPayeesOnly??!0;e.innerHTML=`${K("Payees","Who your business pays, and where.",`<button class="btn primary sm" type="button" id="p-new">${u("plus",16,2.4)}Add payee</button>`)}
    <div class="callout info">${u("shieldCheck",16)}<span><b>The agent only pays payees in this directory.</b> In guarded mode${r?"":" (when \u201Cknown payees only\u201D is on)"}, any payment to someone not listed here is stopped and waits for your approval. Adding a payee is always a human decision. <a href="/app/agent">Agent access settings</a></span></div>
    <section class="card list-card">
      <div class="list-head"><span class="count" id="p-count"></span><label class="search">${u("search",16)}<input id="p-q" placeholder="Search payees" aria-label="Search payees"></label></div>
      <div id="p-list"><div class="pad">${V(5)}</div></div>
    </section>`;let o=e.querySelector("#p-list"),i=()=>{e.querySelector("#p-count").textContent=`${a.length} payee${a.length===1?"":"s"}`;let l=n.toLowerCase(),c=a.filter(d=>!l||[d.name,d.iban,d.cardanoAddress,d.country].some(m=>m?.toLowerCase().includes(l)));if(!a.length){o.innerHTML=j({icon:"payees",title:"No payees yet",text:"Add the suppliers, contractors and employees you pay. In guarded mode the agent can only pay people listed here.",action:`<button class="btn primary sm" type="button" data-new>${u("plus",15,2.4)}Add your first payee</button>`});return}if(!c.length){o.innerHTML=j({icon:"search",title:"No matches",text:"Try another name, IBAN or address."});return}o.innerHTML=`<ul class="payee-list">${c.map(d=>`<li>
        ${ne(d.name)}
        <div class="pe-who"><b>${s(d.name)}</b><span>${d.country?`${s(d.country)} \xB7 `:""}added ${s(R(d.createdAt))}</span></div>
        <div class="pe-details">
          ${d.iban?`<span class="mono">${s(d.iban.replace(/(.{4})/g,"$1 ").trim())}${d.bic?` \xB7 ${s(d.bic)}`:""}</span>`:""}
          ${d.accountNumber?`<span class="mono">ACH ${s(d.routingNumber??"")} \xB7 \u2022\u2022${s(d.accountNumber.slice(-4))}${d.accountType?` \xB7 ${s(d.accountType)}`:""}</span>`:""}
          ${d.cardanoAddress?`<span class="mono addr">${s(me(d.cardanoAddress))}<button type="button" class="icon-btn xs" data-copy="${s(d.cardanoAddress)}" aria-label="Copy address">${u("copy",13)}</button></span>`:""}
          ${!d.iban&&!d.accountNumber&&!d.cardanoAddress?'<span class="muted small">No payout details yet</span>':""}
        </div>
        <div class="pe-rails">${As(d)}</div>
        <div class="pe-act"><button class="icon-btn" type="button" data-edit="${s(d.id)}" aria-label="Edit ${s(d.name)}">${u("edit",16)}</button><button class="icon-btn danger-h" type="button" data-del="${s(d.id)}" aria-label="Delete ${s(d.name)}">${u("trash",16)}</button></div>
      </li>`).join("")}</ul>`};e.querySelector("#p-q").addEventListener("input",l=>{n=l.target.value.trim(),i()}),e.addEventListener("click",async l=>{let c=l.target,d=c.closest("[data-copy]");if(d)return void ge(d.dataset.copy);if(c.closest("#p-new, [data-new]")){let f=await Xa(null);f&&t.alive()&&(a.unshift(f),i());return}let m=c.closest("[data-edit]");if(m){let f=a.find(y=>y.id===m.dataset.edit),p=f&&await Xa(f);p&&t.alive()&&(a=a.map(y=>y.id===p.id?p:y),i());return}let h=c.closest("[data-del]");if(h){let f=a.find(p=>p.id===h.dataset.del);if(!f||!await Q(`Remove ${f.name}?`,"The agent will no longer be able to pay this payee without your approval. Past payments stay in the audit log.","Remove payee",!0))return;try{await te(`/api/v1/payees/${encodeURIComponent(f.id)}`),a=a.filter(p=>p.id!==f.id),i(),P("Payee removed","ok")}catch{}}}),a=await D("/api/v1/payees"),t.alive()&&(a.sort((l,c)=>l.name.localeCompare(c.name)),i())}var Qa=20,en="Keys can't approve or sign payments, or change payees, budgets, connections or agent rights. Those always need a person signed in to this dashboard.",Dt=[{id:"payment.created",icon:"plus",text:"A new payment is created"},{id:"payment.updated",icon:"refresh",text:"A payment changes, such as its status"}],Ts=e=>{try{return new URL(e).host}catch{return e}},tn=e=>e.includes("write")?"Read & write":"Read only",Va=(e,t)=>`<div class="addr-row"><span class="mono" title="${s(e)}">${s(e)}</span><button type="button" class="icon-btn xs" data-copy="${s(e)}" aria-label="${s(t)}">${u("copy",13)}</button></div>`;function an(){let e=location.origin;return`<section class="dev" id="developers" aria-labelledby="dev-h">
    <div class="section-h"><h2 id="dev-h">Developers</h2><p class="muted">Connect your own software to this account with the REST API, webhooks or MCP. <a href="/developers.html" target="_blank" rel="noopener">Read the API docs</a></p></div>
    <div class="settings">
      <section class="card dev-wide" id="dev-keys">
        <div class="card-head"><div><h2>API keys</h2><p class="muted small">For your own software and scripts. A key acts for this account; it is shown once, when you create it.</p></div><button type="button" class="btn primary sm" data-key-new>${u("plus",16,2.4)}Create key</button></div>
        <div class="callout">${u("shieldCheck",16)}<span>${s(en)}</span></div>
        <div data-key-list><div class="pad">${V(2)}</div></div>
      </section>
      <section class="card dev-wide" id="dev-hooks" hidden>
        <div class="card-head"><div><h2>Webhooks</h2><p class="muted small">PayLorya AI notifies your endpoint when a payment is created or changes.</p></div><button type="button" class="btn primary sm" data-hook-new>${u("plus",16,2.4)}Add endpoint</button></div>
        <div data-hook-list><div class="pad">${V(1)}</div></div>
      </section>
      <section class="card">
        <div class="card-head"><div><h2>REST API</h2><p class="muted small">Send a key with each request as <span class="mono">Authorization: Bearer ply_sk_\u2026</span></p></div></div>
        ${Va(`${e}/api/v1`,"Copy API base URL")}
        <p class="fine">${Qa} active keys per account, 120 requests per minute per key. An <span class="mono">Idempotency-Key</span> header makes a retried write safe.</p>
        <div class="form-foot"><span></span><a class="btn ghost sm" href="/developers.html" target="_blank" rel="noopener">${u("external",15)}API docs</a></div>
      </section>
      <section class="card">
        <div class="card-head"><div><h2>MCP</h2><p class="muted small">For AI assistants and agents that speak the Model Context Protocol.</p></div></div>
        ${Va(`${e}/mcp`,"Copy MCP endpoint")}
        <p class="fine">Point your MCP client at this endpoint. The API docs explain how to connect.</p>
        <div class="form-foot"><span></span><a class="btn ghost sm" href="/developers.html" target="_blank" rel="noopener">${u("external",15)}API docs</a></div>
      </section>
    </div>
  </section>`}function Ss(e){let t=!!e.revokedAt,a=t?`Revoked ${R(e.revokedAt)}`:`Created ${R(e.createdAt)} \xB7 ${e.lastUsedAt?`last used ${xe(e.lastUsedAt)}`:"never used"}`;return`<li class="${t?"revoked":""}">
    <span class="cm-ic">${u("key",17)}</span>
    <div class="pe-who"><b>${s(e.name)}</b><span>${s(tn(e.scopes))}</span></div>
    <div class="pe-details"><span class="mono">${s(e.prefix)}</span><span class="small">${s(a)}</span></div>
    <div class="pe-rails">${t?'<span class="pill t-neutral">Revoked</span>':""}</div>
    <div class="pe-act">${t?"":`<button class="icon-btn danger-h" type="button" data-revoke="${s(e.id)}" aria-label="Revoke ${s(e.name)}" title="Revoke">${u("trash",16)}</button>`}</div>
  </li>`}function Hs(e){return`<li>
    <span class="cm-ic">${u("webhook",17)}</span>
    <div class="pe-who"><b title="${s(e.url)}">${s(e.url)}</b><span>Added ${s(R(e.createdAt))}</span></div>
    <div class="pe-details">${(e.events??[]).map(t=>`<span class="mono">${s(t)}</span>`).join("")}</div>
    <div class="pe-rails"></div>
    <div class="pe-act"><button class="btn ghost xs" type="button" data-hook-test="${s(e.id)}">${u("send",14)}Send test</button><button class="icon-btn danger-h" type="button" data-hook-del="${s(e.id)}" aria-label="Delete ${s(e.url)}" title="Delete">${u("trash",16)}</button></div>
  </li>`}function Ja(e,t){let a=e instanceof J?e.message:"Could not load this list.";return`<div class="callout bad sm">${u("alert",14)}<span>${s(a)} <button type="button" class="link-sm" data-retry="${t}">Try again</button></span></div>`}function Za(e){return X({title:e.title,body:`<div class="callout warn">${u("alert",16)}<span><b>You will not see this ${e.what} again.</b> Copy it now and keep it somewhere safe, such as a password manager or your server's secret store.</span></div>
      <div class="field"><span class="lbl" id="once-l">${s(e.label)}</span><div class="secret-row"><code class="secret" id="once-v" aria-labelledby="once-l">${s(e.value)}</code><button type="button" class="btn primary sm" data-copy-once>${u("copy",15)}Copy</button></div></div>
      <p class="fine">${e.note}</p>`,onOpen:t=>{let a=t.querySelector("[data-copy-once]");a.addEventListener("click",()=>{ge(e.value)}),a.focus()}})}async function Ps(){let e=null;return await X({title:"Create API key",submit:"Create key",body:`<div class="field"><label for="k-name">Name</label><input id="k-name" name="name" maxlength="80" placeholder="ERP sync" autocomplete="off"><span class="fine">Say what uses it, so you know later which key to revoke.</span></div>
      <div class="field"><span class="lbl">Access</span>
        <div class="radio-cards">
          <label><input type="radio" name="scope" value="read" checked><span>${u("eye",16)}<b>Read only</b><em>See payments, documents, payees and balances</em></span></label>
          <label><input type="radio" name="scope" value="write"><span>${u("edit",16)}<b>Read &amp; write</b><em>Also draft payments, upload documents and chat</em></span></label>
        </div>
      </div>
      <div class="callout">${u("shieldCheck",16)}<span>${s(en)}</span></div>`,onSubmit:async t=>{let a=B(t,"name");if(!a)return I(t,"name","Enter a name for this key.");let n=B(t,"scope")==="write"?["read","write"]:["read"];return e=await O("/api/v1/api-keys",{name:a,scopes:n}),!0}}),e}async function Ds(){let e=null;return await X({title:"Add webhook endpoint",submit:"Add endpoint",body:`<div class="field"><label for="h-url">Endpoint URL</label><input id="h-url" name="url" type="url" class="mono" placeholder="https://example.com/webhooks/paylorya" autocomplete="off" spellcheck="false"></div>
      <div class="field"><span class="lbl">Events</span>
        <div class="radio-cards">${Dt.map(t=>`<label><input type="checkbox" name="ev-${t.id}" value="${t.id}" checked><span>${u(t.icon,16)}<b class="mono">${t.id}</b><em>${s(t.text)}</em></span></label>`).join("")}</div>
      </div>`,onSubmit:async t=>{let a=B(t,"url"),n;try{n=new URL(a)}catch{n=void 0}if(!a)return I(t,"url","Enter the URL to send events to.");if(!n||!/^https?:$/.test(n.protocol))return I(t,"url","Use a full URL, starting with https://");let r=Dt.map(o=>o.id).filter(o=>t.elements.namedItem(`ev-${o}`)?.checked);return r.length?(e=await O("/api/v1/webhooks",{url:a,events:r}),!0):I(t,`ev-${Dt[0].id}`,"Choose at least one event.")}}),e}function nn(e,t){let a=e.querySelector("[data-key-list]"),n=e.querySelector("#dev-hooks"),r=e.querySelector("[data-hook-list]"),o=[],i=[],l=!1,c=()=>{let f=o.filter(x=>!x.revokedAt),p=o.filter(x=>x.revokedAt),y=l?[...f,...p]:f,w=y.length?`<ul class="payee-list">${y.map(Ss).join("")}</ul>`:j({icon:"key",title:"No API keys yet",text:"Create a key to let your own software read this account or draft payments.",action:`<button class="btn primary sm" type="button" data-key-new>${u("plus",15,2.4)}Create your first key</button>`}),$=o.length?`<div class="form-foot"><span class="muted small">${f.length} of ${Qa} active keys</span>${p.length?`<button type="button" class="link-sm" data-toggle-revoked>${l?"Hide revoked keys":`Show revoked keys (${p.length})`}</button>`:""}</div>`:"";a.innerHTML=w+$},d=()=>{r.innerHTML=i.length?`<ul class="payee-list">${i.map(Hs).join("")}</ul>`:j({icon:"webhook",title:"No endpoints yet",text:"Add a URL to hear about payments as they happen, instead of polling the API."})},m=async()=>{try{o=await D("/api/v1/api-keys",!0),t.alive()&&c()}catch(f){t.alive()&&(a.innerHTML=Ja(f,"keys"))}},h=async()=>{try{let f=await D("/api/v1/webhooks",!0);if(!t.alive())return;i=Array.isArray(f)?f:[],n.hidden=!1,d()}catch(f){if(!t.alive())return;if(f instanceof J&&f.status===404){n.hidden=!0;return}n.hidden=!1,r.innerHTML=Ja(f,"hooks")}};e.addEventListener("click",async f=>{let p=f.target,y=p.closest("[data-copy]");if(y)return void ge(y.dataset.copy);let w=p.closest("[data-retry]");if(w)return void(w.dataset.retry==="keys"?m():h());if(p.closest("[data-toggle-revoked]"))return l=!l,c();if(p.closest("[data-key-new]")){let M=await Ps();if(!M)return;let{key:E,...A}=M;t.alive()&&(o=[A,...o],c()),await Za({title:"Your new API key",what:"key",label:`${M.name} \xB7 ${tn(M.scopes)}`,value:E,note:`Send it with each request as <span class="mono">Authorization: Bearer ${s(M.prefix)}</span>. If it leaks, revoke it here: it stops working at once.`});return}let $=p.closest("[data-revoke]");if($){let M=o.find(E=>E.id===$.dataset.revoke);if(!M||!await Q(`Revoke ${M.name}?`,"Anything that uses this key stops working at once: its requests are refused. This cannot be undone.","Revoke key",!0))return;try{if(await te(`/api/v1/api-keys/${encodeURIComponent(M.id)}`),P("API key revoked","ok"),!t.alive())return;o=o.map(E=>E.id===M.id?{...E,revokedAt:new Date().toISOString()}:E),c(),m()}catch{}return}if(p.closest("[data-hook-new]")){let M=await Ds();if(!M)return;let{secret:E,...A}=M;t.alive()&&(i=[...i,A],d()),await Za({title:"Your webhook signing secret",what:"secret",label:`Signing secret for ${M.url}`,value:E,note:"Use it to verify that a delivery comes from PayLorya AI. The API docs explain how."});return}let x=p.closest("[data-hook-test]");if(x){let M=i.find(E=>E.id===x.dataset.hookTest);if(!M||x.disabled)return;x.disabled=!0,x.classList.add("loading");try{let E=await O(`/api/v1/webhooks/${encodeURIComponent(M.id)}/test`);E&&E.ok===!1?P(E.error||"Your endpoint did not accept the test event.","error"):P(`Test event sent to ${Ts(M.url)}`,"ok")}catch{}finally{x.disabled=!1,x.classList.remove("loading")}return}let L=p.closest("[data-hook-del]");if(L){let M=i.find(E=>E.id===L.dataset.hookDel);if(!M||!await Q("Delete this endpoint?",`PayLorya AI stops sending events to ${M.url}.`,"Delete endpoint",!0))return;try{if(await te(`/api/v1/webhooks/${encodeURIComponent(M.id)}`),P("Webhook endpoint deleted","ok"),!t.alive())return;i=i.filter(E=>E.id!==M.id),d()}catch{}}}),m(),h(),location.hash==="#developers"&&e.scrollIntoView({block:"start"})}async function Ut(e,t){e.innerHTML=`${K("Settings","Workspace and account.")}<div class="settings">${[1,2].map(()=>`<div class="card">${N("30%",18)}<div style="height:18px"></div>${N("100%",44,12)}</div>`).join("")}</div>`;let a=await D("/api/v1/me");if(!t.alive())return;_.me=a;let n=a.workspace;e.innerHTML=`${K("Settings","Workspace and account.")}
  <div class="settings">
    <form class="card" id="ws-form" novalidate>
      <div class="card-head"><h2>Workspace</h2></div>
      <div class="field"><label for="s-name">Workspace name</label><input id="s-name" name="name" value="${s(n.name)}" autocomplete="organization"></div>
      <dl class="kv">
        <dt>Base currency</dt><dd>${s(n.baseCurrency)}</dd>
        <dt>Agent autonomy</dt><dd><span class="pill ${Z[n.autonomy].tone}">${Z[n.autonomy].name}</span> <a class="link-sm" href="/app/agent">Change${u("chevron",13)}</a></dd>
        <dt>Created</dt><dd>${s(R(n.createdAt,!0))}</dd>
        <dt>Workspace ID</dt><dd class="mono">${s(n.id)}</dd>
      </dl>
      <div class="form-foot"><span></span><button class="btn primary sm" type="submit" id="s-save" disabled>Save</button></div>
    </form>
    <section class="card">
      <div class="card-head"><h2>Account</h2></div>
      <div class="acct">${ne(a.user.name||a.user.email,"lg")}<div class="acct-text"><b>${s(a.user.name||"\u2014")}</b><span>${s(a.user.email)}</span></div></div>
      <dl class="kv acct-kv"><dt>User ID</dt><dd class="mono">${s(a.user.id)}</dd></dl>
      <div class="form-foot"><span></span><button class="btn ghost sm" type="button" id="s-out">${u("logout",16)}Sign out</button></div>
    </section>
    ${Us(a)}
    <section class="card">
      <div class="card-head"><h2>Appearance</h2></div>
      <div class="seg wide" role="radiogroup" aria-label="Theme" id="s-theme">
        <button type="button" role="radio" data-t="light" aria-checked="${Te()==="light"}">${u("sun",15)}Light</button>
        <button type="button" role="radio" data-t="dark" aria-checked="${Te()==="dark"}">${u("moon",15)}Dark</button>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h2>Environment</h2></div>
      <p class="muted small">Payments in this workspace run on <b>Cardano Preprod</b> (testnet, tADA with no real value) and the <b>CashXChain sandbox</b> fiat rail (a test ledger). USD totals use indicative FX rates.</p>
    </section>
  </div>
  ${an()}`;let r=e.querySelector("#ws-form"),o=e.querySelector("#s-save");r.addEventListener("input",()=>o.disabled=B(r,"name")===(_.me?.workspace.name??n.name)),r.addEventListener("submit",async i=>{i.preventDefault();let l=B(r,"name");if(!l)return void I(r,"name","Enter a workspace name.");o.disabled=!0,o.classList.add("loading");try{let c=await ee("/api/v1/workspace",{name:l});_.me&&(_.me={..._.me,workspace:c}),ie(),P("Workspace renamed","ok")}catch{o.disabled=!1}finally{o.classList.remove("loading")}}),e.querySelector("#s-out").addEventListener("click",()=>{Ke()}),Is(e,t),nn(e.querySelector("#developers"),t),e.querySelector("#s-theme").addEventListener("click",i=>{let l=i.target.closest("[data-t]");if(l){lt(l.dataset.t);for(let c of e.querySelectorAll("[data-t]"))c.setAttribute("aria-checked",String(c===l))}})}function Us(e){let t=e.signIn?.password??!1,a=t?e.signIn?.codes?"You can sign in with your password or with a code sent to your email.":"You sign in with your password.":"You sign in with a code sent to your email. Add a password only if you also want to sign in with one.";return`<form class="card" id="pw-form" novalidate data-has="${t}">
      <div class="card-head"><h2>Password</h2></div>
      <p class="muted small">${s(a)}</p>
      ${t?'<div class="field"><label for="s-pw-cur">Current password</label><input id="s-pw-cur" name="currentPassword" type="password" autocomplete="current-password"></div>':""}
      <div class="field"><label for="s-pw-new">${t?"New password":"Password"}</label><input id="s-pw-new" name="password" type="password" autocomplete="new-password" minlength="8"></div>
      <div class="form-foot"><span class="muted small">At least 8 characters.</span><button class="btn primary sm" type="submit" id="s-pw-save">${t?"Change password":"Add password"}</button></div>
    </form>`}function Is(e,t){let a=e.querySelector("#pw-form");if(!a)return;let n=a.dataset.has==="true",r=a.querySelector("#s-pw-save");a.addEventListener("submit",async o=>{o.preventDefault();let i=a.elements.namedItem("password").value,l=n?a.elements.namedItem("currentPassword").value:"";if(n&&!l)return void I(a,"currentPassword","Enter your current password.");if(i.length<8)return void I(a,"password","Use at least 8 characters.");r.disabled=!0,r.classList.add("loading");try{await O("/api/v1/me/password",n?{password:i,currentPassword:l}:{password:i}),P(n?"Password changed":"Password added. You can now also sign in with it.","ok"),t.alive()&&await Ut(e,t)}catch{r.disabled=!1}finally{r.classList.remove("loading")}})}var Bs=[{re:/^\/app\/?$/,title:"Overview",nav:"overview",render:Ka},{re:/^\/app\/chat(?:\/([^/]+))?\/?$/,title:"Chat",nav:"chat",render:oa,full:!0},{re:/^\/app\/documents\/([^/]+)\/?$/,title:"Document",nav:"documents",render:Oa},{re:/^\/app\/documents\/?$/,title:"Documents",nav:"documents",render:ja},{re:/^\/app\/payments\/?$/,title:"Payments",nav:"payments",render:Ra},{re:/^\/app\/budgets\/?$/,title:"Budgets & planning",nav:"budgets",render:na},{re:/^\/app\/payees\/?$/,title:"Payees",nav:"payees",render:Ga},{re:/^\/app\/connections\/?$/,title:"Connections",nav:"connections",render:Ua},{re:/^\/app\/agent\/?$/,title:"Agent access",nav:"agent",render:Zt},{re:/^\/app\/activity\/?$/,title:"Activity",nav:"activity",render:Yt},{re:/^\/app\/settings\/?$/,title:"Settings",nav:"settings",render:Ut}],Ns=[["overview","/app","home","Overview"],["chat","/app/chat","sparkle","AI CFO chat"],["documents","/app/documents","doc","Documents"],["payments","/app/payments","pay","Payments"],["budgets","/app/budgets","budget","Planning"],["payees","/app/payees","payees","Payees"],["connections","/app/connections","link","Connections"],["agent","/app/agent","shield","Agent & access"]],sn={agent:"agent",activity:"agent"},qs=[["agent","/app/agent","Agent"],["activity","/app/activity","Activity"]],on=(e="")=>`<button class="theme-toggle ${e}" type="button" data-theme-toggle aria-label="Toggle dark mode" aria-pressed="false">
    <svg class="sun" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
    <svg class="moon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>
  </button>`,rn='<a class="logo" href="/app"><span class="mark" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 64 64"><path d="M36.3 38.6C36.1 38.6 36.1 38.6 36.5 38.5C37.4 38.3 38.5 37.9 39.3 37.3C40.1 36.7 40.8 35.9 41.2 35.2C41.6 34.5 42 33.5 42.2 32.7C42.5 31.8 42.5 30.6 42.5 28.3C42.4 26.7 42.4 26.5 42.2 25.8C41.9 25.1 41.3 24.1 40.7 23.6C40.2 23.1 39.4 22.6 38.5 22.3C37.6 22 38.3 22 29.8 22C24.2 22 22.2 22 22.1 21.9C20.7 21.5 20 20.8 19.6 19.6C19.5 19.2 19.5 18.6 19.5 15.8C19.5 12.7 19.5 12.6 19.8 12.2C20.1 11.8 20.6 11.4 21.1 11.2C21.3 11.2 23.6 11.2 30 11.2C34.7 11.2 38.8 11.2 39.1 11.2C41.1 11.3 43.5 12.1 45.3 13.2C46.6 14 47.4 14.7 48.5 15.7C50.3 17.5 51.8 20 52.5 22.6C53 24.2 53.1 25.7 53 27.4C53 28.1 52.9 28.6 52.7 29.5C52.5 30.4 52 31.6 51.5 32.5C50.5 34.2 49 35.7 47.4 36.8C47 37 46 37.5 45.7 37.6C45.6 37.7 45.4 37.8 45.3 37.8C44.1 38.3 43 38.5 41.5 38.6C40.9 38.7 36.7 38.7 36.3 38.6Z" fill="#faf8f5"/><path d="M9.7 56.2C9.4 56.1 9.1 55.8 9 55.5C8.9 55.3 8.9 46.1 9 44.8C9 43.8 9.1 42.8 9.2 42.2C9.3 41.7 9.5 41 9.6 40.7C9.6 40.6 9.7 40.4 9.7 40.2C9.8 40 9.8 39.9 9.9 39.8C9.9 39.8 9.9 39.6 10 39.5C10 39.4 10.1 39.2 10.1 39.2C10.1 39.2 10.2 39 10.2 38.9C10.2 38.8 10.3 38.7 10.3 38.6C10.4 38.5 10.4 38.4 10.5 38.3C10.6 38.1 10.8 37.6 10.9 37.4C11.6 36.2 11.8 35.9 12.3 35.2C13.1 34 14.4 32.7 15.4 31.9C16.1 31.4 17 30.7 17.1 30.7C17.1 30.7 17.1 30.7 17.2 30.6C17.3 30.5 17.4 30.4 17.5 30.4C17.6 30.4 17.8 30.2 18 30.1C18.3 30 19.3 29.5 19.7 29.3C19.8 29.3 20 29.2 20.2 29.1C20.4 29 20.6 28.9 20.6 28.9C20.7 28.9 20.8 28.9 20.8 28.9C20.9 28.9 20.9 28.8 21 28.8C21.2 28.8 21.8 28.6 22.2 28.4C22.7 28.3 23.6 28.1 23.9 28.1C23.9 28.1 24.1 28.1 24.1 28.1C24.2 28.1 24.7 28 25.3 28C26.2 27.9 26.8 27.9 34.4 27.9L42.4 27.9L42.5 29C42.5 31.5 42.3 32.9 41.7 34.3C41.3 35 41.1 35.4 40.8 35.9C40.4 36.4 39.8 36.9 39.3 37.3C38.5 37.9 37.4 38.4 36.5 38.5C36.3 38.6 36.1 38.6 36.1 38.6C36 38.6 33.6 38.6 30.7 38.7C26.1 38.7 25.5 38.7 25.2 38.8C24.6 38.9 24.4 39 23.8 39.2C22.1 39.9 20.8 41.1 20.1 42.8C19.8 43.6 19.6 44.2 19.6 45C19.5 46.7 19.4 46.9 19.3 47.5C19.1 48.7 18.8 49.6 18.1 50.8C17.4 52 16.2 53.3 14.9 54.2C14.5 54.5 13.8 54.9 13.2 55.2C12 55.8 10.2 56.3 9.7 56.2Z" fill="#fd7b5d"/></svg></span>PayLorya<span class="tag">AI</span></a>';function Rs(){return`<div class="shell">
  <aside class="side" id="side" aria-label="Main navigation">
    <div class="side-top">${rn}<button class="icon-btn side-close" type="button" id="side-close" aria-label="Close menu">${u("x")}</button></div>
    <a class="ws" href="/app/agent" id="ws"><span class="ws-mark" id="ws-mark"></span><span class="ws-text"><b id="ws-name"><span class="sk" style="width:110px;height:12px"></span></b><span id="ws-auto" class="ws-auto"></span></span>${u("chevron",15)}</a>
    <nav class="side-nav">${Ns.map(([e,t,a,n])=>`<a href="${t}" data-nav="${e}">${u(a,18)}<span>${n}</span>${e==="payments"?'<em class="badge" id="badge-approvals" hidden></em>':""}</a>`).join("")}</nav>
    <div class="side-foot">
      <a href="/app/settings" data-nav="settings" class="side-settings">${u("settings",18)}<span>Settings</span></a>
      <div class="user-row">
        <button class="user-btn" type="button" id="user-btn" aria-haspopup="menu" aria-expanded="false"><span id="user-av">${ne("\u2026")}</span><span class="user-text"><b id="user-name">&nbsp;</b><span id="user-email">&nbsp;</span></span></button>
        ${on()}
        <div class="menu" id="user-menu" role="menu" hidden>
          <a href="/app/settings" role="menuitem">${u("settings",16)}Settings</a>
          <a href="/app/agent" role="menuitem">${u("shield",16)}Agent & access</a>
          <button type="button" role="menuitem" data-signout>${u("logout",16)}Sign out</button>
        </div>
      </div>
    </div>
  </aside>
  <div class="scrim" id="scrim"></div>
  <div class="main-wrap">
    <header class="topbar"><button class="icon-btn" type="button" id="menu-btn" aria-label="Open menu" aria-controls="side">${u("menu",20)}</button>${rn}<span class="topbar-right"><a class="icon-btn" href="/app/chat" aria-label="AI CFO chat">${u("sparkle",19)}</a>${on()}</span></header>
    <nav class="subnav" id="subnav" aria-label="Agent and access" hidden>
      <div class="tabs">${qs.map(([e,t,a])=>`<a href="${t}" data-sub="${e}">${a}</a>`).join("")}</div>
      <p class="sub-trust"><span>${u("eye",14,2)}Claude reads.</span><span>${u("shield",14,2)}Code decides.</span><span>${u("check",14,2.4)}You approve.</span></p>
    </nav>
    <main class="main" id="view" tabindex="-1"></main>
  </div>
</div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>`}function _s(e){let t=e.workspace;document.getElementById("ws-name").textContent=t.name,document.getElementById("ws-mark").textContent=(t.name.trim()[0]??"W").toUpperCase();let a=Z[t.autonomy],n=document.getElementById("ws-auto");n.className=`ws-auto a-${t.autonomy}`,n.innerHTML=`<i></i>Agent: ${a.name}`,document.getElementById("user-name").textContent=e.user.name||e.user.email,document.getElementById("user-email").textContent=e.user.email,document.getElementById("user-av").innerHTML=ne(e.user.name||e.user.email)}function js(){let e=document.getElementById("badge-approvals");e&&(e.hidden=_.approvals===0,e.textContent=String(_.approvals),e.title=`${_.approvals} payment${_.approvals===1?"":"s"} waiting for approval`)}var st=0,cn=[];function _e(){let e=location.pathname.replace(/\/+$/,"")||"/app",t=document.getElementById("view");for(let d of cn.splice(0))try{d()}catch{}let a=++st,n=null,r=Bs.find(d=>n=d.re.exec(e==="/app"?"/app":e));document.body.classList.toggle("full",!!r?.full);let o=r?sn[r.nav]??r.nav:"";for(let d of document.querySelectorAll("[data-nav]"))d.dataset.nav===o?d.setAttribute("aria-current","page"):d.removeAttribute("aria-current");let i=!!r&&r.nav in sn,l=document.getElementById("subnav");l.hidden=!i,l.dataset.on=i?r.nav:"",document.body.classList.toggle("has-sub",i);for(let d of document.querySelectorAll("[data-sub]"))i&&d.dataset.sub===r?.nav?d.setAttribute("aria-current","page"):d.removeAttribute("aria-current");if(ot(),t.classList.remove("enter"),t.offsetWidth,t.classList.add("enter"),!r){document.title="Not found \xB7 PayLorya AI",t.innerHTML='<div class="notfound"><h1>Page not found</h1><p class="muted">This page does not exist in your dashboard.</p><a class="btn primary sm" href="/app">Go to overview</a></div>';return}document.title=`${r.title} \xB7 PayLorya AI`;let c={params:n?.slice(1).map(d=>d?decodeURIComponent(d):"")??[],query:new URLSearchParams(location.search),alive:()=>a===st,onCleanup:d=>{a===st?cn.push(d):d()},reload:()=>{a===st&&_e()}};try{let d=r.render(t,c);d&&d.catch(m=>console.warn("[dashboard] page error",m))}catch(d){console.warn("[dashboard] page error",d)}}function ln(e,t={}){if(e===location.pathname+location.search&&!t.silent){_e();return}t.replace||t.silent?history.replaceState(null,"",e):history.pushState(null,"",e),!t.silent&&(window.scrollTo({top:0}),_e())}function Fs(){document.body.classList.add("drawer"),document.getElementById("menu-btn")?.setAttribute("aria-expanded","true")}function ot(){document.body.classList.remove("drawer"),document.getElementById("menu-btn")?.setAttribute("aria-expanded","false")}function Os(){document.addEventListener("click",e=>{let t=e.target,a=t.closest("a[href]"),n=document.getElementById("user-menu");if(!t.closest("#user-btn")&&!t.closest("#user-menu")&&(n.hidden=!0,document.getElementById("user-btn")?.setAttribute("aria-expanded","false")),t.closest("[data-signout]")){e.preventDefault(),Ke();return}if(!a||e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||a.target==="_blank"||a.hasAttribute("download"))return;let r=new URL(a.href,location.href);r.origin!==location.origin||!/^\/app(\/|$)/.test(r.pathname)||(e.preventDefault(),n.hidden=!0,ln(r.pathname+r.search))}),window.addEventListener("popstate",_e),document.getElementById("menu-btn").addEventListener("click",Fs),document.getElementById("side-close").addEventListener("click",ot),document.getElementById("scrim").addEventListener("click",ot),document.addEventListener("keydown",e=>{e.key==="Escape"&&(ot(),document.getElementById("user-menu").hidden=!0)}),document.getElementById("user-btn").addEventListener("click",()=>{let e=document.getElementById("user-menu");e.hidden=!e.hidden,document.getElementById("user-btn").setAttribute("aria-expanded",String(!e.hidden))})}async function Ws(){let e=document.getElementById("root")??document.body;e.innerHTML=Rs(),Nt(),Os(),Xt(ln),Vt(()=>{_.me&&_s(_.me),js()}),_e(),Be();try{_.me=await D("/api/v1/me"),ie()}catch{}}Ws();
