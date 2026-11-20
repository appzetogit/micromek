/**
 * Create (or reset the password of) a super admin.
 *
 *   node scripts/createAdmin.js admin@example.com "Admin Name"
 *
 * The password is typed at the prompt (not echoed, never on the command line,
 * so it stays out of shell history and `ps`). Uses MONGODB_URI / MONGODB_DB_NAME
 * from .env.
 */
import readline from 'node:readline';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { Admin } from '../src/modules/taxi/admin/models/Admin.js';
import { hashPassword } from '../src/modules/taxi/services/passwordService.js';

const askHidden = (question) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.startsWith(question)) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });

const run = async () => {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  const name = String(process.argv[3] || 'Super Admin').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error('Usage: node scripts/createAdmin.js <email> ["Name"]');
    process.exit(1);
  }
  const password = await askHidden('Password: ');
  const confirm = await askHidden('Repeat password: ');
  if (password !== confirm) throw new Error('Passwords do not match');
  if (password.length < 8) throw new Error('Use at least 8 characters');

  await mongoose.connect(env.mongoUri, { dbName: env.mongoDbName, autoIndex: false });
  const hashed = await hashPassword(password);
  const existing = await Admin.findOne({ email });
  if (existing) {
    await Admin.updateOne({ _id: existing._id }, { $set: { password: hashed, active: true, status: 'active' } });
    console.log(`Password reset for ${email} in ${env.mongoDbName}`);
  } else {
    await Admin.collection.insertOne({
      name,
      email,
      password: hashed,
      role: 'superadmin',
      admin_type: 'superadmin',
      permissions: ['*'],
      read_only: false,
      active: true,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log(`Super admin ${email} created in ${env.mongoDbName}`);
  }
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
