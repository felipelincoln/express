import express from 'express';
import cors from 'cors';
import { Alchemy, Network, TransactionReceipt } from 'alchemy-sdk';
import { Db, MongoClient, ObjectId, WithId } from 'mongodb';
import { supportedCollections } from './collections';
import { isValidAddress, isValidObject, isValidString, isValidTokenIds } from './queryValidator';
import { EthereumNetwork, config } from './config';
import winston from 'winston';

const logger = winston.createLogger({
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: `log/all.log` }),
  ],
});

function getRequestMetadata(req: any, res: any, ms: number, info?: {}) {
  return {
    request: {
      method: req.method,
      route: req.route.path,
      params: req.params,
      query: req.query,
      body: req.body,
    },
    response: { status: res.statusCode, ms, info },
  };
}

const app = express();

app.use(express.json());
app.use(cors({ origin: '*' }));

const alchemyNetwork = (() => {
  switch (config.ethereumNetwork) {
    case EthereumNetwork.Mainnet:
      return Network.ETH_MAINNET;
    case EthereumNetwork.Sepolia:
      return Network.ETH_SEPOLIA;
    default:
      throw new Error(`Invalid Ethereum Network: ${config.ethereumNetwork}`);
  }
})();

const alchemy = new Alchemy({
  apiKey: process.env.ALCHEMY_API_KEY,
  network: alchemyNetwork,
});

const mongoDbUri =
  'mongodb+srv://express:unz3JN7zeo5rLK3J@free.ej7kjrx.mongodb.net/?retryWrites=true&w=majority&appName=AtlasApp';

const client = new MongoClient(mongoDbUri);

export type WithSignature<T> = T & { signature: string };
export type WithOrderHash<T> = T & { orderHash: string };

export interface Order {
  token: string;
  tokenId: string;
  offerer: string;
  fulfillmentCriteria: {
    coin?: {
      amount: string;
    };
    token: {
      amount: string;
      identifier: string[];
    };
  };
  endTime: string;
}

app.get('/tokens/:collection/:userAddress', async (req, res) => {
  const startTime = Date.now();
  const { collection, userAddress } = req.params;
  const { address: contractAddress } = supportedCollections[collection] || {};

  if (!contractAddress) {
    res.status(400).json({ error: 'Collection not supported' });
    logger.warn(
      "Failed obtaining user's nfts: Collection not supported",
      getRequestMetadata(req, res, Date.now() - startTime),
    );
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
  logger.info(
    "Successfully obtained user's nfts",
    getRequestMetadata(req, res, Date.now() - startTime),
  );
});

app.post('/tokens/:collection', async (req, res) => {
  const startTime = Date.now();
  const { collection: collectionRequest } = req.params;
  const {
    tokenIds: tokenIdsRequest,
    filters,
  }: { tokenIds: string[]; filters: { [attribute: string]: string } } = req.body;

  if (tokenIdsRequest && !isValidTokenIds(tokenIdsRequest)) {
    res.status(400).json({ error: 'invalid `tokenIds` field' });
    logger.warn(
      "Failed obtaining collection's nfts: invalid `tokenIds` field",
      getRequestMetadata(req, res, Date.now() - startTime),
    );
    return;
  }

  if (!filters) {
    res.status(400).json({ error: '`filters` field is required' });
    logger.warn(
      "Failed obtaining collection's nfts: `filters` field is required",
      getRequestMetadata(req, res, Date.now() - startTime),
    );
    return;
  }

  if (!isValidObject(filters)) {
    res.status(400).json({ error: 'invalid `filters` field' });
    logger.warn(
      "Failed obtaining collection's nfts: invalid `filters` field",
      getRequestMetadata(req, res, Date.now() - startTime),
    );
    return;
  }

  if (!Object.entries(filters).flat().every(isValidString)) {
    res.status(400).json({ error: 'invalid `filters` field' });
    logger.warn(
      "Failed obtaining collection's nfts: invalid `filters` field",
      getRequestMetadata(req, res, Date.now() - startTime),
    );
    return;
  }

  const collection = supportedCollections[collectionRequest];
  if (!collection) {
    res.status(400).json({ error: 'collection not supported' });
    logger.warn(
      "Failed obtaining collection's nfts: collection not supported",
      getRequestMetadata(req, res, Date.now() - startTime),
    );
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
  logger.info(
    "Successfully obtained collection's nfts",
    getRequestMetadata(req, res, Date.now() - startTime),
  );
});

app.post('/orders/create/', async (req, res) => {
  const startTime = Date.now();
  const { order } = req.body;

  if (!order) {
    res.status(400).json({ error: 'missing `order` field in request body' });
    logger.warn(
      'Failed creating order: missing `order` field in request body',
      getRequestMetadata(req, res, Date.now() - startTime),
    );
    return;
  }

  client
    .db('mongodb')
    .collection('orders')
    .insertOne({ ...order })
    .then((result) => {
      res.json({ data: 'Order created' });
      logger.info(
        'Successfully created new order',
        getRequestMetadata(req, res, Date.now() - startTime),
      );
    })
    .catch((err) => {
      switch (err.code) {
        case 11000:
          res.status(400).json({ error: `${order.tokenId} is listed` });
          logger.warn(
            `Failed creating order: ${order.tokenId} is listed`,
            getRequestMetadata(req, res, Date.now() - startTime),
          );
          return;
        default:
          res.status(500).json({ error: 'Internal Server Error' });
          logger.warn(
            'Failed creating order: Internal Server Error',
            getRequestMetadata(req, res, Date.now() - startTime, {
              unhandled_error: { order, err, errInfo: err.errInfo },
            }),
          );
          return;
      }
    });
});

app.post('/orders/list/', async (req, res) => {
  const startTime = Date.now();
  const { tokenIds, collection }: { tokenIds: string[]; collection: string } = req.body;

  if (tokenIds && !isValidTokenIds(tokenIds)) {
    res.status(400).json({ error: 'invalid `tokenIds` field' });
    logger.warn(
      'Failed obtaining list of orders: invalid `tokenIds` field',
      getRequestMetadata(req, res, Date.now() - startTime),
    );
    return;
  }

  const query: { token: string; tokenId?: object } = { token: collection };

  if (!!tokenIds) {
    query.tokenId = { $in: tokenIds };
  }

  const orders = await client.db('mongodb').collection('orders').find(query).toArray();

  res.json({ data: { orders } });
  logger.info(
    'Successfully obtained list of orders',
    getRequestMetadata(req, res, Date.now() - startTime),
  );
});

app.post('/activity/list/', async (req, res) => {
  const startTime = Date.now();
  const {
    address,
    collection,
    tokenIds,
  }: { address?: string; collection: string; tokenIds?: string[] } = req.body;

  if (address && !isValidAddress(address)) {
    res.status(400).json({ error: 'invalid `address` field' });
    logger.warn(
      'Failed obtaining list of activities: invalid `address` field',
      getRequestMetadata(req, res, Date.now() - startTime),
    );
    return;
  }

  if (tokenIds && !isValidTokenIds(tokenIds)) {
    res.status(400).json({ error: 'invalid `tokenIds` field' });
    logger.warn(
      'Failed obtaining list of activities: invalid `tokenIds` field',
      getRequestMetadata(req, res, Date.now() - startTime),
    );
    return;
  }

  const query: { token: string; $or?: Object[]; tokenId?: Object } = { token: collection };

  if (!!address) {
    query.$or = [{ fulfiller: address }, { offerer: address }];
  }

  if (!!tokenIds) {
    query.tokenId = { $in: tokenIds };
  }

  const activities = (
    await client.db('mongodb').collection('activity').find(query).toArray()
  ).reverse();

  res.json({ data: { activities } });
  logger.info(
    'Successfully obtained list of activities',
    getRequestMetadata(req, res, Date.now() - startTime),
  );
});

// TODO: add collection + chain on notifications table
app.get('/notifications/:collection/:userAddress', async (req, res) => {
  const startTime = Date.now();
  const { collection, userAddress } = req.params;
  const { address: contractAddress } = supportedCollections[collection] || {};

  if (!contractAddress) {
    res.status(400).json({ error: 'collection not supported' });
    logger.warn(
      'Failed obtaining list of notifications: collection not supported',
      getRequestMetadata(req, res, Date.now() - startTime),
    );
    return;
  }

  const query = { address: userAddress };
  const notifications = await client.db('mongodb').collection('notification').find(query).toArray();

  res.json({ data: { notifications } });
  logger.info(
    'Successfully obtained list of notifications',
    getRequestMetadata(req, res, Date.now() - startTime),
  );
});

app.post('/notifications/view/', async (req, res) => {
  const startTime = Date.now();
  const { notificationIds }: { notificationIds: string[] } = req.body;

  // TODO: validate input

  const notificationObjectIds = notificationIds.map((id) => new ObjectId(id));

  const query = { _id: { $in: notificationObjectIds } };
  const notifications = await client.db('mongodb').collection('notification').deleteMany(query);

  res.json({ data: { notifications } });
  logger.info(
    'Successfully viewed list of notifications',
    getRequestMetadata(req, res, Date.now() - startTime),
  );
});

app.listen(3000, async () => {
  logger.info('Server started');
  console.log('⚡️[server]: Server is running at http://localhost:3000');
});
