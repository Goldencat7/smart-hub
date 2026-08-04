#!/usr/bin/env node
/* Importa / sincroniza o feed de imóveis da RE/MAX (padrão VRSync/OLX) para a
 * coleção `imoveis` do Hub — cada anúncio vira um imóvel do corretor certo.
 * ---------------------------------------------------------------------------
 * O feed é PÚBLICO e atualiza todo dia. A chave de ligação é o ListingID do
 * portal (guardado como `feedListingId`): rodar de novo faz UPSERT — cria os
 * novos, atualiza preço/foto dos existentes, e NUNCA duplica nem encosta no que
 * o corretor fez no Hub (interessados, negócios, ficha do proprietário, esteira).
 *
 * SEGURANÇA:
 *  - Sem `--commit`, é DRY-RUN: não grava nada, não precisa de credencial nenhuma,
 *    só baixa o feed e mostra o que FARIA. É o modo padrão.
 *  - Com `--commit`, exige `--project=staging|prod` EXPLÍCITO e grava via Admin SDK
 *    (precisa de ADC: `gcloud auth application-default login`).
 *  - Só cria/atualiza imóveis com `origem:'feed'`; imóvel cadastrado na mão no Hub
 *    (origem:'manual') é intocável.
 *
 * Uso:
 *    node scripts/importar-feed-imoveis.js                 # dry-run (padrão)
 *    node scripts/importar-feed-imoveis.js --commit --project=staging
 *    node scripts/importar-feed-imoveis.js --commit --project=prod
 */
'use strict';
const path = require('path');
const { XMLParser } = require(path.join(__dirname, '..', 'functions', 'node_modules', 'fast-xml-parser'));

const FEED_URL = 'https://feeds.goiconnect.com/RemaxBrazil_FormatoPadraoGrupoOlx/33E833C7-A06A-483C-BF4B-5923F3261294/Remax_60147.xml';

const PROJETOS = { staging: 'remax-smart-hub-staging', prod: 'remax-smart-hub' };
const GESTOR_FALLBACK_UID = 'OwcT6wCrXMgJ0tPADMUdKdBB8h32'; // bootstrap admin (Nathan) — destino de imóvel sem corretor mapeado

// Apelidos: corretor cujo e-mail no feed (@remax) difere do e-mail da conta no Hub.
const ALIAS_EMAIL = {
  'mauricioallegrini@remax.com.br': 'mauricioallegrini@gmail.com',
};

// De-para OFFLINE (só pro dry-run mostrar o corretor certo sem bater no Auth).
// No modo --commit, o corretor é resolvido AO VIVO por admin.auth().getUserByEmail
// (funciona em prod e staging, cada um com seus próprios UIDs). NÃO usar estes UIDs
// pra gravar — são de produção.
const DEPARA_PREVIEW = {
  'leandrofreitas@remax.com.br':    { uid: 'I1LorlocBOdVnV3xDFnrGxGZU3C3', nome: 'Leandro Freitas' },
  'alexandregutierres@remax.com.br':{ uid: 'jUkfH1JExqZgXbRwB4ttMCNFU742', nome: 'Alexandre Gutierres' },
  'fernandamaia@remax.com.br':      { uid: 'r8nEbYSAEGcO24UulKMIQBbxzUt1', nome: 'Fernanda Maia' },
  'rafaelaquirino@remax.com.br':    { uid: 'pXEUlq8oZ4TBtj0cCarh5mJT4p82', nome: 'Rafaela Quirino' },
  'adrianadias@remax.com.br':       { uid: 'DfPXpCbF7eRymHr3Z30aMd87XVt2', nome: 'Adriana Dias' },
  'raquelnacari@remax.com.br':      { uid: 'iWXORgmiMvTDBYs7lsWxII7a9Xr2', nome: 'Raquel Nacari' },
  'alinesales@remax.com.br':        { uid: 'XvoudsDf2IfRf9YOP2qKFtp6xHv1', nome: 'Aline Sales' },
  'leandrozucchi@remax.com.br':     { uid: 'F0xCEpWjvbfWGfZl3Ql5pSdtZFE3', nome: 'Leandro Zuchi' },
  'lucianatorres@remax.com.br':     { uid: 'HNno0hUaTJPGk2PfmPqj2VwJl3m1', nome: 'Luciana Torres' },
  'glacekelly@remax.com.br':        { uid: 'W10wnsUpKqVsuRAp5SnsMeLOiPq2', nome: 'Glace Kelly' },
  'kelvincastanho@remax.com.br':    { uid: 'hhFm18xlc9SSIoyuoaL6BcQpnIt2', nome: 'Kelvin Castanho' },
  'marcelogutierres@remax.com.br':  { uid: '77VSUNRtBWUEOrmLiyabBxGowEx1', nome: 'Marcelo Gutierres' },
  'eciojunior@remax.com.br':        { uid: 'c51huQTUL8SXdG58TXNpDBtFta93', nome: 'Ecio Junior' },
  'karinawestphalen@remax.com.br':  { uid: 'iVSrz68VR2Wwts7taOpFvwD3EeZ2', nome: 'Karina Westphalen' },
  'mauricioallegrini@gmail.com':    { uid: '6G3ov0TJCOUYvIfdCx69qKux2d73', nome: 'Mauricio Allegrini' },
};

// PropertyType (EN) -> tipo em PT. Fallback = parte depois da "/".
const TIPOS = {
  'Residential / Apartment': 'Apartamento',
  'Residential / Home': 'Casa',
  'Residential / Studio': 'Studio',
  'Residential / Condo': 'Casa de Condomínio',
  'Residential / Sobrado': 'Sobrado',
  'Residential / Penthouse': 'Cobertura',
  'Residential / Land Lot': 'Terreno',
  'Commercial / Office': 'Sala Comercial',
  'Commercial / Industrial': 'Galpão / Industrial',
  'Commercial / Edificio Comercial': 'Edifício Comercial',
  'Commercial / Building': 'Prédio Comercial',
  'Commercial / Business': 'Ponto Comercial',
};

// ---------- helpers de leitura do XML ----------
const arr = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const txt = (x) => {
  if (x == null) return '';
  if (typeof x === 'object') return String(x['#text'] != null ? x['#text'] : '').trim();
  return String(x).trim();
};
const num = (x) => { const n = parseInt(txt(x).replace(/[^\d]/g, ''), 10); return Number.isFinite(n) ? n : null; };
const brl = (n) => (n == null ? '' : 'R$ ' + n.toLocaleString('pt-BR'));

function tipoPt(pt) {
  if (TIPOS[pt]) return TIPOS[pt];
  const p = String(pt || '').split('/').pop().trim();
  return p || 'Imóvel';
}

function mapearImovel(L, resolverCorretor) {
  const id = txt(L.ListingID);
  const tt = txt(L.TransactionType);
  const finalidade = tt === 'For Sale' ? 'venda' : 'locacao';
  const det = L.Details || {};
  const loc = L.Location || {};
  const ci = L.ContactInfo || {};

  const valorN = finalidade === 'venda' ? num(det.ListPrice) : num(det.RentalPrice);

  // estado: o texto é "São Paulo", mas o atributo abbreviation traz "SP"
  const estadoAbbr = (loc.State && loc.State['@_abbreviation']) || '';

  const fotos = arr(L.Media && L.Media.Item)
    .filter((m) => (m['@_medium'] || m.medium) === 'image')
    .map((m) => txt(m));
  const video = arr(L.Media && L.Media.Item).filter((m) => (m['@_medium']) === 'video').map((m) => txt(m))[0] || '';

  const emailFeed = txt(ci.Email).toLowerCase();
  const corretor = resolverCorretor(emailFeed);

  return {
    feedListingId: id,
    origem: 'feed',
    finalidade,
    tipo: tipoPt(txt(det.PropertyType)),
    valorAnuncio: brl(valorN),
    proprietarioNome: '',           // feed público não traz o dono — preenche na ficha
    proprietarioContato: '',
    corretorUid: corretor.uid,
    corretorNome: corretor.nome,
    _corretorEmailFeed: emailFeed,  // só pra log/depuração
    endereco: {
      cep: txt(loc.PostalCode),
      logradouro: txt(loc.Address),
      numero: txt(loc.StreetNumber),
      complemento: txt(loc.Complement),
      bairro: txt(loc.Neighborhood),
      cidade: txt(loc.City),
      estado: estadoAbbr,
    },
    dormitorios: num(det.Bedrooms),
    vagas: num(det.Garage),
    area: num(det.LivingArea),
    iptu: txt(det.Iptu) ? brl(num(det.Iptu)) : '',
    // Bloco portal-owned (o sync pode sobrescrever à vontade — nada disso é do Hub):
    feedDados: {
      titulo: txt(L.Title),
      descricao: txt(det.Description),
      suites: num(det.Suites),
      banheiros: num(det.Bathrooms),
      condominio: num(det.PropertyAdministrationFee),
      ano: num(det.YearBuilt),
      andar: num(det.UnitFloor),
      unidade: txt(det.UnitNumber),
      areaTotal: num(det.LotArea),
      lat: txt(loc.Latitude),
      lng: txt(loc.Longitude),
      fotos,
      video,
      tour: txt(L.VirtualTourLink),
      detalheUrl: txt(L.DetailViewUrl),
      features: arr(det.Features && det.Features.Feature).map(txt),
    },
  };
}

// ---------- dry-run: mostra o que faria ----------
function relatorioDryRun(mapeados, meta) {
  console.log('\n================ DRY-RUN (nada foi gravado) ================');
  console.log('Feed publicado em:', meta.publishDate);
  console.log('Total de anúncios no feed:', mapeados.length);

  // por corretor
  const porC = {};
  for (const m of mapeados) {
    const k = m.corretorNome || m._corretorEmailFeed;
    porC[k] = porC[k] || { total: 0, venda: 0, locacao: 0, fallback: m.corretorUid === GESTOR_FALLBACK_UID };
    porC[k].total++; porC[k][m.finalidade]++;
  }
  console.log('\n-- Imóveis por corretor --');
  Object.entries(porC).sort((a, b) => b[1].total - a[1].total).forEach(([nome, d]) => {
    console.log(`   ${nome.padEnd(26)} ${String(d.total).padStart(3)}  (venda ${d.venda}, locação ${d.locacao})${d.fallback ? '  << CAIU NO GESTOR' : ''}`);
  });

  // avisos
  console.log('\n-- Avisos de qualidade --');
  const caros = mapeados.filter((m) => {
    const n = parseInt((m.valorAnuncio || '').replace(/[^\d]/g, ''), 10);
    return m.finalidade === 'venda' && n > 100000000;
  });
  caros.forEach((m) => console.log(`   ⚠ preço absurdo: ${m.feedListingId} = ${m.valorAnuncio}  (${m.feedDados.titulo.slice(0, 50)})`));
  const semValor = mapeados.filter((m) => !m.valorAnuncio);
  if (semValor.length) console.log(`   ⚠ sem valor: ${semValor.length}`);
  const semGeo = mapeados.filter((m) => !m.feedDados.lat || !m.feedDados.lng);
  if (semGeo.length) console.log(`   ⚠ sem lat/long (some do mapa): ${semGeo.length} -> ${semGeo.map((m) => m.feedListingId).join(', ')}`);
  const ids = mapeados.map((m) => m.feedListingId);
  const dups = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (dups.length) console.log(`   ⚠ feedListingId repetido no feed: ${[...new Set(dups)].join(', ')}`);
  if (!caros.length && !semValor.length && !dups.length) console.log('   (nenhum problema grave além do já sabido)');

  // amostra
  console.log('\n-- Amostra (2 imóveis, como ficariam gravados) --');
  for (const m of [mapeados[0], mapeados[1]]) {
    const preview = { ...m };
    preview.feedDados = { ...m.feedDados, fotos: `[${m.feedDados.fotos.length} URLs]`, features: `[${m.feedDados.features.length}]`, descricao: m.feedDados.descricao.slice(0, 60) + '…' };
    delete preview._corretorEmailFeed;
    console.log(JSON.stringify(preview, null, 2));
  }
  console.log('\n============================================================');
  console.log('Pra gravar de verdade:  node scripts/importar-feed-imoveis.js --commit --project=staging');
}

async function baixarFeed() {
  const resp = await fetch(FEED_URL);
  if (!resp.ok) throw new Error('Feed HTTP ' + resp.status);
  const xml = await resp.text();
  // Sem cdataPropName: o parser funde o conteúdo CDATA no valor do nó (senão
  // Title/Description/Address/City/Neighborhood — todos CDATA — vinham vazios).
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true, parseTagValue: false });
  const doc = parser.parse(xml);
  const feed = doc.ListingDataFeed || {};
  const listings = arr(feed.Listings && feed.Listings.Listing);
  const publishDate = txt(feed.Header && feed.Header.PublishDate);
  return { listings, publishDate };
}

(async () => {
  const args = process.argv.slice(2);
  const commit = args.includes('--commit');
  const projArg = (args.find((a) => a.startsWith('--project=')) || '').split('=')[1];
  const limite = parseInt(((args.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || '0', 10);

  const { listings, publishDate } = await baixarFeed();
  if (!listings.length) throw new Error('Feed vazio / não parseou.');

  if (!commit) {
    // DRY-RUN offline: resolve corretor pelo de-para de preview
    const resolver = (email) => {
      const alvo = ALIAS_EMAIL[email] || email;
      return DEPARA_PREVIEW[alvo] || { uid: GESTOR_FALLBACK_UID, nome: '(gestor — não mapeado)' };
    };
    const mapeados = listings.map((L) => mapearImovel(L, resolver));
    relatorioDryRun(mapeados, { publishDate });
    process.exit(0);
  }

  // -------- COMMIT (grava de verdade) --------
  if (!PROJETOS[projArg]) { console.error('✋ Com --commit é obrigatório --project=staging ou --project=prod'); process.exit(1); }
  if (process.env.FIRESTORE_EMULATOR_HOST) { console.error('✋ Env de emulador setada — este importador é pro projeto REAL. Abortando.'); process.exit(1); }
  const projectId = PROJETOS[projArg];

  const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));
  admin.initializeApp({ projectId });
  const auth = admin.auth();
  const db = admin.firestore();

  // Resolve corretor AO VIVO por e-mail (cada projeto tem seus UIDs)
  const cacheC = {};
  const resolver = async (email) => {
    const alvo = ALIAS_EMAIL[email] || email;
    if (cacheC[alvo] !== undefined) return cacheC[alvo];
    try { const u = await auth.getUserByEmail(alvo); cacheC[alvo] = { uid: u.uid, nome: u.displayName || alvo }; }
    catch (_e) { cacheC[alvo] = { uid: GESTOR_FALLBACK_UID, nome: '(gestor — não mapeado)' }; }
    return cacheC[alvo];
  };

  const alvo = limite > 0 ? listings.slice(0, limite) : listings;
  console.log(`\n🚚 Importando ${alvo.length}${limite ? ` (amostra de ${listings.length})` : ''} imóveis para ${projectId} (feed de ${publishDate})...`);
  let criados = 0, atualizados = 0;
  const vistos = new Set();
  for (const L of alvo) {
    const email = txt((L.ContactInfo || {}).Email).toLowerCase();
    const corretor = await resolver(email);
    const m = mapearImovel(L, () => corretor);
    delete m._corretorEmailFeed;
    vistos.add(m.feedListingId);

    const snap = await db.collection('imoveis').where('feedListingId', '==', m.feedListingId).limit(1).get();
    const now = admin.firestore.FieldValue.serverTimestamp();
    if (snap.empty) {
      // NOVO: nasce completo, disponível, na esteira se for locação
      await db.collection('imoveis').add({
        ...m,
        situacao: 'disponivel', arquivado: false, feedAtivo: true,
        ...(m.finalidade !== 'venda' ? { status: 'recebido' } : {}),
        interessados: [], pendentes: [],
        timeline: [{ texto: 'Imóvel importado do portal (feed RE/MAX)', porNome: 'Sync do portal', em: admin.firestore.Timestamp.now() }],
        criadoEm: now, atualizadoEm: now, feedSyncEm: now,
      });
      criados++;
    } else {
      // EXISTE: atualiza SÓ os campos do portal — não toca em interessados/negócios/
      // proprietário/status/situacao (do Hub). Se tinha sido arquivado por SAIR do
      // portal e voltou, desarquiva (não mexe em arquivamento manual do gestor).
      const atual = snap.docs[0].data();
      const voltou = atual.arquivado === true && atual.arquivadoMotivo === 'Saiu do portal';
      await snap.docs[0].ref.set({
        finalidade: m.finalidade, tipo: m.tipo, valorAnuncio: m.valorAnuncio,
        endereco: m.endereco, dormitorios: m.dormitorios, vagas: m.vagas, area: m.area,
        iptu: m.iptu, corretorUid: m.corretorUid, corretorNome: m.corretorNome,
        feedDados: m.feedDados, feedAtivo: true,
        ...(voltou ? { arquivado: false, arquivadoMotivo: admin.firestore.FieldValue.delete(), voltouAoPortalEm: now } : {}),
        atualizadoEm: now, feedSyncEm: now,
      }, { merge: true });
      atualizados++;
    }
  }

  // Imóveis do feed que sumiram (vendidos/despublicados): marca, NÃO apaga.
  // PULA na carga parcial (--limit): senão marcaria como "fora do portal" todos os
  // que ficaram de fora da amostra.
  let sumidos = 0;
  if (!limite) {
    const doFeed = await db.collection('imoveis').where('origem', '==', 'feed').get();
    for (const d of doFeed.docs) {
      const fid = d.get('feedListingId');
      if (fid && !vistos.has(fid) && d.get('feedAtivo') !== false) {
        const emNeg = d.get('situacao') === 'em_negociacao';   // negócio ativo → não arquiva
        await d.ref.set({
          feedAtivo: false, feedSaiuEm: admin.firestore.FieldValue.serverTimestamp(),
          ...(emNeg ? {} : { arquivado: true, arquivadoMotivo: 'Saiu do portal', arquivadoEm: admin.firestore.FieldValue.serverTimestamp() }),
        }, { merge: true });
        sumidos++;
      }
    }
  }

  console.log(`✅ Pronto: ${criados} criados, ${atualizados} atualizados, ${sumidos} marcados como fora do portal.`);
  process.exit(0);
})().catch((e) => { console.error('Erro na importação:', e && e.message || e); process.exit(1); });
