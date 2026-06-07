import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { mkdir } from 'fs/promises';
import path from 'path';

const SUPABASE_URL = 'https://wsfmgkzgkpdahcvrkdwg.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndzZm1na3pna3BkYWhjdnJrZHdnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDY4MTM3NiwiZXhwIjoyMDk2MjU3Mzc2fQ.AtPtN42EHbZphi-re9_DUV8wAszhqdrXm1oPzPFhnhw';
const WEB = 'http://localhost:3000';
const SHOTS_DIR = 'test-screenshots';

const TS = Date.now();
const TEST_EMAIL = `uitest_${TS}@test.com`;
const TEST_PASS = 'TestUI123!';
const ORG_NAME = `Empresa UI ${TS}`;

let pass = 0, fail = 0, step = 0;

function ok(label) { console.log(`  ✓ ${label}`); pass++; }
function ko(label, err='') { console.log(`  ✗ ${label}${err ? '  →  ' + err : ''}`); fail++; }

async function shot(page, name) {
  const file = path.join(SHOTS_DIR, `${String(++step).padStart(2,'0')}_${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`    📸 ${file}`);
}

const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});
let userId = null;

async function cleanup() {
  if (userId) {
    try {
      const { data: members } = await adminClient
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', userId);
      for (const m of (members || [])) {
        await adminClient.from('organizations').delete().eq('id', m.organization_id);
      }
    } catch (e) { /* ignore */ }
    await adminClient.auth.admin.deleteUser(userId).catch(() => {});
    console.log('\n  ✓ Usuário de teste removido');
  }
}

await mkdir(SHOTS_DIR, { recursive: true });

const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
  email: TEST_EMAIL, password: TEST_PASS, email_confirm: true
});
if (createErr) { console.error('Erro ao criar usuário:', createErr.message); process.exit(1); }
userId = created.user.id;
console.log(`\nUsuário de teste: ${TEST_EMAIL}`);

const browser = await chromium.launch({
  headless: false,
  slowMo: 200,
  executablePath: 'C:\\Users\\PC\\AppData\\Local\\ms-playwright\\chromium-1223\\chrome-win64\\chrome.exe'
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

const jsErrors = [];
page.on('console', m => { if (m.type() === 'error') jsErrors.push(m.text()); });
page.on('pageerror', e => jsErrors.push(e.message));

try {

  // ── 1. LOGIN ──────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log('  1. LOGIN');
  console.log('══════════════════════════════════════');

  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
  await shot(page, 'login_page');
  ok('Página de login carregou');

  await page.locator('#email').fill(TEST_EMAIL);
  await page.locator('#password').fill(TEST_PASS);
  await shot(page, 'login_preenchido');
  ok('Campos de email e senha preenchidos');

  await Promise.all([
    page.waitForURL(url => !url.href.includes('/login'), { timeout: 25000 }),
    page.locator('button[type="submit"]').click(),
  ]);

  const afterLoginUrl = page.url();
  console.log(`  → URL após login: ${afterLoginUrl}`);

  if (afterLoginUrl.includes('/inbox')) {
    console.log('  → Em /inbox, aguardando redirect para /onboarding...');
    await page.waitForURL(`${WEB}/onboarding`, { timeout: 15000 }).catch(() => {
      console.log(`  → Timeout aguardando /onboarding, URL: ${page.url()}`);
    });
  }

  console.log(`  → URL final: ${page.url()}`);

  // ── 2. ONBOARDING ─────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log('  2. ONBOARDING');
  console.log('══════════════════════════════════════');

  if (page.url().includes('/onboarding')) {
    ok('Redirecionado para /onboarding');
  } else {
    ko('Esperado /onboarding', `URL: ${page.url()}`);
    await page.goto(`${WEB}/onboarding`, { waitUntil: 'networkidle' });
  }

  await page.waitForTimeout(1000);
  await shot(page, 'onboarding');

  await page.locator('#name').click();
  await page.locator('#name').pressSequentially(ORG_NAME, { delay: 50 });
  await page.waitForTimeout(500);
  await shot(page, 'onboarding_preenchido');
  ok('Nome da organização preenchido');

  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(3000);

  if (page.url().includes('/onboarding')) {
    await page.waitForURL(url => !url.href.includes('/onboarding'), { timeout: 15000 }).catch(() => {});
  }

  console.log(`  → URL após onboarding: ${page.url()}`);

  // ── 3. INBOX ──────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log('  3. INBOX');
  console.log('══════════════════════════════════════');

  if (!page.url().includes('/inbox')) {
    await page.goto(`${WEB}/inbox`, { waitUntil: 'networkidle' });
  }
  await page.waitForTimeout(2000);
  await shot(page, 'inbox');

  page.url().includes('/inbox')
    ? ok('Inbox carregou')
    : ko('Não chegou em /inbox', page.url());

  // ── 4. AGENTES ────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log('  4. AGENTES');
  console.log('══════════════════════════════════════');

  await page.locator('a[href="/agents"]').click();
  await page.waitForURL(`${WEB}/agents`, { timeout: 10000 });
  await page.waitForTimeout(1500);
  await shot(page, 'agents_lista');
  ok('Lista de agentes carregou');

  await page.locator('a[href="/agents/new"]').first().click();
  await page.waitForURL(`${WEB}/agents/new`, { timeout: 10000 });
  await page.waitForTimeout(1000);
  await shot(page, 'agent_novo_form');
  ok('Formulário de novo agente carregou');

  await page.locator('#name').click();
  await page.locator('#name').pressSequentially('Agente UI Teste', { delay: 50 });
  await page.locator('#system_prompt').click();
  await page.locator('#system_prompt').pressSequentially('Você é um assistente de testes automatizados.', { delay: 30 });
  await shot(page, 'agent_preenchido');
  ok('Formulário de agente preenchido');

  await Promise.all([
    page.waitForURL(`${WEB}/agents`, { timeout: 15000 }),
    page.locator('button[type="submit"]').click(),
  ]);
  await page.waitForTimeout(1500);
  await shot(page, 'agents_apos_criacao');
  ok('Agente criado e voltou para lista');

  const agentVisible = await page.locator('text=Agente UI Teste').isVisible({ timeout: 3000 }).catch(() => false);
  agentVisible ? ok('Agente visível na lista') : ko('Agente não apareceu na lista');

  // ── 5. INSTÂNCIAS ─────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log('  5. INSTÂNCIAS (WhatsApp)');
  console.log('══════════════════════════════════════');

  await page.locator('a[href="/instances"]').click();
  await page.waitForURL(`${WEB}/instances`, { timeout: 10000 });
  await page.waitForTimeout(1500);
  await shot(page, 'instances');
  ok('Página de instâncias carregou');

  // ── 6. CONFIGURAÇÕES ──────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log('  6. CONFIGURAÇÕES');
  console.log('══════════════════════════════════════');

  await page.locator('a[href="/settings"]').click();
  await page.waitForURL(`${WEB}/settings`, { timeout: 10000 });
  await page.waitForTimeout(1500);
  await shot(page, 'settings');
  ok('Configurações carregou');

  const firstInputVal = await page.locator('input').first().inputValue().catch(() => '');
  firstInputVal.includes('Empresa UI')
    ? ok(`Nome da org correto: "${firstInputVal}"`)
    : ko('Nome da org incorreto', `recebido: "${firstInputVal}"`);

  // ── 7. TEAM ───────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log('  7. TEAM');
  console.log('══════════════════════════════════════');

  await page.locator('a[href="/team"]').click();
  await page.waitForURL(`${WEB}/team`, { timeout: 10000 });
  await page.waitForTimeout(1500);
  await shot(page, 'team');
  ok('Página de equipe carregou');

  const teamBody = await page.textContent('body').catch(() => '');
  const emailVisible = teamBody.includes('uitest_') || teamBody.includes(TEST_EMAIL);
  emailVisible ? ok('Usuário visível na equipe') : ko('Usuário não apareceu na equipe');

  // ── 8. ERROS JS ───────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log('  8. ERROS DE CONSOLE JS');
  console.log('══════════════════════════════════════');

  const relevant = jsErrors.filter(e =>
    !e.includes('favicon') &&
    !e.includes('403') &&
    !e.includes('404') &&
    !e.includes('400') &&
    !e.includes('hydrat') &&
    !e.includes('ResizeObserver') &&
    !e.includes('non-critical') &&
    !e.includes('Failed to load resource')
  );

  relevant.length === 0
    ? ok('Sem erros JavaScript críticos no console')
    : relevant.forEach(e => ko('Erro JS', e.slice(0, 120)));

} catch (err) {
  ko('Erro inesperado no teste', err.message);
  await shot(page, 'erro_inesperado').catch(() => {});
  console.error(err);
}

await browser.close();
await cleanup();

console.log('\n══════════════════════════════════════');
console.log('  RESULTADO FINAL');
console.log('══════════════════════════════════════');
console.log(`  ✓ PASSOU: ${pass}`);
console.log(`  ✗ FALHOU: ${fail}`);
console.log(`  📁 Screenshots em: ./${SHOTS_DIR}/`);
console.log('');

if (fail === 0) {
  console.log('  ✅ TODOS OS TESTES UI PASSARAM');
} else {
  console.log('  ❌ ALGUNS TESTES FALHARAM');
  process.exit(1);
}
