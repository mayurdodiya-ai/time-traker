// A tiny Express-style router so the API route modules run unchanged inside Next.js route handlers
// (serverless friendly: no listening socket, no global middleware stack — just a function of Request -> Response).

const compile = (path) => {
  const keys = [];
  const src = path.replace(/\/+$/, '').replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'));
  return { re: new RegExp(`^${src}/?$`), keys };
};

/** Runs handlers in order; a handler either responds (res.done) or calls next(err?) to continue. */
async function runChain(fns, req, res) {
  for (const fn of fns) {
    if (res.done) return;
    await new Promise((resolve, reject) => {
      let called = false;
      const next = (err) => { called = true; err ? reject(err) : resolve(); };
      try {
        const r = fn(req, res, next);
        if (r && typeof r.then === 'function') r.then(() => !called && resolve(), reject);
        else if (!called) resolve();
      } catch (e) { reject(e); }
    });
  }
}

class RouterImpl {
  constructor() { this.layers = []; }

  use(a, b) {
    if (typeof a === 'function') this.layers.push({ type: 'mw', fn: a });
    else this.layers.push({ type: 'mount', prefix: a.replace(/\/$/, ''), router: b });
    return this;
  }

  /** Returns true when a route handled the request. */
  async handle(req, res, path) {
    for (const l of this.layers) {
      if (res.done) return true;
      if (l.type === 'mw') await runChain([l.fn], req, res);
      else if (l.type === 'mount') {
        if (path === l.prefix || path.startsWith(`${l.prefix}/`)) {
          if (await l.router.handle(req, res, path.slice(l.prefix.length) || '/')) return true;
        }
      } else if (l.method === req.method) {
        const m = l.re.exec(path);
        if (m) {
          req.params = Object.fromEntries(l.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
          await runChain(l.fns, req, res);
          return true;
        }
      }
    }
    return res.done;
  }
}

for (const m of ["get", "post", "patch", "put", "delete"]) {
  RouterImpl.prototype[m] = function add(path, ...fns) {
    this.layers.push({ type: 'route', method: m.toUpperCase(), ...compile(path === '/' ? '' : path), fns });
    return this;
  };
}

/** Minimal response object with the Express methods the routes use. */
export class Res {
  constructor() { this.statusCode = 200; this.headers = new Headers(); this.body = null; this.done = false; }
  status(c) { this.statusCode = c; return this; }
  setHeader(k, v) { this.headers.set(k, v); return this; }
  json(obj) { this.headers.set('Content-Type', 'application/json; charset=utf-8'); this.body = JSON.stringify(obj); this.done = true; return this; }
  send(s) { this.body = s; this.done = true; return this; }
  toResponse() {
    return new Response([204, 304].includes(this.statusCode) ? null : this.body, { status: this.statusCode, headers: this.headers });
  }
}

/** Callable like Express's `Router()` (with or without `new`). */
export const Router = () => new RouterImpl();
