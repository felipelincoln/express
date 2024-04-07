import { alchemyClient } from './alchemy';
import fs from 'fs';
import { mongoClient } from './mongodb';
import { Order, WithOrderHash, WithSignature } from './server';
import { decodeEventLog } from 'viem';
import seaportABI from './seaport.abi.json';
import { Db } from 'mongodb';
import { Log } from 'alchemy-sdk';

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

  let fulfilledOrders = [];
  let cancelledOrders = [];
  let incrementedCounters = [];

  try {
    fulfilledOrders = await alchemyClient.core.getLogs({
      address: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC',
      topics: ['0x9d9af8e38d66c62e2c12f0225249fd9d721c54b83f48d9352c97c6cacdcb6f31'],
      fromBlock: lastProcessedBlock + 1,
      toBlock: 'latest',
    });

    cancelledOrders = await alchemyClient.core.getLogs({
      address: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC',
      topics: ['0x6bacc01dbe442496068f7d234edd811f1a5f833243e0aec824f86ab861f3c90d'],
      fromBlock: lastProcessedBlock + 1,
      toBlock: 'latest',
    });

    incrementedCounters = await alchemyClient.core.getLogs({
      address: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC',
      topics: ['0x721c20121297512b72821b97f5326877ea8ecf4bb9948fea5bfcb6453074d37f'],
      fromBlock: lastProcessedBlock + 1,
      toBlock: 'latest',
    });
  } catch (e) {
    console.log(e);
    isRunning = false;
    return;
  }

  if (
    fulfilledOrders.length == 0 &&
    cancelledOrders.length == 0 &&
    incrementedCounters.length == 0
  ) {
    isRunning = false;
    return;
  }

  console.info(
    `[${new Date().toJSON()}] Found ${fulfilledOrders.length} new OrderFulfilled events`,
  );

  console.info(
    `[${new Date().toJSON()}] Found ${cancelledOrders.length} new OrderCancelled events`,
  );

  console.info(
    `[${new Date().toJSON()}] Found ${incrementedCounters.length} new CounterIncremented events`,
  );

  const activeOrders = await mongoClient
    .db('mongodb')
    .collection<WithSignature<WithOrderHash<Order>>>('orders')
    .find()
    .toArray();

  for (const fulfilledOrder of fulfilledOrders) {
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
    const activeOrder = activeOrders.find((order) => order.orderHash === orderHash);

    if (!activeOrder) continue;

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

  for (const cancelledOrder of cancelledOrders) {
    const decodedLog = decodeEventLog({
      abi: seaportABI,
      data: cancelledOrder.data as `0x${string}`,
      topics: cancelledOrder.topics as [],
    });

    const args = decodedLog.args as any as { orderHash: string };
    const orderHash = args.orderHash;
    const activeOrder = activeOrders.find((order) => order.orderHash === orderHash);

    if (!activeOrder) continue;

    await mongoClient.db('mongodb').collection('orders').deleteOne({ _id: activeOrder._id });

    console.info(`[${new Date().toJSON()}] Cancelled order: ${orderHash}🔥`);
  }

  for (const incrementedCounter of incrementedCounters) {
    const decodedLog = decodeEventLog({
      abi: seaportABI,
      data: incrementedCounter.data as `0x${string}`,
      topics: incrementedCounter.topics as [],
    });

    const args = decodedLog.args as any as { offerer: string };
    const offerer = args.offerer;
    const offererActiveOrders = activeOrders.filter((order) => order.offerer === offerer);

    if (offererActiveOrders.length == 0) continue;

    await mongoClient.db('mongodb').collection('orders').deleteMany({ offerer });

    for (const offererActiveOrder of offererActiveOrders) {
      console.info(`[${new Date().toJSON()}] Cancelled order: ${offererActiveOrder.orderHash}🔥`);
    }
  }

  if (fulfilledOrders.length > 0 || cancelledOrders.length > 0 || incrementedCounters.length > 0) {
    const lastProcessedOrder = fulfilledOrders[fulfilledOrders.length - 1] as Log | undefined;
    const lastCancelledOrder = cancelledOrders[cancelledOrders.length - 1] as Log | undefined;
    const lastIncrementedCounter = incrementedCounters[incrementedCounters.length - 1] as
      | Log
      | undefined;

    const newLastBlock = Math.max(
      lastProcessedOrder?.blockNumber || 0,
      lastCancelledOrder?.blockNumber || 0,
      lastIncrementedCounter?.blockNumber || 0,
    );
    fs.writeFileSync('src/eventListenerState.txt', newLastBlock.toString());
  }
  isRunning = false;
}

setInterval(async () => {
  if (isRunning) return;

  await run();
}, 12_000);
