import { alchemyClient } from './alchemy';
import fs from 'fs';
import { mongoClient } from './mongodb';
import { Order, WithOrderHash, WithSignature } from './server';
import { decodeEventLog } from 'viem';
import seaportABI from './seaport.abi.json';
import erc721ABI from './erc721.abi.json';
import { Log } from 'alchemy-sdk/dist/src/types/types';
import { OrderedBulkOperation, WithId } from 'mongodb';

const FULFILLED_ORDER = '0x9d9af8e38d66c62e2c12f0225249fd9d721c54b83f48d9352c97c6cacdcb6f31';
const CANCELED_ORDER = '0x6bacc01dbe442496068f7d234edd811f1a5f833243e0aec824f86ab861f3c90d';
const INCREMENTED_COUNTER = '0x721c20121297512b72821b97f5326877ea8ecf4bb9948fea5bfcb6453074d37f';
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
// TODO: inactive orders when allowance is revoked

const seaportContract = '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC';

interface Activity {
  etype: string;
  token: string;
  tokenId: string;
  offerer: string;
  fulfiller: string;
  fulfillment: {
    coin?: {
      amount: string;
    };
    token: {
      amount: string;
      identifier: string[];
    };
  };
  txHash: string;
  createdAt: string;
}

let isRunning = false;
async function run() {
  isRunning = true;

  const lastProcessedBlock = Number(fs.readFileSync('src/eventListenerState.txt', 'utf8'));
  const currentBlock = await alchemyClient.core.getBlockNumber();

  if (currentBlock < lastProcessedBlock) {
    isRunning = false;
    return;
  }

  let logs: Log[] = [];

  // TODO: may be processing twice same block (inclusive both sides)
  try {
    logs = await alchemyClient.core.getLogs({
      fromBlock: lastProcessedBlock + 1,
      toBlock: currentBlock,
    });
  } catch (e) {
    console.log(e);
    isRunning = false;
    return;
  }

  console.info(
    `[${new Date().toJSON()}] ${
      logs.length
    } logs in block range ${lastProcessedBlock} -> ${currentBlock}`,
  );

  const orders = await mongoClient
    .db('mongodb')
    .collection<WithSignature<WithOrderHash<Order>>>('orders')
    .find()
    .toArray();

  for (const log of logs) {
    const topic0 = log.topics[0];
    const address = log.address;

    if (log.removed) continue;

    switch (topic0) {
      case FULFILLED_ORDER:
        if (address !== seaportContract) break;
        await processFulfilledOrder(log, { orders });
        break;
      case CANCELED_ORDER:
        if (address !== seaportContract) break;
        await processCanceledOrder(log, { orders });
        break;
      case INCREMENTED_COUNTER:
        if (address !== seaportContract) break;
        await processIncrementedCounter(log, { orders });
        break;
      case TRANSFER:
        await processTransfer(log, { orders });
        break;
      default:
        break;
    }
  }

  fs.writeFileSync('src/eventListenerState.txt', currentBlock.toString());
  isRunning = false;
}

setInterval(async () => {
  if (isRunning) return;

  await run();
}, 12_000);

async function processFulfilledOrder(
  fulfilledOrder: Log,
  { orders }: { orders: WithId<WithSignature<WithOrderHash<Order>>>[] },
) {
  const decodedLog = decodeEventLog({
    abi: seaportABI,
    data: fulfilledOrder.data as `0x${string}`,
    topics: fulfilledOrder.topics as [],
  });

  const args = decodedLog.args as any as {
    orderHash: string;
    recipient: string;
    consideration: { token: string; identifier: bigint }[];
  };
  const orderHash = args.orderHash;
  const activeOrder = orders.find((order) => order.orderHash === orderHash);

  if (!activeOrder) return;

  const txHash = fulfilledOrder.transactionHash;
  const fulfiller = args.recipient;
  const identifier = args.consideration
    .filter((c) => c.token.toLowerCase() == activeOrder.token)
    .map((c) => c.identifier.toString());

  const activity = {
    etype: 'trade',
    token: activeOrder.token,
    tokenId: activeOrder.tokenId,
    offerer: activeOrder.offerer,
    fulfiller,
    fulfillment: {
      token: {
        amount: activeOrder.fulfillmentCriteria.token.amount,
        identifier,
      },
    },
    txHash,
    createdAt: Date.now().toString(),
  } as Activity;

  if (activeOrder.fulfillmentCriteria.coin) {
    activity.fulfillment.coin = activeOrder.fulfillmentCriteria.coin;
  }

  const activityInsertResult = await mongoClient
    .db('mongodb')
    .collection('activity')
    .insertOne(activity)
    .catch((e) => {
      console.log(e);
      throw new Error('?????????');
    });

  const notification = {
    activityId: activityInsertResult.insertedId,
    address: activeOrder.offerer,
  };

  await mongoClient
    .db('mongodb')
    .collection('notification')
    .insertOne(notification)
    .catch((e) => {
      console.log(e);
      throw new Error('?????????');
    });

  // TODO: transaction

  await mongoClient.db('mongodb').collection('orders').deleteOne({ _id: activeOrder._id });

  console.info(`[${new Date().toJSON()}] Processed order: ${orderHash} ✅`);
}

async function processCanceledOrder(
  canceledOrder: Log,
  { orders }: { orders: WithId<WithSignature<WithOrderHash<Order>>>[] },
) {
  const decodedLog = decodeEventLog({
    abi: seaportABI,
    data: canceledOrder.data as `0x${string}`,
    topics: canceledOrder.topics as [],
  });

  const args = decodedLog.args as any as { orderHash: string };
  const orderHash = args.orderHash;
  const activeOrder = orders.find((order) => order.orderHash === orderHash);

  if (!activeOrder) return;

  await mongoClient.db('mongodb').collection('orders').deleteOne({ _id: activeOrder._id });

  console.info(`[${new Date().toJSON()}] Cancelled order: ${orderHash}🔥`);
}

async function processIncrementedCounter(
  incrementedCounter: Log,
  { orders }: { orders: WithId<WithSignature<WithOrderHash<Order>>>[] },
) {
  const decodedLog = decodeEventLog({
    abi: seaportABI,
    data: incrementedCounter.data as `0x${string}`,
    topics: incrementedCounter.topics as [],
  });

  const args = decodedLog.args as any as { offerer: string };
  const offerer = args.offerer;
  const offererActiveOrders = orders.filter((order) => order.offerer === offerer);

  if (offererActiveOrders.length == 0) return;

  await mongoClient.db('mongodb').collection('orders').deleteMany({ offerer });

  for (const offererActiveOrder of offererActiveOrders) {
    console.info(`[${new Date().toJSON()}] Cancelled order: ${offererActiveOrder.orderHash}🔥`);
  }
}

async function processTransfer(
  transfer: Log,
  { orders }: { orders: WithId<WithSignature<WithOrderHash<Order>>>[] },
) {
  if (transfer.topics.length != 4) return;

  const decodedLog = decodeEventLog({
    abi: erc721ABI,
    data: transfer.data as `0x${string}`,
    topics: transfer.topics as [],
  });

  const token = transfer.address.toLowerCase();
  const args = decodedLog.args as any as {
    from: string;
    to: string;
    tokenId: bigint;
  };
  const from = args.from.toLowerCase();
  const to = args.to.toLowerCase();
  const tokenId = args.tokenId.toString();

  const transferedActiveOrders = orders.filter(
    (order) => order.token === token && order.tokenId === tokenId,
  );
  if (transferedActiveOrders.length == 0) return;
  for (const transferedActiveOrder of transferedActiveOrders) {
    const offerer = transferedActiveOrder.offerer;

    // 1. Offerer is transfering out the token with active order: Deactivate order
    if (from == offerer) {
      await mongoClient
        .db('mongodb')
        .collection('orders')
        .updateOne({ _id: transferedActiveOrder._id }, { $set: { isActive: false } });
      console.info(
        `[${new Date().toJSON()}] Inactivated order: ${transferedActiveOrder.orderHash}🔥`,
      );
      continue;
    }

    // 2. Someone is transfering back the token to offerer with inactive order: Activate order
    if (to == offerer) {
      await mongoClient
        .db('mongodb')
        .collection('orders')
        .updateOne({ _id: transferedActiveOrder._id }, { $set: { isActive: true } });
      console.info(
        `[${new Date().toJSON()}] Activated order: ${transferedActiveOrder.orderHash}🔥`,
      );
      continue;
    }
  }
}
