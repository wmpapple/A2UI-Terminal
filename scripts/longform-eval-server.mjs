// Optional local evaluation helper. Uses only synthetic fixtures, never product credentials.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import {
  pipeline,
  env,
  TextStreamer,
  InterruptableStoppingCriteria,
} from '../logs/m5b-model/node_modules/@huggingface/transformers/dist/transformers.node.mjs';

const revision = 'cc6a06a21d614e9b8e92a6adfab1074d4e7d2438';
const modelId = 'onnx-community/Qwen3-1.7B-ONNX';
const root = path.resolve('logs/m6-model');
const model = path.join(root, 'model');
await fs.mkdir(path.join(model, 'onnx'), { recursive: true });
for (const file of [
  'config.json',
  'generation_config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'special_tokens_map.json',
  'onnx/model_q4.onnx',
]) {
  const destination = path.join(model, file);
  try {
    await fs.access(destination);
  } catch {
    console.log(`Downloading pinned evaluation file: ${file}`);
    execFileSync(
      'curl.exe',
      [
        '--fail',
        '--location',
        '--silent',
        '--show-error',
        '--max-time',
        '900',
        `https://hf-mirror.com/${modelId}/resolve/${revision}/${file}`,
        '-o',
        `${destination}.part`,
      ],
      { windowsHide: true, stdio: 'inherit' }
    );
    await fs.rename(`${destination}.part`, destination);
  }
}
const modelSha256 = createHash('sha256')
  .update(await fs.readFile(path.join(model, 'onnx/model_q4.onnx')))
  .digest('hex');
assert.equal(
  modelSha256,
  '3763020b62164be3d9c31dc6b15aa042052f5a9da846e991f6c45e0f1a6dced7',
  'Evaluation model differs from the pinned artifact'
);
env.allowRemoteModels = false;
const generator = await pipeline('text-generation', model, {
  dtype: 'q4',
  local_files_only: true,
  session_options: { intraOpNumThreads: 4, interOpNumThreads: 1 },
});
const metadata = {
  model: modelId,
  revision,
  modelSha256,
  runtime: '@huggingface/transformers@3.8.1',
  remoteInference: false,
};
let busy = false;
let requests = 0;
const server = http.createServer(async (req, res) => {
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ...metadata, requests }));
    return;
  }
  if (busy) {
    res.writeHead(429).end();
    return;
  }
  busy = true;
  const stopping = new InterruptableStoppingCriteria();
  res.on('close', () => stopping.interrupt());
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const prompt = generator.tokenizer.apply_chat_template(body.messages, {
      tokenize: false,
      add_generation_prompt: true,
      enable_thinking: false,
    });
    res.setHeader('Content-Type', 'text/event-stream');
    res.flushHeaders();
    const started = performance.now();
    const streamer = new TextStreamer(generator.tokenizer, {
      skip_prompt: true,
      skip_special_tokens: true,
      callback_function: (content) => {
        if (!res.destroyed)
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
      },
    });
    await generator(prompt, {
      max_new_tokens: 1800,
      do_sample: false,
      return_full_text: false,
      streamer,
      stopping_criteria: stopping,
    });
    requests++;
    console.log(JSON.stringify({ request: requests, elapsedMs: performance.now() - started }));
    if (!res.destroyed) res.end('data: [DONE]\n\n');
  } catch (error) {
    console.error(String(error));
    if (!res.headersSent) res.writeHead(500);
    res.end();
  } finally {
    busy = false;
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
await fs.writeFile(
  path.join(root, 'ready.json'),
  JSON.stringify({ ...metadata, endpoint }, null, 2)
);
console.log(`Longform evaluation ready: ${endpoint}`);
async function close() {
  server.closeAllConnections();
  server.close();
  await generator.dispose();
  process.exit(0);
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
