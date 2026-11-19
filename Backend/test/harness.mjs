// Test harness for the platform modules: a throwaway single-node Mongo
// replica set (mongodb-memory-server) plus the real Express app on a random
// port. Each test file calls start(), runs its checks, then stop().
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

export const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/// Import a backend module by its path relative to Backend/.
export const imp = (rel) => import(pathToFileURL(path.join(BACKEND, rel)).href);

let failures = 0;
export const check = (label, cond, extra) => {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}`, extra === undefined ? '' : JSON.stringify(extra).slice(0, 400));
  }
};

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export const start = async () => {
  const rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = rs.getUri();
  process.env.MONGODB_DB_NAME = 'test';
  process.env.JWT_SECRET = 'test-secret';
  process.env.NODE_ENV = 'test';
  const { connectDatabase } = await imp('src/config/database.js');
  await connectDatabase();
  const { createApp } = await imp('src/app.js');
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const call = async (method, urlPath, { token, body, headers = {} } = {}) => {
    const res = await fetch(base + urlPath, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  };
  const mongoose = (await import('mongoose')).default;
  const stop = async () => {
    server.close();
    await mongoose.disconnect();
    await rs.stop();
    console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
    process.exit(failures ? 1 : 0);
  };
  return { call, stop, mongoose, base };
};

export const adminToken = async (mongoose, { subadmin = false, permissions = [] } = {}) => {
  const { signAccessToken } = await imp('src/modules/taxi/services/tokenService.js');
  const { Admin } = await imp('src/modules/taxi/admin/models/Admin.js');
  const { insertedId } = await Admin.collection.insertOne({
    name: subadmin ? 'Sub' : 'Root',
    email: `${Math.random()}@t.io`,
    role: subadmin ? 'subadmin' : 'superadmin',
    admin_type: subadmin ? 'subadmin' : 'superadmin',
    permissions,
    active: true,
    status: 'active',
  });
  return signAccessToken({ sub: String(insertedId), role: 'admin' });
};
