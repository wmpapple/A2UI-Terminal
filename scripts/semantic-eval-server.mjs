// Optional evaluation tool, not shipped in the desktop app. Only synthetic evals
// call this loopback server. Dependencies/models live under ignored logs/.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import {
  pipeline,
  env,
} from '../logs/m5b-model/node_modules/@huggingface/transformers/dist/transformers.node.mjs';

const revision = '2c4055b12046f11709e9df2c122e59ffbdc2f900';
const root = path.resolve('logs/m5b-model');
const model = path.join(root, 'model');
await fs.mkdir(path.join(model, 'onnx'), { recursive: true });
for (const file of [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'onnx/model_quantized.onnx',
]) {
  const destination = path.join(model, file);
  try {
    await fs.access(destination);
  } catch {
    execFileSync(
      'curl.exe',
      [
        '--fail',
        '--location',
        '--silent',
        '--show-error',
        '--max-time',
        '240',
        `https://hf-mirror.com/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/${revision}/${file}`,
        '-o',
        `${destination}.part`,
      ],
      { windowsHide: true, stdio: 'inherit' }
    );
    await fs.rename(`${destination}.part`, destination);
  }
}
const modelSha256 = createHash('sha256')
  .update(await fs.readFile(path.join(model, 'onnx/model_quantized.onnx')))
  .digest('hex');
assert.equal(
  modelSha256,
  '66fc00f5f29afcaff34092e1bdd20008ca3918265a82fb9695a551e510cc4ebc',
  'Evaluation model differs from the pinned artifact'
);
env.allowRemoteModels = false;
const extractor = await pipeline('feature-extraction', model, {
  dtype: 'q8',
  local_files_only: true,
  session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
});
let requests = 0;
const server = http.createServer(async (req, res) => {
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ model: 'multilingual-minilm', revision, modelSha256, requests }));
    return;
  }
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const start = performance.now();
    const output = await extractor(body.input, { pooling: 'mean', normalize: true });
    requests++;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        data: output.tolist().map((embedding, index) => ({ index, embedding })),
        inferenceMs: performance.now() - start,
      })
    );
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(error) }));
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
await fs.writeFile(
  path.join(root, 'ready.json'),
  JSON.stringify(
    {
      endpoint,
      revision,
      modelSha256,
      model: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
      runtime: '@huggingface/transformers@3.8.1',
      remoteInference: false,
    },
    null,
    2
  )
);
console.log(`Embedding evaluation server ready: ${endpoint}`);
async function close() {
  server.closeAllConnections();
  server.close();
  await extractor.dispose();
  process.exit(0);
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
