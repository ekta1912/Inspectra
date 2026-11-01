require('dotenv').config();
const { describe, it } = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');

function invokeExpress(app, method, url, body = {}) {
  return new Promise((resolve) => {
    const { Readable } = require('stream');
    const jsonStr = JSON.stringify(body);
    const req = Readable.from([Buffer.from(jsonStr)]);
    req.method = method;
    req.url = url;
    req.headers = {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(jsonStr)
    };

    const res = {
      statusCode: 200,
      headers: {},
      _body: '',
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      getHeader(k) { return this.headers[k.toLowerCase()]; },
      status(code) { this.statusCode = code; return this; },
      send(data) {
        this._body = typeof data === 'object' ? JSON.stringify(data) : String(data);
        resolve(this);
      },
      json(data) {
        this.headers['content-type'] = 'application/json';
        this._body = JSON.stringify(data);
        resolve(this);
      },
      end(data) {
        if (data) this._body = String(data);
        resolve(this);
      }
    };

    app(req, res, (err) => {
      if (err) {
        res.statusCode = 500;
        res._body = err.message;
      }
      resolve(res);
    });
  });
}

describe('Express API Integration Suite', () => {
  it('should return health status on GET /api/health and metadata on GET /', async () => {
    const rootRes = await invokeExpress(app, 'GET', '/');
    assert.strictEqual(rootRes.statusCode, 200);
    const rootJson = JSON.parse(rootRes._body);
    assert.strictEqual(rootJson.name, 'Inspectra API');

    const healthRes = await invokeExpress(app, 'GET', '/api/health');
    assert.strictEqual(healthRes.statusCode, 200);
    const healthJson = JSON.parse(healthRes._body);
    assert.strictEqual(healthJson.status, 'ok');
  });

  it('should preserve Quick Review validation on POST /ai/get-review', async () => {
    const emptyRes = await invokeExpress(app, 'POST', '/ai/get-review', {});
    assert.strictEqual(emptyRes.statusCode, 400);
    assert.ok(emptyRes._body.includes('Code is required'));
  });

  it('should validate repository input on POST /ai/repo-review/start', async () => {
    const emptyRes = await invokeExpress(app, 'POST', '/ai/repo-review/start', {});
    assert.strictEqual(emptyRes.statusCode, 400);

    const invalidRes = await invokeExpress(app, 'POST', '/ai/repo-review/start', {
      repoUrl: 'http://malicious-site.com/repo'
    });
    assert.strictEqual(invalidRes.statusCode, 400);
  });

  it('should list reviews on GET /ai/repo-reviews', async () => {
    const listRes = await invokeExpress(app, 'GET', '/ai/repo-reviews');
    assert.strictEqual(listRes.statusCode, 200);
    const reviews = JSON.parse(listRes._body);
    assert.ok(Array.isArray(reviews));
  });
});
