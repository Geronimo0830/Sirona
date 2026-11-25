import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: 'tests/e2e', workers: 1, timeout: 45000, reporter: [['list'], ['json', { outputFile: `docs/evidence/${process.env.NOVEL_EVIDENCE_NAME??'e2e-results'}.json` }]], use: { trace: 'retain-on-failure' } });
