import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { Alchemy, Network, TransactionReceipt } from 'alchemy-sdk';
import { Db, MongoClient, ObjectId, WithId } from 'mongodb';
import { supportedCollections } from './collections';
import { isValidAddress, isValidObject, isValidString, isValidTokenIds } from './queryValidator';
import { EthereumNetwork, config } from './config';
import winston from 'winston';

const logger = winston.createLogger({
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.colorize(),
    winston.format.printf(
      ({ level, message, timestamp, context }) =>
        `${timestamp} ${level} ${message} ${context ? JSON.stringify(context) : ''}`,
    ),
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: `log/all.log` }),
  ],
});

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

const app = express();

app.use(express.json());
app.use(cors({ origin: '*' }));
app.use((_, res, next) => {
  const json = res.json;

  res.json = function (body?: any) {
    res.locals.error = body.error;
    return json.call(this, body);
  };

  res.locals.startTime = Date.now();
  res.status(404);

  next();
});

app.get('/user/balance/:userAddress', async (req, res, next) => {
  try {
    const balance = (await alchemy.core.getBalance(req.params.userAddress)).toString();

    res.status(200).json({ data: { balance } });
    next();
  } catch (err) {
    next(err);
  }
});

app.get('/tokens/:collection/:userAddress', async (req, res, next) => {
  try {
    const { collection, userAddress } = req.params;
    const { address: contractAddress } = supportedCollections[collection] || {};

    if (!contractAddress) {
      res.status(400).json({ error: 'Collection not supported' });
      next();
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

    res.status(200).json({ data: { tokens } });
    next();
  } catch (err) {
    next(err);
  }
});

app.post('/tokens/:collection', async (req, res, next) => {
  try {
    const { collection: collectionRequest } = req.params;
    const {
      tokenIds: tokenIdsRequest,
      filters,
    }: { tokenIds: string[]; filters: { [attribute: string]: string } } = req.body;

    if (tokenIdsRequest && !isValidTokenIds(tokenIdsRequest)) {
      res.status(400).json({ error: 'invalid `tokenIds` field' });
      next();
      return;
    }

    if (!filters) {
      res.status(400).json({ error: '`filters` field is required' });
      next();
      return;
    }

    if (!isValidObject(filters)) {
      res.status(400).json({ error: 'invalid `filters` field' });
      next();
      return;
    }

    if (!Object.entries(filters).flat().every(isValidString)) {
      res.status(400).json({ error: 'invalid `filters` field' });
      next();
      return;
    }

    const collection = supportedCollections[collectionRequest];
    if (!collection) {
      res.status(400).json({ error: 'collection not supported' });
      next();
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

    res.status(200).json({ data: { tokens: filteredTokenIds } });
    next();
  } catch (err) {
    next(err);
  }
});

app.post('/orders/create/', async (req, res, next) => {
  try {
    const { order } = req.body;

    if (!order) {
      res.status(400).json({ error: 'missing `order` field in request body' });
      next();
      return;
    }

    await client
      .db('mongodb')
      .collection('orders')
      .insertOne({ ...order });

    res.status(200).json({ data: 'Order created' });
    next();
  } catch (err) {
    const dbErrorCode = (err as any).code;

    switch (dbErrorCode) {
      case 11000:
        res.status(400).json({ error: `${req.body.order.tokenId} is listed` });
        next();
        return;
      default:
        next(err);
    }
  }
});

app.post('/orders/list/', async (req, res, next) => {
  try {
    const { tokenIds, collection }: { tokenIds: string[]; collection: string } = req.body;

    if (tokenIds && !isValidTokenIds(tokenIds)) {
      res.status(400).json({ error: 'invalid `tokenIds` field' });
      next();
      return;
    }

    const query: { token: string; tokenId?: object } = { token: collection };

    if (!!tokenIds) {
      query.tokenId = { $in: tokenIds };
    }

    const orders = await client.db('mongodb').collection('orders').find(query).toArray();

    res.status(200).json({ data: { orders } });
    next();
  } catch (err) {
    next(err);
  }
});

app.post('/activity/list/', async (req, res, next) => {
  try {
    const {
      address,
      collection,
      tokenIds,
    }: { address?: string; collection: string; tokenIds?: string[] } = req.body;

    if (address && !isValidAddress(address)) {
      res.status(400).json({ error: 'invalid `address` field' });
      next();
      return;
    }

    if (tokenIds && !isValidTokenIds(tokenIds)) {
      res.status(400).json({ error: 'invalid `tokenIds` field' });
      next();
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

    res.status(200).json({ data: { activities } });
    next();
  } catch (err) {
    next(err);
  }
});

// TODO: add collection + chain on notifications table
app.get('/notifications/:collection/:userAddress', async (req, res, next) => {
  try {
    const { collection, userAddress } = req.params;
    const { address: contractAddress } = supportedCollections[collection] || {};

    if (!contractAddress) {
      res.status(400).json({ error: 'collection not supported' });
      next();
      return;
    }

    const query = { address: userAddress };
    const notifications = await client
      .db('mongodb')
      .collection('notification')
      .find(query)
      .toArray();

    res.status(200).json({ data: { notifications } });
    next();
  } catch (err) {
    next(err);
  }
});

app.post('/notifications/view/', async (req, res, next) => {
  try {
    const { notificationIds }: { notificationIds: string[] } = req.body;

    // TODO: validate input

    const notificationObjectIds = notificationIds.map((id) => new ObjectId(id));

    const query = { _id: { $in: notificationObjectIds } };
    const notifications = await client.db('mongodb').collection('notification').deleteMany(query);

    res.status(200).json({ data: { notifications } });
    next();
  } catch (err) {
    next(err);
  }
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction): void => {
  res.status(500).json({ error: 'Internal server error' });
  next();
  logger.error(err.stack);
});

// Logger
app.use((req, res, next) => {
  const ms = Date.now() - res.locals.startTime;
  const logMessage = `${res.statusCode} ${req.method} ${req.url} (${ms} ms)`;
  const error = res.locals.error;

  if ([200, 304].includes(res.statusCode)) {
    logger.info(logMessage);
  } else if ([500].includes(res.statusCode)) {
    logger.error(logMessage, { context: { error } });
  } else {
    logger.warn(logMessage, { context: { error } });
  }
  next();
});

app.listen(3000, async () => {
  logger.info('Server started');
});
