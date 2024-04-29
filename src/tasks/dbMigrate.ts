import { dbMigrate, dbClient } from '../db';

(async () => {
  await dbMigrate();
  await dbClient.close();
  console.log('Successfully migrated db.');
})();
