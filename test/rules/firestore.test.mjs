// Testes das REGRAS do Firestore — a "rede de segurança" do cofre.
//
// Rodam contra o emulador (Auth/Firestore de mentira, isolado — nunca tocam produção).
// Cada teste afirma o que um CLIENTE (app, não a Cloud Function) pode ou não pode
// fazer direto no banco. As Cloud Functions usam Admin SDK e IGNORAM estas regras —
// então aqui a gente trava o que sobra: leitura por dono, escrita sempre negada no
// cliente, e o cofre de credenciais fechado pra todo mundo.
//
// Como rodar:  npm test   (sobe o emulador, roda, derruba)
// Ferramentas: node:test (runner nativo) + @firebase/rules-unit-testing.

import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, it } from 'node:test';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';

const PROJECT_ID = 'demo-smart-hub';           // prefixo demo- = emulador não exige credencial
const BOOTSTRAP_ADMIN = 'OwcT6wCrXMgJ0tPADMUdKdBB8h32'; // UID que as regras tratam como gestor

let testEnv;

// Contextos de usuário (cada um vira um request.auth diferente nas regras).
const anon      = () => testEnv.unauthenticatedContext().firestore();
const corretor1 = () => testEnv.authenticatedContext('corretor1').firestore();
const corretor2 = () => testEnv.authenticatedContext('corretor2').firestore();
const admin     = () => testEnv.authenticatedContext('adminUid', { admin: true }).firestore();
const gestor    = () => testEnv.authenticatedContext('gestor1', { locRole: 'gestor' }).firestore();
const adminstv  = () => testEnv.authenticatedContext('adm1', { locRole: 'administrativo' }).firestore();

// Semeia documentos IGNORANDO as regras (setup dos testes, como faz a Cloud Function).
function seed(fn) {
  return testEnv.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  });
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

beforeEach(async () => {
  if (testEnv) await testEnv.clearFirestore();
});

describe('Cofre — senhas dos sistemas (coleção credentials)', () => {
  it('cliente logado NÃO lê credentials', async () => {
    await seed((db) => setDoc(doc(db, 'credentials', 'clicksign'), { senha: 'segredo' }));
    await assertFails(getDoc(doc(corretor1(), 'credentials', 'clicksign')));
  });
  it('cliente anônimo NÃO lê credentials', async () => {
    await seed((db) => setDoc(doc(db, 'credentials', 'clicksign'), { senha: 'segredo' }));
    await assertFails(getDoc(doc(anon(), 'credentials', 'clicksign')));
  });
  it('nem o admin lê credentials direto (só via Cloud Function)', async () => {
    await seed((db) => setDoc(doc(db, 'credentials', 'clicksign'), { senha: 'segredo' }));
    await assertFails(getDoc(doc(admin(), 'credentials', 'clicksign')));
  });
});

describe('Fichas (fichas e fichas_locador)', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'fichas', 'f1'), { tipo: 'pf', corretorUid: 'corretor1' });
      await setDoc(doc(db, 'fichas_locador', 'l1'), { corretorUid: 'corretor1' });
    });
  });
  it('qualquer um LÊ uma ficha por id (o id é a credencial)', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'fichas', 'f1')));
    await assertSucceeds(getDoc(doc(anon(), 'fichas_locador', 'l1')));
  });
  it('cliente NÃO grava ficha (escrita só via salvarFichaPublica)', async () => {
    await assertFails(setDoc(doc(corretor1(), 'fichas', 'f2'), { tipo: 'pf' }));
    await assertFails(setDoc(doc(anon(), 'fichas', 'f3'), { tipo: 'pf' }));
  });
  it('nem o admin grava ficha direto', async () => {
    await assertFails(setDoc(doc(admin(), 'fichas', 'f1'), { tipo: 'pf', hackeado: true }));
  });
  it('LISTAR fichas só o admin (corretor não varre a coleção)', async () => {
    await assertFails(getDocs(collection(corretor1(), 'fichas')));
    await assertSucceeds(getDocs(collection(admin(), 'fichas')));
  });
});

describe('Imóveis — regra de ouro (leitura por corretorUid)', () => {
  beforeEach(async () => {
    await seed(async (db) => {
      await setDoc(doc(db, 'imoveis', 'imA'), { corretorUid: 'corretor1', endereco: 'A' });
      await setDoc(doc(db, 'imoveis', 'imB'), { corretorUid: 'corretor2', endereco: 'B' });
    });
  });
  it('corretor lê o imóvel DELE', async () => {
    await assertSucceeds(getDoc(doc(corretor1(), 'imoveis', 'imA')));
  });
  it('corretor NÃO lê imóvel de OUTRO corretor', async () => {
    await assertFails(getDoc(doc(corretor1(), 'imoveis', 'imB')));
  });
  it('gestor lê qualquer imóvel', async () => {
    await assertSucceeds(getDoc(doc(gestor(), 'imoveis', 'imB')));
  });
  it('administrativo lê qualquer imóvel', async () => {
    await assertSucceeds(getDoc(doc(adminstv(), 'imoveis', 'imA')));
  });
  it('ninguém grava imóvel pelo cliente — nem o gestor', async () => {
    await assertFails(setDoc(doc(gestor(), 'imoveis', 'imA'), { corretorUid: 'corretor1', preco: 1 }));
    await assertFails(setDoc(doc(corretor1(), 'imoveis', 'imA'), { corretorUid: 'corretor1', preco: 1 }));
  });
});

describe('Negócios (negocios)', () => {
  beforeEach(async () => {
    await seed((db) => setDoc(doc(db, 'negocios', 'ngA'), { corretorUid: 'corretor1', codigo: 'NG-000001' }));
  });
  it('o dono do negócio lê', async () => {
    await assertSucceeds(getDoc(doc(corretor1(), 'negocios', 'ngA')));
  });
  it('o gestor lê', async () => {
    await assertSucceeds(getDoc(doc(gestor(), 'negocios', 'ngA')));
  });
  it('outro corretor NÃO lê', async () => {
    await assertFails(getDoc(doc(corretor2(), 'negocios', 'ngA')));
  });
  it('administrativo NÃO lê o doc CRU (veria comentários internos) — só pela Cloud Function', async () => {
    await assertFails(getDoc(doc(adminstv(), 'negocios', 'ngA')));
  });
  it('escrita sempre negada no cliente', async () => {
    await assertFails(setDoc(doc(gestor(), 'negocios', 'ngA'), { corretorUid: 'corretor1', status: 'x' }));
  });
});

describe('Bloco de notas (user_notes)', () => {
  it('dono grava e lê o próprio bloco', async () => {
    await assertSucceeds(setDoc(doc(testEnv.authenticatedContext('u1').firestore(), 'user_notes', 'u1'), { notas: ['oi'] }));
    await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('u1').firestore(), 'user_notes', 'u1')));
  });
  it('não lê o bloco de OUTRA pessoa', async () => {
    await seed((db) => setDoc(doc(db, 'user_notes', 'u1'), { notas: ['secreto'] }));
    await assertFails(getDoc(doc(testEnv.authenticatedContext('u2').firestore(), 'user_notes', 'u1')));
  });
  it('escrita exige que notas seja LISTA (formato)', async () => {
    await assertFails(setDoc(doc(testEnv.authenticatedContext('u1').firestore(), 'user_notes', 'u1'), { notas: 'texto errado' }));
  });
});

describe('Broadcast de tempo real (config/broadcast)', () => {
  beforeEach(async () => {
    await seed((db) => setDoc(doc(db, 'config', 'broadcast'), { imovelSeq: 1 }));
  });
  it('qualquer logado LÊ o broadcast (onSnapshot)', async () => {
    await assertSucceeds(getDoc(doc(corretor1(), 'config', 'broadcast')));
  });
  it('anônimo NÃO lê', async () => {
    await assertFails(getDoc(doc(anon(), 'config', 'broadcast')));
  });
  it('escrita negada no cliente (só via _bumpBroadcast)', async () => {
    await assertFails(setDoc(doc(corretor1(), 'config', 'broadcast'), { imovelSeq: 999 }));
  });
  it('o RESTO de config/ segue fechado (ex.: config/seguranca)', async () => {
    await seed((db) => setDoc(doc(db, 'config', 'seguranca'), { x: 1 }));
    await assertFails(getDoc(doc(corretor1(), 'config', 'seguranca')));
  });
});

describe('Bloqueio padrão (coleção sem regra explícita)', () => {
  it('coleção aleatória é negada pra leitura', async () => {
    await seed((db) => setDoc(doc(db, 'qualquer_coisa', 'x'), { a: 1 }));
    await assertFails(getDoc(doc(corretor1(), 'qualquer_coisa', 'x')));
  });
});

describe('H-REC AGENDA — regras (papéis via claims role/imobiliariaId)', () => {
  // Contextos por papel do módulo de fotografia.
  const corA = () => testEnv.authenticatedContext('corA', { hrecRole: 'corretor', hrecImob: 'imobA' }).firestore();
  const brokerA = () => testEnv.authenticatedContext('brkA', { hrecRole: 'broker', hrecImob: 'imobA' }).firestore();
  const brokerB = () => testEnv.authenticatedContext('brkB', { hrecRole: 'broker', hrecImob: 'imobB' }).firestore();
  const fotografo = () => testEnv.authenticatedContext('fot1', { hrecRole: 'fotografo' }).firestore();
  const adminHrec = () => testEnv.authenticatedContext('admH', { hrecRole: 'administrador' }).firestore();

  // --- Aceite do Bloco 2: cliente NUNCA escreve em bookings/credits/payments ---
  it('NENHUM cliente escreve em bookings (nem o dono)', async () => {
    await assertFails(setDoc(doc(corA(), 'bookings', 'b1'), { corretorId: 'corA', imobiliariaId: 'imobA' }));
    await assertFails(setDoc(doc(adminHrec(), 'bookings', 'b1'), { corretorId: 'corA' }));
  });
  it('NENHUM cliente escreve em credits nem payments', async () => {
    await assertFails(setDoc(doc(brokerA(), 'credits', 'imobA'), { disponivel: 999 }));
    await assertFails(setDoc(doc(adminHrec(), 'payments', 'p1'), { amount: 1 }));
  });
  it('ninguém escreve nas tabelas de preço (só Cloud Function)', async () => {
    await assertFails(setDoc(doc(adminHrec(), 'pricingTables', 'padrao_hrec'), { nome: 'x' }));
  });

  // --- Catálogo/config: qualquer logado lê; anônimo não ---
  it('logado lê pricingTables/servicosAdicionais/config-agenda; anônimo não', async () => {
    await seed((db) => Promise.all([
      setDoc(doc(db, 'pricingTables', 'padrao_hrec'), { nome: 'Padrão' }),
      setDoc(doc(db, 'servicosAdicionais', 'drone'), { valor: 600 }),
      setDoc(doc(db, 'config', 'agenda'), { limiteDia: 5 }),
    ]));
    await assertSucceeds(getDoc(doc(corA(), 'pricingTables', 'padrao_hrec')));
    await assertSucceeds(getDoc(doc(corA(), 'servicosAdicionais', 'drone')));
    await assertSucceeds(getDoc(doc(corA(), 'config', 'agenda')));
    await assertFails(getDoc(doc(anon(), 'pricingTables', 'padrao_hrec')));
  });

  // --- Bookings: dono / broker da imob / staff ---
  it('corretor lê o PRÓPRIO booking, não o de outro', async () => {
    await seed((db) => Promise.all([
      setDoc(doc(db, 'bookings', 'meu'), { corretorId: 'corA', imobiliariaId: 'imobA' }),
      setDoc(doc(db, 'bookings', 'alheio'), { corretorId: 'corX', imobiliariaId: 'imobA' }),
    ]));
    await assertSucceeds(getDoc(doc(corA(), 'bookings', 'meu')));
    await assertFails(getDoc(doc(corA(), 'bookings', 'alheio')));
  });
  it('broker lê bookings da PRÓPRIA imobiliária, não de outra', async () => {
    await seed((db) => setDoc(doc(db, 'bookings', 'b'), { corretorId: 'corA', imobiliariaId: 'imobA' }));
    await assertSucceeds(getDoc(doc(brokerA(), 'bookings', 'b')));
    await assertFails(getDoc(doc(brokerB(), 'bookings', 'b')));
  });
  it('staff H-REC (fotografo/administrador) lê qualquer booking', async () => {
    await seed((db) => setDoc(doc(db, 'bookings', 'b'), { corretorId: 'corA', imobiliariaId: 'imobA' }));
    await assertSucceeds(getDoc(doc(fotografo(), 'bookings', 'b')));
    await assertSucceeds(getDoc(doc(adminHrec(), 'bookings', 'b')));
  });

  // --- Financeiro: broker da imob e staff; corretor não ---
  it('credits/payments: broker da imob e staff leem; corretor não', async () => {
    await seed((db) => Promise.all([
      setDoc(doc(db, 'credits', 'imobA'), { disponivel: 10 }),
      setDoc(doc(db, 'payments', 'p1'), { imobiliariaId: 'imobA', amount: 100 }),
    ]));
    await assertSucceeds(getDoc(doc(brokerA(), 'credits', 'imobA')));
    await assertSucceeds(getDoc(doc(adminHrec(), 'payments', 'p1')));
    await assertFails(getDoc(doc(corA(), 'credits', 'imobA')));
    await assertFails(getDoc(doc(brokerB(), 'payments', 'p1')));
  });
  it('pricingHistory (auditoria): só staff H-REC lê', async () => {
    await seed((db) => setDoc(doc(db, 'pricingHistory', 'h1'), { tableId: 'padrao_hrec' }));
    await assertSucceeds(getDoc(doc(adminHrec(), 'pricingHistory', 'h1')));
    await assertFails(getDoc(doc(brokerA(), 'pricingHistory', 'h1')));
  });

  it('hrec_notifs: cada um lê SÓ as suas', async () => {
    await seed((db) => Promise.all([
      setDoc(doc(db, 'hrec_notifs', 'n1'), { uid: 'corA', texto: 'sua' }),
      setDoc(doc(db, 'hrec_notifs', 'n2'), { uid: 'outro', texto: 'alheia' }),
    ]));
    await assertSucceeds(getDoc(doc(corA(), 'hrec_notifs', 'n1')));
    await assertFails(getDoc(doc(corA(), 'hrec_notifs', 'n2')));
  });
});
