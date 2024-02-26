import { alchemyClient } from './alchemy';
import fs from 'fs';
import { mongoClient } from './mongodb';
import { Order, WithOrderHash, WithSignature } from './server';
import { decodeEventLog } from 'viem';
import seaportABI from './seaport.abi.json';

interface Event {
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

  const lastProcessedBlock = Number(fs.readFileSync('src/transferListenerState.txt', 'utf8'));

  const fulfilledOrders = await alchemyClient.core.getLogs({
    address: '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC',
    topics: ['0x9d9af8e38d66c62e2c12f0225249fd9d721c54b83f48d9352c97c6cacdcb6f31'],
    fromBlock: lastProcessedBlock + 1,
    toBlock: 'latest',
  });

  console.info(
    `[${new Date().toJSON()}] Found ${fulfilledOrders.length} new OrderFulfilled events`,
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

    const args = decodedLog.args as {
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

    const event = {
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
    } as Event;

    if (activeOrder.fulfillmentCriteria.coin) {
      event.fulfillment.coin = activeOrder.fulfillmentCriteria.coin;
    }

    const eventInsertResult = await mongoClient
      .db('mongodb')
      .collection('event')
      .insertOne(event)
      .catch((e) => {
        console.log(e);
        throw new Error('?????????');
      });

    const notification = {
      eventId: eventInsertResult.insertedId,
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

    console.info(`[${new Date().toJSON()}] Processed order: ${orderHash}🔥`);
  }
  if (fulfilledOrders.length > 0) {
    const newLastProcessedBlock = fulfilledOrders[fulfilledOrders.length - 1].blockNumber;
    fs.writeFileSync('src/transferListenerState.txt', newLastProcessedBlock.toString());
  }
  isRunning = false;
}

setInterval(async () => {
  if (isRunning) return;

  await run();
}, 12_000);
