import { test, expect } from '@playwright/test';
import { hasPlaywrightCredentials } from './fixtures/env';
import { getOperations, openOperation, saveEvidence } from './fixtures/test-data';

test.skip(() => !hasPlaywrightCredentials() || !getOperations().CANCELLED?.trim(), 'Credenciais ou CANCELLED_OPERATION_URL ausentes.');
test.beforeEach(async ({ page }) => openOperation(page, getOperations().CANCELLED));

test('D03-001 estado e fluxo cancelados', async ({ page }, info) => {
  await expect(page.locator('[aria-labelledby="summary-heading"]')).toContainText('Cancelada');
  await expect(page.locator('.ec-operation-flow').getByRole('status')).toHaveText('Operação Cancelada');
  await saveEvidence(page.locator('.ec-operation-flow'), 'cancelled-after.png', info);
});

test('D03-002 sem CTA de contratacao', async ({ page }) => {
  const flow = page.locator('[aria-labelledby="operation-flow-heading"]');
  await expect(flow.getByRole('button', { name: /contratar|contratação|completar equipe/i })).toHaveCount(0);
  await expect(flow.getByRole('link', { name: /contratar|contratação|completar equipe/i })).toHaveCount(0);
  await expect(flow.getByRole('link')).toHaveCount(2);
});

test('D03-003 historico e motivo acessiveis', async ({ page }) => {
  const flow = page.locator('.ec-operation-flow');
  for (const name of ['Consultar histórico', 'Revisar motivo']) {
    const link = flow.getByRole('link', { name, exact: true });
    await expect(link).toHaveAttribute('href', '#timeline-heading');
    await link.click();
    await expect(page.locator('#timeline-heading')).toBeInViewport();
  }
  await expect(page.locator('[aria-labelledby="timeline-heading"]')).toContainText(/cancelad|encerrad|ocorrência/i);
});

test('D03-004 orienta encerrar acompanhamento sem mutacao', async ({ page }) => {
  await expect(page.locator('.ec-operation-flow')).toContainText('Encerrar acompanhamento');
  await expect(page.locator('.ec-operation-flow')).toContainText('sem reiniciar as etapas');
});

test('D03-005 sem narrativa de contratacao ou etapa ativa', async ({ page }) => {
  const flow = page.locator('[aria-labelledby="operation-flow-heading"]');
  await expect(flow).not.toContainText(/Aguardando contratação|Acompanhar contratação|Contrate (um )?profissional/i);
  await expect(flow.locator('[aria-current="step"]')).toHaveCount(0);
  await expect(page.locator('[aria-labelledby="continuation-heading"]')).toContainText('sem reiniciar');
});
