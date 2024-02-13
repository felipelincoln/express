import express from 'express';
import cors from 'cors';
import { Alchemy, Network, TransactionReceipt } from 'alchemy-sdk';
import { MongoClient, ObjectId } from 'mongodb';
import { supportedCollections } from './collections';
import { isValidObject, isValidOrder, isValidString, isValidTokenIds } from './queryValidator';

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

app.get('/tokens/:collection/:userAddress', async (req, res) => {
  const { collection, userAddress } = req.params;
  const { address: contractAddress } = supportedCollections[collection] || {};

  if (!contractAddress) {
    res.status(400).json({ error: 'Collection not supported' });
    return;
  }

  const nfts = alchemy.nft.getNftsForOwnerIterator(userAddress, {
    contractAddresses: [contractAddress],
    omitMetadata: true,
  });

  let tokens: string[] = [];
  for await (const value of nfts) {
    tokens.push(value.tokenId);
  }

  res.json({ data: { tokens } });
});

app.post('/tokens/:collection', async (req, res) => {
  const { collection: collectionRequest } = req.params;
  const {
    tokenIds: tokenIdsRequest,
    filters,
  }: { tokenIds: string[]; filters: { [attribute: string]: string } } = req.body;

  if (tokenIdsRequest && !isValidTokenIds(tokenIdsRequest)) {
    res.status(400).json({ error: 'invalid `tokenIds` field' });
    return;
  }

  if (!filters) {
    res.status(400).json({ error: '`filters` field is required' });
    return;
  }

  if (!isValidObject(filters)) {
    res.status(400).json({ error: 'invalid `filters` field' });
    return;
  }

  if (!Object.entries(filters).flat().every(isValidString)) {
    res.status(400).json({ error: 'invalid `filters` field' });
    return;
  }

  const collection = supportedCollections[collectionRequest];
  if (!collection) {
    res.status(400).json({ error: 'collection not supported' });
    return;
  }

  const tokenIds = tokenIdsRequest || collection.mintedTokens;
  const filteredTokenIds = tokenIds.filter((tokenId: string) => {
    const metadata = collection.metadata[tokenId];

    for (const [attribute, value] of Object.entries(filters)) {
      if (metadata[attribute] != value) {
        return false;
      }
    }
    return true;
  });

  res.json({ data: { tokens: filteredTokenIds } });
});

app.post('/orders/create/', async (req, res) => {
  console.log({ body: req.body });
  const { order } = req.body;
  if (!order) {
    res.status(400).send('Bad request');
    return;
  }

  if (!isValidOrder(order)) {
    res.status(400).send('Bad Request');
    return;
  }

  // check if order exists for this tokenId

  await client
    .db('mongodb')
    .collection('orders')
    .insertOne({ ...order });

  res.send('created!');
});

app.listen(3000, () => {
  console.log(`⚡️[server]: Server is running at http://localhost:3000`);
});

/// -=--------------------------- to be implemented
/*
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

app.post('/orders/', async (req, res) => {
  const { tokenIds } = req.body;

  if (!tokenIds) {
    res.status(400).send('Error: missing `tokenIds` field in request body.');
    return;
  }

  const orders = await client
    .db('mongodb')
    .collection('orders')
    .find({ tokenId: { $in: tokenIds } })
    .toArray();
  res.json({ data: { orders } });
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

app.post('/orders/cancel/', async (req, res) => {
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

  // validate transaction

  await client
    .db('mongodb')
    .collection<Order>('orders')
    .findOneAndDelete({ _id: new ObjectId(orderId) });
});

app.post('/events/', async (req, res) => {
  const { address }: { address?: string } = req.body;

  if (!!address && !isValidAddress(address)) {
    res.status(400).send('Bad Request');
  }

  const events = await client.db('mongodb').collection<Event>('events').find({ address }).toArray();

  res.json({ data: events });
});

app.post('/notifications/count/', async (req, res) => {
  const { address }: { address: string } = req.body;

  if (!isValidAddress(address)) {
    res.status(400).send('Bad Request');
  }

  const notificationsCount = await client
    .db('mongodb')
    .collection<Notification>('notifications')
    .countDocuments();

  res.json({ data: notificationsCount });
});

app.post('/notifications/view/', async (req, res) => {
  const { address }: { address: string } = req.body;

  if (!isValidAddress(address)) {
    res.status(400).send('Bad Request');
  }

  const notifications = await client
    .db('mongodb')
    .collection<Notification>('notifications')
    .find()
    .toArray();

  await client.db('mongodb').collection<Notification>('notifications').deleteMany();

  res.json({ data: notifications });
});

*/
