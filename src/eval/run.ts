import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Module } from '@nestjs/common';
import { AiModule } from '@nestjs/ai';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { modelFromEnv } from '../llm.js';
import { PROMPT_VERSION } from '../orders/extraction.prompt.js';
import { ExtractionService } from '../orders/extraction.service.js';
import { evaluateCase } from './evaluate.js';
import {
  summarize,
  type CaseResult,
  type EvalCase,
  type Summary,
} from './score.js';

const DATASET_DIR = path.resolve('eval/dataset');
const RESULTS_DIR = path.resolve('eval/results');

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AiModule.forRootAsync({
      isGlobal: true,
      useFactory: () => ({
        models: { default: modelFromEnv() },
        defaults: { timeout: '30s', retry: { attempts: 3 } },
      }),
    }),
  ],
  providers: [ExtractionService],
})
class EvalModule {}

async function loadCases(): Promise<EvalCase[]> {
  const files = (await readdir(DATASET_DIR))
    .filter((file) => file.endsWith('.json'))
    .sort();
  return Promise.all(
    files.map(
      async (file) =>
        JSON.parse(
          await readFile(path.join(DATASET_DIR, file), 'utf8'),
        ) as EvalCase,
    ),
  );
}

/** Dollars for the whole run, from the per-million-token prices in the environment. */
function cost(summary: Summary): number | null {
  const inputPrice = Number(process.env.PRICE_INPUT_PER_MTOK);
  const outputPrice = Number(process.env.PRICE_OUTPUT_PER_MTOK);
  if (!inputPrice || !outputPrice) return null;
  return (
    (summary.inputTokens * inputPrice + summary.outputTokens * outputPrice) /
    1_000_000
  );
}

function report(summary: Summary, results: CaseResult[]): string {
  const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
  const list = (ids: string[]) => (ids.length ? ids.join(', ') : 'none');
  const runCost = cost(summary);
  const wrong = results.flatMap((result) =>
    result.fields
      .filter((field) => !field.correct)
      .map(
        (field) =>
          `| ${result.id} | ${field.field} | ${JSON.stringify(field.expected)} | ${JSON.stringify(field.actual)} | ${result.status} |`,
      ),
  );

  return `# Eval results

Model: ${process.env.LLM_PROVIDER}/${process.env.LLM_MODEL} · prompt ${PROMPT_VERSION} · ${new Date().toISOString()}

| Metric | Result |
|---|---|
| Emails | ${summary.cases} |
| Schema-valid answers | ${percent(summary.schemaValidRate)} |
| Order / not-an-order correct | ${percent(summary.classificationAccuracy)} |
| Field accuracy | ${percent(summary.fieldAccuracy)} (${summary.fieldsScored} fields) |
| Orders with every field right | ${summary.exactOrders} of ${summary.ordersScored} |
| **Silent failures** (wrong and auto-accepted) | **${summary.silentFailures.length}**: ${list(summary.silentFailures)} |
| Wrong but held by the gate | ${summary.caughtByGate.length}: ${list(summary.caughtByGate)} |
| Correct but held anyway | ${summary.unneededReviews.length}: ${list(summary.unneededReviews)} |
| Latency p50 / p95 | ${summary.latencyP50Ms} ms / ${summary.latencyP95Ms} ms |
| Tokens in / out | ${summary.inputTokens} / ${summary.outputTokens} |
| Cost per 1,000 emails | ${runCost === null ? 'set PRICE_INPUT_PER_MTOK and PRICE_OUTPUT_PER_MTOK' : `$${((runCost / summary.cases) * 1000).toFixed(2)}`} |

## Every wrong field

| Case | Field | Expected | Got | Gate status |
|---|---|---|---|---|
${wrong.length ? wrong.join('\n') : '| none | | | | |'}
`;
}

const app = await NestFactory.createApplicationContext(EvalModule, {
  logger: ['error', 'warn'],
});
const extraction = app.get(ExtractionService);
const cases = await loadCases();
const results: CaseResult[] = [];
// One at a time on purpose: latency numbers measured under parallel load would not be comparable.
for (const testCase of cases) {
  results.push(
    await evaluateCase(testCase, (email) => extraction.extract(email)),
  );
  process.stdout.write('.');
}
await app.close();

const summary = summarize(results);
const markdown = report(summary, results);
await mkdir(RESULTS_DIR, { recursive: true });
const stamp = `${PROMPT_VERSION}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
await writeFile(path.join(RESULTS_DIR, `${stamp}.md`), markdown);
await writeFile(
  path.join(RESULTS_DIR, `${stamp}.json`),
  JSON.stringify({ summary, results }, null, 2),
);
console.log(`\n${markdown}`);
