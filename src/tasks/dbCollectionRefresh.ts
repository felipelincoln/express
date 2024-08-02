import { db, dbClient } from '../db';
import { lowerCaseAddress } from '../eth';
import { createLogger } from '../log';

const logger = createLogger();
const contract = process.argv[2] as string | undefined;

async function run() {
  if (!contract) {
    logger.error('contract address is required');
    return;
  }

  const lowerCaseContract = lowerCaseAddress(contract);
  const collectionDelete = await db.collection.deleteOne({ contract: lowerCaseContract });

  if (collectionDelete.deletedCount === 0) {
    logger.warn('collection not found');
    return;
  }

  logger.info('collection deleted');

  const tokensDelete = await db.token(lowerCaseContract).drop();
  if (tokensDelete) {
    logger.info('tokens deleted');
  }
}

run().then(() => dbClient.close());
