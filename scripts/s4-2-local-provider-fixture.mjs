import { createServer } from 'node:http';

const portArgument = process.argv.find((value) => value.startsWith('--port='));
const port = Number(portArgument?.slice('--port='.length) ?? '11434');
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('Use an unprivileged loopback port between 1024 and 65535.');
}

const model = 's4.2-local-fixture';
const server = createServer((request, response) => {
  if (request.method !== 'GET' || request.url !== '/v1/models') {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'not_found' }));
    return;
  }
  const body = JSON.stringify({ data: [{ id: model, object: 'model' }] });
  response.writeHead(200, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(
    `S4.2 loopback fixture listening on http://127.0.0.1:${port}/v1 (model: ${model}).\n` +
      'Press Ctrl+C to stop.\n'
  );
});
