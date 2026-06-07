import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { mkdir } from 'fs/promises';
import path from 'path';

const SUPABASE_URL = 'https://wsfmgkzgkpdahcvrkdwg.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndzZm1na3pna3BkYWhjdnJrZHdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2ODEzNzYsImV4cCI6MjA5NjI1NzM3Nn0.kJ32lCwqHErJUdt0LtSSvTm3kNJBSLXvkhTrxgTtWvw';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndzZm1na3pna3BkYWhjdnJrZHdnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDY4MTM3NiwiZXhwIjoyMDk2MjU3Mzc2fQ.AtPtN42EHbZphi-re9_DUV8wAszhqdrXm1oPzPFhnhw';
const WEB = 'http://localhost:3000';
const SHOTS_DIR = 'test-screenshots';

const TS = Date.now();
const TEST_EMAIL = `uitest_${TS}@test.com`;
const TEST_PASS = 'TestUI123!';

let pass = 0, fail = 0;

function ok(label) { console.log(`  ✓ ${label}`); pass++; }
function ko(label, err='') { console.log(`  ✗ ${label}${err ? '  →  ' + err : ''}`); fail++; }

async function shot(page, name) {
  const file = path.join(SHOTS_DIR, `${String(pass+fail).padStart(2,'0')}_${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`    📸 ${file}`);
}

const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
let userId = null;

async function cleanup() {
  if (userId) {
    await adminClient.auth.admin.deleteUser(userId).catch(() => {});
    console.log('\n  ✓ Usuário de teste removido');
  }
}

await mkdir(SHOTS_DIR, { recursive: true });

// Create test user
const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
  email: TEST_EMAIL, password: TEST_PASS, email_confirm: true
});
if (createErr) { console.error('Erro ao criar usuário:', createErr.message); process.exit(1); }
userId = created.user.id;
console.log(`\nUsuário de teste: ${TEST_EMAIL} (${userId})`);

const browser = await chromium.launch({ headless: false, slowMo: 300 });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();

// Captura erros de console
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(e.message));

try {

  // ── 1. PÁGINA DE LOGIN ────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log('  1. LOGIN');
  console.log('══════════════════════════════════════');

  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
  await shot(page, 'login_page');
  ok('Página de login carregou');

  await page.fill('input[type="email"]', TEST_EMAIL);
  await page.fill('input[type="password"]', TEST_PASS);
  await shot(page, 'login_preenchido');
  ok('Campos de login preenchidos');

  await page.click('button[type="submit"]');

  // ── 2. ONBOARDING ─────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log('  2. ONBOARDING');
  console.log('══════════════════════════════════════');

  await page.waitForURL(`${WEB}/onboarding`, { timeout: 15000 });
  ok('Redirecionou para /onboarding');
  await shot(page, 'onboarding');

  await page.fill('input[id="name"]', 'Empresa Teste UI');
  await shot(page, 'onboarding_preenchido');
  ok('Nome da organização preenchido');

  await page.click('button[type="submit"]');

  // ── 3. INBOX ──────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log('  3. INBOX');
  console.log('══════════════════════════════════════');

  await page.waitForURL(`${WEB}/inbox`, { timeout: 15000 });
  ok('Redirecionou para /inbox');
  await page.waitForTimeout(2000); // aguarda hidratação
  await shot(page, 'inbox');
  ok('Inbox renderizou');

  // ── 4. AGENTES ────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log('  4. AGENTES');
  console.log('══════════════════════════════════════');

  await page.click('a[href="/agents"]');
  await page.waitForURL(`${WEB}/agents`, { timeout: 10000 });
  await page.waitForTimeout(1500);
  await shot(page, 'agents_lista');
  ok('Página de agentes carregou');

  // Criar novo agente
  await page.click('a[href="/agents/new"]');
  await page.waitForURL(`${WEB}/agents/new`, { timeout: 10000 });
  await page.waitForTimeout(1000);
  await shot(page, 'agent_novo');
  ok('Página de novo agente carregou');

  await page.fill('input[id="name"]', 'Agente UI Teste');
  await page.fill('textarea[id="system_prompt"]', 'Você é um assistente de testes automatizados.');
  await shot(page, 'agent_preenchido');
  ok('Formulário de agente preenchido');

  await page.click('button[type="submit"]');
  await page.waitForURL(`${WEB}/agents`, { timeout: 10000 });
  await page.waitForTimeout(1500);
  await shot(page, 'agents_apos_criacao');
  ok('Agente criado → voltou para lista');

  // ── 5. INSTÂNCIAS ─────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log('  5. INSTÂNCIAS');
  console.log('══════════════════════════════════════');

  await page.click('a[href="/instances"]');
  await page.waitForURL(`${WEB}/instances`, { timeout: 10000 });
  await page.waitForTimeout(1500);
  await shot(page, 'instances');
  ok('Página de instâncias carregou');

  // ── 6. CONFIGURAÇÕES ──────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log('  6. CONFIGURAÇÕES');
  console.log('══════════════════════════════════════');

  await page.click('a[href="/settings"]');
  await page.waitForURL(`${WEB}/settings`, { timeout: 10000 });
  await page.waitForTimeout(1500);
  await shot(page, 'settings');
  ok('Página de configurações carregou');

  // Verificar que o nome da org aparece
  const orgName = await page.inputValue('input').catch(() => null);
  if (orgName && orgName.includes('Empresa Teste')) {
    ok('Nome da organização correto no campo');
  } else {
    ko('Nome da organização no campo', `recebido: "${orgName}"`);
  }

  // ── 7. TEAM ───────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log('  7. TEAM');
  console.log('══════════════════════════════════════');

  await page.click('a[href="/team"]');
  await page.waitForURL(`${WEB}/team`, { timeout: 10000 });
  await page.waitForTimeout(1500);
  await shot(page, 'team');
  ok('Página de equipe carregou');

  // Verificar que o email do usuário aparece na lista
  const teamText = await page.textContent('body');
  if (teamText.includes(TEST_EMAIL) || teamText.includes('owner') || teamText.includes('Owner')) {
    ok('Email/role do usuário visível na equipe');
  } else {
    ko('Email do usuário não encontrado na equipe');
  }

  // ── 8. LOGOUT ─────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log('  8. LOGOUT');
  console.log('══════════════════════════════════════');

  // Tentar encontrar botão de logout
  const logoutBtn = page.locator('button:has-text("Sair"), button:has-text("Logout"), [data-testid="logout"]').first();
  if (await logoutBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await logoutBtn.click();
    await page.waitForURL(`${WEB}/login`, { timeout: 10000 });
    await shot(page, 'logout');
    ok('Logout realizado → voltou para /login');
  } else {
    console.log('  ℹ Botão de logout não localizado via seletor — checando erros de console');
  }

  // Erros de console acumulados
  const jsErrors = errors.filter(e =>
    !e.includes('favicon') && !e.includes('404') && !e.includes('hydrat')
  );
  if (jsErrors.length === 0) {
    ok('Sem erros JavaScript no console');
  } else {
    ko(`${jsErrors.length} erro(s) JS no console`, jsErrors.slice(0, 3).join(' | '));
  }

} catch (err) {
  ko('Erro inesperado', err.message);
  await shot(page, 'erro').catch(() => {});
}

await browser.close();
await cleanup();

console.log('\n══════════════════════════════════════');
console.log('  RESULTADO');
console.log('══════════════════════════════════════');
console.log(`  ✓ PASSOU: ${pass}`);
console.log(`  ✗ FALHOU: ${fail}`);
console.log(`  📁 Screenshots: ./${SHOTS_DIR}/`);
if (fail === 0) {
  console.log('\n  ✅ TODOS OS TESTES UI PASSARAM\n');
} else {
  console.log('\n  ❌ ALGUNS TESTES FALHARAM\n');
  process.exit(1);
}
