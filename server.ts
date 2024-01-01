import express from 'express';
import cors from 'cors';
import { Alchemy, Network, TransactionReceipt } from 'alchemy-sdk';
import { MongoClient, ObjectId, Transaction } from 'mongodb';
import { decodeAbiParameters, parseAbiParameters } from 'viem';

const app = express();

app.use(express.json());
app.use(cors({ origin: '*' }));

const alchemy = new Alchemy({
  apiKey: process.env.ALCHEMY_API_KEY,
  network: Network.ETH_MAINNET,
});

const mongoDbUri =
  'mongodb+srv://express:unz3JN7zeo5rLK3J@free.ej7kjrx.mongodb.net/?retryWrites=true&w=majority&appName=AtlasApp';

const client = new MongoClient(mongoDbUri);

interface Order {
  tokenId: string;
  offerer: string;
  fulfillmentCriteria: {
    coin: {
      amount: string;
    };
    token: {
      amount: string;
      identifier: string[];
      identifierDescription: string;
    };
  };
  endTime: string;
  signature?: string;
}

interface Event {
  etype: string;
  tokenId: string;
  offerer: string;
  fulfiller: string;
  fulfillment: {
    coin: {
      amount: string;
    };
    token: {
      amount: string;
      identifier: string[];
    };
  };
  txn_hash: string;
  block_hash: string;
  block_height: number;
  created_at: number;
}

interface Notification {
  eventId: string;
  address: string;
}

function isValidTokenIds(tokenIds: any): boolean {
  if (!Array.isArray(tokenIds)) {
    return false;
  }

  if (
    !tokenIds.every((tokenId) => {
      return isValidTokenId(tokenId);
    })
  ) {
    return false;
  }

  return true;
}

function isValidTokenId(tokenId: any): boolean {
  return typeof tokenId === 'string';
}

function isValidOrderId(orderId: any): boolean {
  return typeof orderId === 'string';
}

function isValidTxnHash(txnHash: any): boolean {
  return typeof txnHash === 'string';
}

function isValidAddress(address: string): boolean {
  return typeof address === 'string';
}

function createEvent(transaction: TransactionReceipt): Event | undefined {
  const event: Event = {
    block_hash: transaction.blockHash,
    block_height: transaction.blockNumber,
    txn_hash: transaction.transactionHash,
    tokenId: '1',
    offerer: '0x0000000000000000000000000000000000000000',
    fulfiller: '0x0000000000000000000000000000000000000000',
    fulfillment: {
      coin: {
        amount: '0',
      },
      token: {
        amount: '1',
        identifier: ['1'],
      },
    },
    created_at: Date.now(),
    etype: 'trade',
  };

  return event;
}

app.get('/healthcheck/', async (req, res) => {
  await client.db('mongodb').command({ ping: 1 });
  await client.close();
  // validate alchemy
  // return message when error
  res.send('OK');
});

app.get('/tokens/:user', async (req, res) => {
  const { user } = req.params;
  const nfts = alchemy.nft.getNftsForOwnerIterator(user, {
    contractAddresses: ['0x1ddb32a082c369834b57473dd3a5146870ecf8b7'],
    omitMetadata: true,
  });

  let tokens: string[] = [];
  for await (const value of nfts) {
    tokens.push(value.tokenId);
  }

  res.json({ data: { tokens } });
});

app.post('/orders/', async (req, res) => {
  const { tokenIds }: { tokenIds: string[] } = req.body;

  if (!isValidTokenIds(tokenIds)) {
    res.status(400).send('Bad Request');
  }

  const orders = await client
    .db('mongodb')
    .collection('orders')
    .find({ tokenId: { $in: tokenIds } })
    .toArray();

  res.json({ data: orders });
});

// delete order if invalid
app.post('/orders/fulfill/', async (req, res) => {
  const { txnHash, orderId }: { txnHash: string; orderId: string } = req.body;

  if (!isValidTxnHash(txnHash) || !isValidOrderId(orderId)) {
    res.status(400).send('Bad Request');
    return;
  }

  console.log({ txnHash });

  const transaction = await (await alchemy.transact.getTransaction(txnHash))?.wait(1);

  if (!transaction) {
    res.status(400).send('Bad Request');
    return;
  }

  const event = createEvent(transaction);

  if (!event) {
    res.status(400).send('Bad Request');
    return;
  }

  const order = await client
    .db('mongodb')
    .collection<Order>('orders')
    .findOne({ _id: new ObjectId(orderId) });

  if (!order) {
    res.status(400).send('Bad Request');
    return;
  }

  if (order.tokenId != event.tokenId || order.offerer != event.offerer) {
    res.status(400).send('Bad Request');
    return;
  }

  console.log('/orders/fulfill/');
  console.log({ order, event });

  await client.db('mongodb').collection('orders').deleteOne(order._id);
  const { insertedId: eventObjectId } = await client
    .db('mongodb')
    .collection('events')
    .insertOne(event);

  const notificationOfferer: Notification = {
    address: event.offerer,
    eventId: eventObjectId.toString(),
  };

  const notificationFulfiller: Notification = {
    address: event.fulfiller,
    eventId: eventObjectId.toString(),
  };

  await client
    .db('mongodb')
    .collection('notifications')
    .insertMany([notificationFulfiller, notificationOfferer]);

  res.json({ data: { success: true } });
});

app.post('/events/', async (req, res) => {
  const { address }: { address: string } = req.body;

  if (!isValidAddress(address)) {
    res.status(400).send('Bad Request');
  }

  const events = await client.db('mongodb').collection<Event>('events').find({ address }).toArray();

  res.json({ data: events });
});

// ----------------------

app.post('/order/create', async (req, res) => {
  console.log({ body: req.body });
  const { tokenId, message, signature } = req.body;
  if (!tokenId || !message || !signature) {
    res.status(400).send('Bad request');
    return;
  }

  await client
    .db('mongodb')
    .collection('orders')
    .insertOne({ tokenId, order: { message, signature } });

  res.send('created!');
});

app.listen(3000, () => {
  console.log(`⚡️[server]: Server is running at http://localhost:3000`);
});
