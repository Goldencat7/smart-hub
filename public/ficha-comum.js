// Motor compartilhado das fichas (estilo Hub) — usado por PJ, Vendedor, Locação c/ Fiador e Proposta.
// Cada ficha importa daqui e chama iniciarFicha(config). PF e Locador têm engine próprio inline.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import { getFirestore, doc, getDoc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js';
import './doc-preview.js'; // PDF anexado vira imagem de página no preview (window.__pdfInline)
import { firebaseConfig, conectarEmuladores } from './firebase-env.js'; // prod/staging/emulador por hostname

// Sinal pro ficha-watchdog.js: se este módulo executou, os imports (inclusive o
// SDK do Firebase, que vem de um CDN externo) resolveram — ou seja, o formulário
// VAI montar. Se um import travar na rede, este código nunca roda e a flag fica
// false; o vigia detecta isso e recarrega. Marca as 5 fichas que usam este engine.
window.__fichaPronta = true;

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);
conectarEmuladores({ db, storage }); // no-op fora de localhost

// A escrita da ficha passa sempre por Cloud Function (o Firestore nega write do
// cliente). Import dinâmico pra não carregar o SDK de functions em quem só lê.
async function chamarFn(nome, payload){
  const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js');
  const fns = getFunctions(app, 'southamerica-east1');
  await conectarEmuladores({ fns }); // em localhost aponta functions pro emulador
  return httpsCallable(fns, nome)(payload);
}

export const UF = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
export const CIVIL = ['Solteiro(a)','Casado(a)','Divorciado(a)','Viúvo(a)','União estável'];
export const REGIME = ['Comunhão parcial de bens','Comunhão universal de bens','Separação total de bens','Participação final nos aquestos'];
export const TIPOS = ['Apartamento','Casa','Cobertura','Studio','Sala comercial','Terreno','Outro'];
export const COM_CONJUGE = ['Casado(a)','União estável'];

// Estado compartilhado
export const valores = {};
export const pendentes = new Set();   // "Não tenho agora"
export const naoExiste = new Set();   // "Não existe"
export const arquivos = {};
export const docsExistentes = {};
let somenteLeitura = false;
let CFG = null;

// Gera a URL de download SEM chamar getDownloadURL() — que exige permissão de READ no
// Storage e é negada ao cliente anônimo da ficha (upload/create é liberado, read não).
// Definimos nosso próprio download token via metadata; a URL com token dispensa as regras.
// O token de download é gerado na Cloud Function (salvarFichaPublica): cliente
// anônimo não pode setar firebaseStorageDownloadTokens (Firebase rejeita desde
// 2026-07-03) nem chamar getDownloadURL (read negado pelas regras).

// ── Helpers de leitura ──
export function v(k){ return valores[k]!=null ? valores[k] : ''; }
export function esc(s){ return (''+s).replace(/"/g,'&quot;'); }
// Escape completo p/ inserção em innerHTML (texto ou atributo). Use em qualquer
// dado vindo do Firestore (nome, observação, pendências) antes de ir pra innerHTML.
export function escHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
export function selOptions(arr, sel){ return ['<option value="">Selecione</option>'].concat(arr.map(o=>`<option${o===sel?' selected':''}>${o}</option>`)).join(''); }
export function ufOptions(sel){ return ['<option value="">UF</option>'].concat(UF.map(u=>`<option${u===sel?' selected':''}>${u}</option>`)).join(''); }
export function row(...c){ return `<div class="row-2">${c.filter(Boolean).join('')}</div>`; }
export function subBloco(titulo, html){ return `<div class="sub-bloco"><div class="sub-bloco-titulo">${titulo}</div>${html}</div>`; }
export function secao(num, titulo, html, extra){ return `<div class="section"><div class="section-title"><span class="num">${num}</span> ${titulo}${extra||''}</div>${html}</div>`; }

// ── Campo de texto/select/date/email/tel/money/cpf/cnpj/cep, com NI/NTA opcionais ──
export function campo(o){
  const val = v(o.key), ni = naoExiste.has(o.key), nta = pendentes.has(o.key);
  const badge = o.badge==='opc' ? '<span class="badge-opc">opcional</span>'
              : o.badge==='none' ? ''
              : (val.trim()!=='' ? '<span class="badge-preen">Preenchido</span>' : '<span class="badge-obrig">Obrigatório</span>');
  let toggles = '';
  if(o.ni)  toggles += `<label class="nao-tenho nao-existe"><input type="checkbox" data-ni="${o.key}"${ni?' checked':''}><span>Não existe</span></label>`;
  if(o.nta) toggles += `<label class="nao-tenho"><input type="checkbox" data-campo="${o.key}"${nta?' checked':''}><span>Não tenho agora</span></label>`;
  const dis = (ni || nta || somenteLeitura) ? ' disabled' : '';
  const mask = o.cpf?' data-cpf':o.cnpj?' data-cnpj':o.money?' data-money':o.cep?` data-cep data-prefix="${o.prefix||''}"`:'';
  const attrs = `data-key="${o.key}"${mask}${o.ph?` placeholder="${o.ph}"`:''}`;
  let input;
  if(o.type==='select'){ input = `<select ${attrs}${dis}>${o.optsHtml}</select>`; }
  else { const t=o.type||'text'; const ml=o.cpf?' maxlength="14"':(o.cnpj?' maxlength="18"':(o.cep?' maxlength="9"':'')); input = `<input type="${t}" ${attrs}${ml}${dis} value="${esc(val)}">`; }
  const pendTag = (o.ni||o.nta) ? `<div class="pendente-tag" id="pend-${o.key}"${(ni||nta)?'':' style="display:none"'}>${ni?'Não se aplica':'Informação pendente'}</div>` : '';
  return `<div class="field"><div class="field-header"><label>${o.label} ${badge}</label>${toggles}</div>${input}${pendTag}</div>`;
}
export function campoRadio(o){
  const val=v(o.key);
  const badge = val.trim()!=='' ? '<span class="badge-preen">Preenchido</span>' : '<span class="badge-obrig">Obrigatório</span>';
  const btns = o.options.map(op=>`<button type="button" class="radio-btn${val===op?' ativo':''}" data-radio="${o.key}" data-val="${esc(op)}"${somenteLeitura?' disabled':''}>${op}</button>`).join('');
  return `<div class="field"><div class="field-header"><label>${o.label} ${badge}</label></div><div class="radio-group">${btns}</div></div>`;
}
export function campoTextarea(o){
  const filled=v(o.key).trim()!=='';
  const badge = o.req ? (filled?'<span class="badge-preen">Preenchido</span>':'<span class="badge-obrig">Obrigatório</span>') : '<span class="badge-opc">opcional</span>';
  return `<div class="field"><div class="field-header"><label>${o.label} ${badge}</label></div><textarea data-key="${o.key}"${somenteLeitura?' disabled':''} placeholder="${o.ph||''}">${escHtml(v(o.key))}</textarea></div>`;
}
// Bloco de pessoa padrão (nome/rg/cpf/nascimento/endereço/profissão/estado civil[/renda]/email/celular/fixo)
export function blocoPessoa(p, opts){
  opts = opts || {};
  const rendaLine = opts.renda ? row(campo({label:'Profissão',key:p+'profissao',nta:true}),campo({label:'Estado civil',key:p+'civil',type:'select',optsHtml:selOptions(CIVIL,v(p+'civil')),rerender:true}))+row(campo({label:'Renda mensal',key:p+'renda',money:true,nta:true,ph:'R$ 0,00'}),campo({label:'E-mail',key:p+'email',type:'email'}))
    : row(campo({label:'Profissão',key:p+'profissao',nta:true}),campo({label:'Estado civil',key:p+'civil',type:'select',optsHtml:selOptions(CIVIL,v(p+'civil')),rerender:true}))+campo({label:'E-mail',key:p+'email',type:'email'});
  return `
    ${campo({label:'Nome completo',key:p+'nome'})}
    ${row(campo({label:'RG',key:p+'rg'}),campo({label:'CPF',key:p+'cpf',cpf:true,ph:'000.000.000-00'}),campo({label:'Nascimento',key:p+'nasc',type:'date'}))}
    ${row(campo({label:'CEP',key:p+'cep',cep:true,prefix:p,ph:'00000-000'}),campo({label:'Endereço',key:p+'endereco',ph:'Rua, Avenida...'}))}
    ${row(campo({label:'Número',key:p+'numero'}),campo({label:'Complemento',key:p+'complemento',badge:'opc'}),campo({label:'Bairro',key:p+'bairro'}))}
    ${row(campo({label:'Cidade',key:p+'cidade'}),campo({label:'Estado',key:p+'estado',type:'select',optsHtml:ufOptions(v(p+'estado'))}))}
    ${rendaLine}
    ${row(campo({label:'Celular / WhatsApp',key:opts.principal?'whatsapp':p+'celular',type:'tel',ph:'(11) 90000-0000'}),campo({label:'Telefone fixo',key:p+'fixo',type:'tel',badge:'opc',ph:'(11) 0000-0000'}))}`;
}
export function blocoConjuge(p){
  return `
    ${campo({label:'Nome do cônjuge',key:p+'conj_nome',badge:'none'})}
    ${row(campo({label:'RG',key:p+'conj_rg',badge:'none'}),campo({label:'CPF',key:p+'conj_cpf',cpf:true,ph:'000.000.000-00',badge:'none'}),campo({label:'Nascimento',key:p+'conj_nasc',type:'date',badge:'none'}))}
    ${row(campo({label:'Profissão',key:p+'conj_profissao',badge:'none'}),campo({label:'Regime de bens',key:p+'conj_civil_regime',type:'select',optsHtml:selOptions(REGIME,v(p+'conj_civil_regime')),badge:'none'}))}
    ${campo({label:'E-mail',key:p+'conj_email',type:'email',badge:'none'})}
    ${row(campo({label:'Celular / WhatsApp',key:p+'conj_celular',type:'tel',ph:'(11) 90000-0000',badge:'none'}),campo({label:'Telefone fixo',key:p+'conj_fixo',type:'tel',badge:'opc',ph:'(11) 0000-0000'}))}`;
}
export function ehCasado(p){ return COM_CONJUGE.includes(v(p+'civil')); }

// ── Máscaras ──
function maskCPF(x){ let d=(''+x).replace(/\D/g,'').slice(0,11); if(d.length>9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`; if(d.length>6) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`; if(d.length>3) return `${d.slice(0,3)}.${d.slice(3)}`; return d; }
function maskCNPJ(x){ let d=(''+x).replace(/\D/g,'').slice(0,14); let o=d; if(d.length>2)o=d.slice(0,2)+'.'+d.slice(2); if(d.length>5)o=d.slice(0,2)+'.'+d.slice(2,5)+'.'+d.slice(5); if(d.length>8)o=d.slice(0,2)+'.'+d.slice(2,5)+'.'+d.slice(5,8)+'/'+d.slice(8); if(d.length>12)o=d.slice(0,2)+'.'+d.slice(2,5)+'.'+d.slice(5,8)+'/'+d.slice(8,12)+'-'+d.slice(12); return o; }
function maskCEP(x){ let d=(''+x).replace(/\D/g,'').slice(0,8); return d.length>5?`${d.slice(0,5)}-${d.slice(5)}`:d; }
function maskMoney(x){ let d=(''+x).replace(/\D/g,''); if(!d) return ''; d=d.replace(/^0+/,'')||'0'; while(d.length<3) d='0'+d; const int=d.slice(0,-2),c=d.slice(-2); return 'R$ '+int.replace(/\B(?=(\d{3})+(?!\d))/g,'.')+','+c; }
export function moneyToNum(x){ const d=(''+(x||'')).replace(/\D/g,''); return d?parseFloat(d)/100:0; }
export function fmtMoney(n){ return n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); }

// ── Validação de CPF/CNPJ (dígito verificador) ──
function validarCPF(cpf){
  const d=(''+cpf).replace(/\D/g,'');
  if(d.length!==11||/^(\d)\1{10}$/.test(d)) return false;
  let soma=0; for(let i=0;i<9;i++) soma+=parseInt(d[i])*(10-i);
  let resto=soma%11, dv1=resto<2?0:11-resto;
  if(dv1!==parseInt(d[9])) return false;
  soma=0; for(let i=0;i<10;i++) soma+=parseInt(d[i])*(11-i);
  resto=soma%11; const dv2=resto<2?0:11-resto;
  return dv2===parseInt(d[10]);
}
function validarCNPJ(cnpj){
  const d=(''+cnpj).replace(/\D/g,'');
  if(d.length!==14||/^(\d)\1{13}$/.test(d)) return false;
  const calc=base=>{
    const pesos = base.length===12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
    let soma=0; for(let i=0;i<base.length;i++) soma+=parseInt(base[i])*pesos[i];
    const resto=soma%11; return resto<2?0:11-resto;
  };
  if(calc(d.slice(0,12))!==parseInt(d[12])) return false;
  return calc(d.slice(0,13))===parseInt(d[13]);
}
// Confere CPFs/CNPJs preenchidos e telefones duplicados. Devolve mensagem de erro ou null.
function validarCpfsETelefones(){
  // Rola até o campo com erro e o destaca, pra pessoa ver qual CPF/CNPJ corrigir.
  const marcar=(k,msg)=>{ const el=document.querySelector(`[data-key="${k}"]`); if(el){ el.style.outline='2px solid #e11d48'; el.scrollIntoView({behavior:'smooth',block:'center'}); setTimeout(()=>{ el.style.outline=''; },5000); } return msg; };
  for(const k of Object.keys(valores)){
    if(naoExiste.has(k)||pendentes.has(k)) continue;
    const val=(''+(valores[k]||'')).trim(); if(!val) continue;
    if(k==='cpf_cnpj'){
      const d=val.replace(/\D/g,'');
      if(d.length===11 && !validarCPF(val)) return marcar(k,`CPF inválido: ${maskCPF(val)}. Confira os números digitados.`);
      if(d.length===14 && !validarCNPJ(val)) return marcar(k,`CNPJ inválido: ${val}. Confira os números digitados.`);
      continue;
    }
    if(/cpf$/i.test(k) && !validarCPF(val)) return marcar(k,`CPF inválido: ${maskCPF(val)}. Confira os números digitados.`);
    if(/cnpj$/i.test(k) && !validarCNPJ(val)) return marcar(k,`CNPJ inválido: ${val}. Confira os números digitados.`);
  }
  const celulares=new Map();
  for(const k of Object.keys(valores)){
    if(!/celular|whatsapp/i.test(k)) continue;
    if(naoExiste.has(k)||pendentes.has(k)) continue;
    const d=(''+(valores[k]||'')).replace(/\D/g,''); if(d.length<8) continue;
    if(celulares.has(d)) return marcar(k,'Duas pessoas estão com o mesmo número de celular. Cada pessoa precisa ter um número diferente.');
    celulares.set(d,k);
  }
  // CPF e e-mail também não podem se repetir entre pessoas da mesma ficha.
  const cpfs=new Map();
  for(const k of Object.keys(valores)){
    if(!/cpf/i.test(k)) continue;
    if(naoExiste.has(k)||pendentes.has(k)) continue;
    const d=(''+(valores[k]||'')).replace(/\D/g,''); if(d.length!==11) continue;
    if(cpfs.has(d)) return marcar(k,'Duas pessoas estão com o mesmo CPF. Cada pessoa precisa ter o próprio CPF — confira os números digitados.');
    cpfs.set(d,k);
  }
  const emails=new Map();
  for(const k of Object.keys(valores)){
    if(!/e-?_?mail/i.test(k)) continue;
    if(naoExiste.has(k)||pendentes.has(k)) continue;
    const v=(''+(valores[k]||'')).trim().toLowerCase(); if(!v||!v.includes('@')) continue;
    if(emails.has(v)) return marcar(k,'Duas pessoas estão com o mesmo e-mail. Cada pessoa precisa ter um e-mail diferente.');
    emails.set(v,k);
  }
  return null;
}

async function lookupCEP(input){
  const prefix = input.dataset.prefix||'';
  const cep = input.value.replace(/\D/g,'');
  if(cep.length!==8) return;
  try{
    const r=await fetch(`https://viacep.com.br/ws/${cep}/json/`); const d=await r.json();
    if(d.erro) return;
    const set=(k,val)=>{ if(val==null) return; valores[k]=val; const el=document.querySelector(`[data-key="${k}"]`); if(el) el.value=val; };
    set(prefix+'endereco',d.logradouro); set(prefix+'bairro',d.bairro); set(prefix+'cidade',d.localidade); set(prefix+'estado',d.uf);
    atualizarProgresso();
  }catch(e){}
}

// ── Documentos ──
// CFG.docs pode ser ARRAY ou FUNÇÃO — a função gera os slots por pessoa a partir do
// estado (nº de sócios/fiadores, casado…). Como renderDocs roda a cada rerender()
// (add/remove pessoa, troca de estado civil), os slots aparecem/somem sozinhos.
function _docs(){ try{ return (typeof CFG.docs==='function' ? CFG.docs() : CFG.docs) || []; }catch(_e){ return []; } }
function renderDocs(){
  const grid=document.getElementById('docs-grid'); if(!grid) return;
  grid.innerHTML = _docs().map(d=>{
    // Item de cabeçalho (sem key): agrupa e deixa CLARO de quem são os documentos abaixo.
    if(d.heading) return `<div class="docs-heading" style="grid-column:1/-1;font-weight:700;color:#002749;font-size:13px;margin:10px 0 2px;padding:8px 0 4px;border-top:1px solid #e7ebf0">${escHtml(d.heading)}</div>`;
    const ni=naoExiste.has(d.key), nta=pendentes.has(d.key);
    const badge = d.badge==='opc'?'<span class="badge-opc">opcional</span>':'<span class="badge-obrig">Obrigatório</span>';
    let toggles='';
    if(d.ni)  toggles+=`<label class="nao-tenho nao-existe doc-nao-tenho"><input type="checkbox" data-doc-ni="${d.key}"${ni?' checked':''}><span>Não existe</span></label>`;
    if(d.nta) toggles+=`<label class="nao-tenho doc-nao-tenho"><input type="checkbox" data-doc-campo="${d.key}"${nta?' checked':''}><span>Não tenho agora</span></label>`;
    const temExistente = !arquivos[d.key] && docsExistentes[d.key];
    let statusTxt;
    if(arquivos[d.key]) statusTxt='✓ '+arquivos[d.key].name;
    else if(temExistente) statusTxt=`<a href="${escHtml(docsExistentes[d.key])}" target="_blank" onclick="event.stopPropagation()" style="color:#1a7f37;font-weight:600">✓ Enviado</a>${somenteLeitura?'':' <span style="color:#888;font-size:11px">(toque para trocar)</span>'}`;
    else if(nta) statusTxt='Marcado como pendente';
    else if(ni) statusTxt='Não se aplica';
    else statusTxt='Toque para selecionar';
    const areaCls = (arquivos[d.key]||temExistente)?'doc-area tem-arquivo':((ni||nta)?'doc-area pendente-doc':'doc-area');
    // URLs do Firebase não têm extensão; tenta como imagem e, se falhar (é PDF),
    // renderiza as páginas via pdf.js (doc-preview.js). Sem ele, mensagem apontando pro link.
    const imgInline = (somenteLeitura && temExistente) ? `<img src="${escHtml(docsExistentes[d.key])}" alt="${escHtml(d.label)}" style="width:100%;max-height:400px;object-fit:contain;border-radius:8px;margin-top:6px;border:1px solid #e0e0e0" onerror="if(window.__pdfInline){window.__pdfInline(this,this.alt)}else{this.replaceWith(Object.assign(document.createElement('div'),{textContent:'📄 '+(this.alt||'Documento')+' é um PDF — clique em ✓ Enviado acima para visualizar no navegador.',style:'margin-top:6px;padding:10px 12px;background:#eef2f7;border:1px solid #d5dde8;border-radius:8px;color:#002749;font-size:13px;font-weight:600'}))}">` : '';
    return `<div class="doc-wrapper"><div class="${areaCls}" id="area-${d.key}"><div class="doc-clickable" data-trigger="${d.key}"><div class="doc-icon">${d.icon||'📄'}</div><div class="doc-label">${d.label} ${badge}</div><div class="doc-status" id="status-${d.key}">${statusTxt}</div></div><input type="file" id="file-${d.key}" accept="image/*,.pdf" style="display:none" data-doc="${d.key}"></div>${toggles}${imgInline}</div>`;
  }).join('');
}

export function rerender(){
  const cont=document.getElementById('campos'); if(cont) cont.innerHTML=CFG.render();
  renderDocs(); atualizarProgresso(); if(CFG.aoRenderizar) CFG.aoRenderizar();
}

export function atualizarProgresso(){
  const campos=document.querySelectorAll('[data-key]');
  let total=0, ok=0;
  campos.forEach(el=>{ total++; const k=el.dataset.key; if(pendentes.has(k)||naoExiste.has(k)||(valores[k]&&(''+valores[k]).trim())) ok++; });
  _docs().forEach(d=>{ if(!d.key) return; total++; if(pendentes.has(d.key)||naoExiste.has(d.key)||arquivos[d.key]||docsExistentes[d.key]) ok++; });
  const pct=total?Math.round(ok/total*100):0;
  const bar=document.getElementById('progressFill'); if(bar) bar.style.width=pct+'%';
  if(CFG.aoAtualizar) CFG.aoAtualizar();
}

function mostrarErro(msg){ const el=document.getElementById('erroFinal'); el.textContent=msg; el.style.display='block'; el.scrollIntoView({behavior:'smooth',block:'center'}); }

// ── Chrome (estrutura da página) ──
function montarChrome(){
  document.body.innerHTML = `
  <div class="corretor-bar" id="barraCorretor" style="display:none"><div><strong>Modo Corretor</strong> — Revisão</div><div class="corretor-acoes"><button class="btn-corretor btn-solicitar" id="btnSolicitar">⚠ Solicitar correção</button><button class="btn-corretor btn-aprovar" id="btnAprovar">✓ Aprovar e enviar ao admin</button></div></div>
  <div class="header"><img src="logo.png" alt="REMAX Smart Imóveis" style="height:52px;width:auto;display:block;flex:none"><div><h1>${CFG.titulo} <span class="badge-modo" id="badgeModo" style="display:none"></span></h1></div></div>
  <div class="progress-bar"><div class="progress-fill" id="progressFill" style="width:0%"></div></div>
  <div class="container">
    <div class="resumo-pendencias" id="resumoPendencias" style="display:none"><h4>⚠ Informações pendentes</h4><ul id="listaPendencias"></ul></div>
    <div class="intro" id="introTexto"><p>${CFG.intro||'Preencha o máximo possível. Use <strong>"Não tenho agora"</strong> para pendências.'}</p></div>
    <form id="formFicha" novalidate>
      <div id="campos"></div>
      ${(typeof CFG.docs==='function'||(CFG.docs&&CFG.docs.length))?`<div class="section"><div class="section-title"><span class="num">${CFG.docsNum||'•'}</span> Documentos</div><div class="docs-grid" id="docs-grid"></div></div>`:''}
      <div id="erroFinal" style="font-size:12px;color:#DC1C2E;margin-top:4px;display:none;text-align:center;padding:10px"></div>
      <div id="upload-progress" style="height:3px;background:#e5e7eb;border-radius:2px;margin-top:12px;overflow:hidden;display:none"><div id="upload-progress-fill" style="height:100%;background:#002749;width:0%;transition:width .3s"></div></div>
      <button type="submit" class="btn-submit" id="btnSubmit">Enviar ficha</button>
    </form>
    <div id="tela-sucesso" style="display:none;text-align:center;padding:60px 24px"><div style="width:72px;height:72px;background:#16a34a;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 20px;font-size:32px">✓</div><h2 id="sucessoTitulo" style="font-size:22px;color:#002749;margin-bottom:10px">Ficha enviada!</h2><p id="sucessoMsg" style="font-size:14px;color:#555">Seu corretor receberá suas informações em breve.</p></div>
  </div>`;
}

// ── Eventos ──
function wireEventos(){
  const form=document.getElementById('formFicha');

  form.addEventListener('input', e=>{
    const el=e.target; if(!el.dataset||el.dataset.key==null) return;
    let val=el.value;
    if(el.hasAttribute('data-cpf')) val=maskCPF(val);
    else if(el.hasAttribute('data-cnpj')) val=maskCNPJ(val);
    else if(el.hasAttribute('data-cep')) val=maskCEP(val);
    else if(el.hasAttribute('data-money')) val=maskMoney(val);
    if(val!==el.value) el.value=val;
    valores[el.dataset.key]=val;
    const fld=el.closest('.field'); const b=fld&&fld.querySelector('.badge-obrig,.badge-preen');
    if(b){ const k=el.dataset.key; const ok=val.trim()!==''; if(!(pendentes.has(k)||naoExiste.has(k))){ b.textContent=ok?'Preenchido':'Obrigatório'; b.className=ok?'badge-preen':'badge-obrig'; } }
    atualizarProgresso();
  });

  form.addEventListener('change', e=>{
    const el=e.target;
    if(el.matches('[data-campo]')){ const k=el.dataset.campo; if(el.checked){ pendentes.add(k); naoExiste.delete(k); valores[k]=''; } else pendentes.delete(k); rerender(); return; }
    if(el.matches('[data-ni]')){ const k=el.dataset.ni; if(el.checked){ naoExiste.add(k); pendentes.delete(k); valores[k]='Não existe'; } else { naoExiste.delete(k); valores[k]=''; } rerender(); return; }
    if(el.matches('[data-doc-campo]')){ const k=el.dataset.docCampo; if(el.checked){ pendentes.add(k); naoExiste.delete(k); delete arquivos[k]; } else pendentes.delete(k); renderDocs(); atualizarProgresso(); return; }
    if(el.matches('[data-doc-ni]')){ const k=el.dataset.docNi; if(el.checked){ naoExiste.add(k); pendentes.delete(k); delete arquivos[k]; } else naoExiste.delete(k); renderDocs(); atualizarProgresso(); return; }
    if(el.matches('[data-doc]')){ if(el.files[0]){ arquivos[el.dataset.doc]=el.files[0]; renderDocs(); atualizarProgresso(); } return; }
    // select que afeta estrutura (estado civil → cônjuge)
    if(el.dataset.key!=null){
      valores[el.dataset.key]=el.value;
      // Ao SAIR de casado/união estável, apaga os dados do cônjuge (prefixo+conj_*) —
      // senão a PII do ex-cônjuge ia no envio e um CPF/e-mail residual travava o submit
      // sem campo visível pra destacar (o bloco some). Espelha o que a ficha-pf já faz.
      if(/civil$/.test(el.dataset.key) && !COM_CONJUGE.includes(el.value)){
        const p=el.dataset.key.replace(/civil$/,'');
        [valores,arquivos,docsExistentes].forEach(o=>Object.keys(o).forEach(k=>{ if(k.startsWith(p+'conj_')) delete o[k]; }));
        [...pendentes].forEach(k=>{ if(k.startsWith(p+'conj_')) pendentes.delete(k); });
      }
      if(el.hasAttribute('data-rerender')||/civil$/.test(el.dataset.key)) rerender();
    }
  });

  form.addEventListener('focusout', e=>{ const el=e.target; if(el.dataset&&el.hasAttribute('data-cep')) lookupCEP(el); });

  form.addEventListener('click', e=>{
    const t=e.target.closest('[data-action],[data-radio],[data-trigger]'); if(!t) return;
    if(t.dataset.trigger!=null){ const k=t.dataset.trigger; if(somenteLeitura) return; if(naoExiste.has(k)||pendentes.has(k)) return; document.getElementById('file-'+k).click(); return; }
    if(t.dataset.radio!=null){ valores[t.dataset.radio]=t.dataset.val; rerender(); return; }
    if(t.dataset.action!=null){ e.preventDefault(); const fn=CFG.acoes&&CFG.acoes[t.dataset.action]; if(fn){ fn(t); rerender(); } return; }
  });

  form.addEventListener('submit', enviar);
}

// data-civil select já tratado por /civil$/. Para selects normais (im_tipo etc.) o input já cobre.
function aplicarValores(dados){
  Object.entries(dados||{}).forEach(([k,val])=>{ valores[k]=val; if(val==='Não existe') naoExiste.add(k); });
}

async function enviar(e){
  e.preventDefault();
  // Corretor só é exigido na CRIAÇÃO (link do cliente traz ?corretor=). Na edição
  // (idFicha presente) o Hub abre sem corretor de propósito — a function faz UPDATE e
  // ignora corretorUid (imutável). Sem esta ressalva, salvar a edição pelo Hub falhava
  // com "Solicite um novo link".
  if(!CFG._idFicha && !CFG._corretorUid){ mostrarErro('Link inválido. Solicite um novo link ao seu corretor.'); return; }
  if(CFG.validar){ const err=CFG.validar(); if(err){ mostrarErro(err); return; } }
  const rig = CFG.rigidos || ['nome','whatsapp','email'];
  const falta = rig.filter(k=>!(valores[k]&&(''+valores[k]).trim()));
  if(falta.length){ mostrarErro(CFG.msgRigidos||'Preencha os campos obrigatórios principais.'); return; }
  const erroCpfFone = validarCpfsETelefones();
  if(erroCpfFone){ mostrarErro(erroCpfFone); return; }

  // Itens rotulados "Obrigatório" (campos e documentos) sem preencher/anexar
  // e sem "não tenho agora": confirma com o cliente e registra como
  // pendência — antes passavam em silêncio e a ficha chegava "sem
  // pendências" faltando tudo.
  const camposFaltando = [...document.querySelectorAll('#formFicha .field')].filter(f => {
    if(!f.querySelector('.badge-obrig') || !f.offsetParent) return false; // só visíveis
    const inp = f.querySelector('[data-key]'); if(!inp) return false;
    const k = inp.dataset.key;
    return !(valores[k] && (''+valores[k]).trim()) && !pendentes.has(k) && !naoExiste.has(k);
  }).map(f => ({ k: f.querySelector('[data-key]').dataset.key,
                 label: (f.querySelector('label')?.childNodes[0]?.textContent || '').trim() || f.querySelector('[data-key]').dataset.key }));
  const docsFaltando = _docs().filter(d => d.key && d.badge==='obrig'
    && !arquivos[d.key] && !docsExistentes[d.key] && !pendentes.has(d.key) && !naoExiste.has(d.key));
  if(camposFaltando.length || docsFaltando.length){
    const itens = [...camposFaltando.map(c=>c.label), ...docsFaltando.map(d=>d.label)];
    if(!confirm('A ficha está sem itens obrigatórios:\n\n• ' + itens.join('\n• ') + '\n\nEnviar mesmo assim? Eles ficarão marcados como pendência para o corretor.')) return;
    camposFaltando.forEach(c => pendentes.add(c.k));
    docsFaltando.forEach(d => pendentes.add(d.key));
  }

  const btn=document.getElementById('btnSubmit'); btn.disabled=true; btn.textContent='Enviando...';
  document.getElementById('erroFinal').style.display='none';

  // assinatura (proposta): canvas -> arquivo
  if(CFG.antesDeEnviar){ await CFG.antesDeEnviar(); }

  const dados={}; Object.entries(valores).forEach(([k,val])=>{ if(val&&(''+val).trim()) dados[k]=val; });
  const fichaId=Date.now().toString(36)+Math.random().toString(36).slice(2);
  // Upload SEM token no metadata (o Firebase passou a rejeitar isso em cliente
  // anônimo — 2026-07-03). Mandamos só o caminho; a function gera o token.
  const caminhosDocs={}; const falhasUpload=[]; const docsKeys=Object.keys(arquivos);
  // Extensão do arquivo (do nome original ou do tipo) — pra o download vir "rgcpf.pdf"
  // em vez de "rgcpf" sem extensão (Windows não sabia abrir).
  const _extDoc=f=>{ const m=((f&&f.name)||'').match(/\.([a-z0-9]{1,5})$/i); if(m)return m[1].toLowerCase(); const t=(f&&f.type)||''; return t==='application/pdf'?'pdf':t==='image/png'?'png':t==='image/webp'?'webp':/^image\//.test(t)?'jpg':'dat'; };
  if(docsKeys.length){
    const prog=document.getElementById('upload-progress'),fill=document.getElementById('upload-progress-fill'); prog.style.display='block'; let n=0;
    for(const k of docsKeys){
      const _p=`fichas/${CFG.tipo}/${fichaId}/${k}`;
      try{ await uploadBytes(ref(storage,_p),arquivos[k],{contentType:arquivos[k].type||undefined,contentDisposition:'inline; filename="'+k+'.'+_extDoc(arquivos[k])+'"'}); caminhosDocs[k]=_p; }
      catch(err){ console.warn('Upload falhou:',k,err.message); pendentes.add(k); falhasUpload.push(((CFG.docs||[]).find(d=>d.key===k)||{}).label||k); }
      fill.style.width=Math.round((++n/docsKeys.length)*100)+'%';
    }
  }
  if(falhasUpload.length){
    alert('Não foi possível enviar alguns anexos:\n\n• ' + falhasUpload.join('\n• ') + '\n\nA ficha será enviada mesmo assim e eles ficarão como pendência. Você pode reabrir o link e tentar de novo.');
  }
  try{
    // A function decide status/corretorUid e faz o merge dos documentos antigos.
    await chamarFn('salvarFichaPublica', {
      colecao: 'fichas',
      fichaId: (CFG._modo==='edicao' && CFG._idFicha) ? CFG._idFicha : null,
      tipo: CFG.tipo,
      corretorUid: CFG._corretorUid,
      corretorNome: CFG._corretorNome,
      imovelId: CFG._imovelId || null,
      dados,
      documentosPaths: caminhosDocs,
      pendentes: Array.from(pendentes),
    });
    document.getElementById('formFicha').style.display='none'; document.getElementById('tela-sucesso').style.display='block';
    const t=document.getElementById('sucessoTitulo'),m=document.getElementById('sucessoMsg');
    if(t) t.textContent=CFG._modo==='edicao'?'Alterações salvas!':'Ficha enviada!';
    if(m) m.textContent=CFG._modo==='edicao'?'Suas informações foram atualizadas.':'Seu corretor receberá suas informações em breve.';
    document.getElementById('progressFill').style.width='100%'; window.scrollTo({top:0,behavior:'smooth'});
  }catch(err){
    // Erro vindo da function (ficha grande demais, link expirado...) tem mensagem
    // útil; o resto quase sempre é conexão.
    const daFuncao = typeof err?.code === 'string' && err.code.startsWith('functions/') && err.code !== 'functions/internal';
    mostrarErro(daFuncao ? err.message : 'Erro ao enviar. Verifique sua conexão e tente novamente.');
    btn.disabled=false; btn.textContent='Enviar ficha';
  }
}

// ── Ações do corretor (fichas tipo: enviarFichaTipoAdmin) ──
async function enviarParaAdmin(){
  if(!CFG._idFicha) return; if(!confirm('Confirma envio ao administrativo?')) return;
  try{ await chamarFn('enviarFichaTipoAdmin',{fichaId:CFG._idFicha}); alert('Ficha enviada ao administrativo!'); window.close(); }catch(e){ alert('Erro: '+e.message); }
}
function solicitarCorrecao(){
  const msg=prompt('Descreva o que precisa ser corrigido:'); if(!msg) return;
  updateDoc(doc(db,'fichas',CFG._idFicha),{ status:'correcao_solicitada', observacaoCorretor:msg, atualizadoEm:serverTimestamp() }).then(()=>alert('Solicitação registrada.')).catch(e=>alert('Erro: '+e.message));
}

export async function iniciarFicha(cfg){
  CFG = cfg;
  const params=new URLSearchParams(location.search);
  CFG._modo = params.get('modo') || 'cliente';
  CFG._corretorUid = params.get('corretor') || '';
  CFG._corretorNome = params.get('nome') ? decodeURIComponent(params.get('nome')) : '';
  CFG._idFicha = params.get('idFicha') || '';
  CFG._imovelId = params.get('imovelId') || '';
  const origemHub = params.get('origem')==='hub';
  if(cfg.estadoInicial) cfg.estadoInicial();

  montarChrome();
  document.getElementById('btnAprovar')?.addEventListener('click', enviarParaAdmin);
  document.getElementById('btnSolicitar')?.addEventListener('click', solicitarCorrecao);
  wireEventos();

  if(CFG._modo==='corretor' && CFG._idFicha){
    somenteLeitura=true;
    document.getElementById('barraCorretor').style.display = origemHub ? 'none':'flex';
    const b=document.getElementById('badgeModo'); b.style.display='inline'; b.textContent='Revisão';
    document.getElementById('introTexto').style.display='none'; document.getElementById('btnSubmit').style.display='none';
    try{ const snap=await getDoc(doc(db,'fichas',CFG._idFicha)); if(!snap.exists()){ mostrarErro('Ficha não encontrada.'); return; } const f=snap.data(); aplicarValores(f.dados); Object.entries(f.documentos||{}).forEach(([k,url])=>{ docsExistentes[k]=url; }); if(cfg.aoCarregar) cfg.aoCarregar(f); rerender();
      if((f.pendentes||[]).length && !CFG.semResumoPendencias){ document.getElementById('resumoPendencias').style.display='block'; const _nomesPend={}; (CFG.docs||[]).forEach(d=>{_nomesPend[d.key]=d.label;}); document.querySelectorAll('[data-campo]').forEach(cb=>{const lbl=cb.closest('.field-header')?.querySelector('label'); if(lbl){const t=lbl.cloneNode(true); t.querySelectorAll('span').forEach(s=>s.remove()); _nomesPend[cb.dataset.campo]=t.textContent.trim();}}); document.querySelectorAll('[data-doc-campo]').forEach(cb=>{if(!_nomesPend[cb.dataset.docCampo]){const lbl=cb.closest('.doc-wrapper')?.querySelector('.doc-label'); if(lbl){const t=lbl.cloneNode(true); t.querySelectorAll('span').forEach(s=>s.remove()); _nomesPend[cb.dataset.docCampo]=t.textContent.trim();}}}); document.getElementById('listaPendencias').innerHTML=f.pendentes.map(p=>`<li>${escHtml(_nomesPend[p]||p)}</li>`).join(''); } }catch(e){ mostrarErro('Erro: '+e.message); }
  } else if(CFG._modo==='edicao' && CFG._idFicha){
    const b=document.getElementById('badgeModo'); b.style.display='inline'; b.textContent='Edição';
    document.getElementById('btnSubmit').textContent='Salvar alterações';
    try{ const snap=await getDoc(doc(db,'fichas',CFG._idFicha)); if(!snap.exists()){ mostrarErro('Ficha não encontrada.'); return; } const f=snap.data(); if(!origemHub&&f.status!=='aguardando_edicao_cliente'){ mostrarErro('Este link não está mais ativo. Peça um novo link ao seu corretor.'); return; } if(f.observacaoCorretor){ document.getElementById('introTexto').innerHTML=`<p>📝 <strong>Observação do corretor:</strong> ${escHtml(f.observacaoCorretor)}</p>`; } aplicarValores(f.dados); Object.entries(f.documentos||{}).forEach(([k,url])=>{ docsExistentes[k]=url; }); if(cfg.aoCarregar) cfg.aoCarregar(f); rerender(); }catch(e){ mostrarErro('Erro ao carregar: '+e.message); }
  } else {
    params.forEach((val, key) => { if(key.startsWith('pre_')) valores[key.slice(4)] = val; });
    // Ficha aberta pelo imóvel (&imovelId=): já traz o bloco "Imóvel de interesse"
    // preenchido. Silencioso se falhar — é conveniência, não bloqueia o preenchimento.
    if(CFG._imovelId){ try{ await prefillImovel(CFG._imovelId); }catch(e){ /* segue sem prefill */ } }
    rerender();
  }
}

// Pré-preenche os campos im_* do imóvel (via function pública imovelParaFicha).
// Não sobrescreve nada que já veio por pre_ na URL.
async function prefillImovel(imovelId){
  const r = await chamarFn('imovelParaFicha', { imovelId });
  const d = (r && r.data) || {};
  Object.entries(d).forEach(([k,v])=>{ if(v && !valores[k]) valores[k]=v; });
}

export function ehSomenteLeitura(){ return somenteLeitura; }
