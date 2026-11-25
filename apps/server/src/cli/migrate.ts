import { loadConfig } from '../config.js';
import { createDatabase, migrateToLatest } from '../db/database.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = createDatabase(config.db);
  try {
    await migrateToLatest(db);

    console.log(`迁移完成（${config.db.driver}）`);
  } finally {
    await db.destroy();
  }
}

main().catch((err) => {

  console.error(err);
  process.exit(1);
});
