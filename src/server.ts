import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { Alchemy, Network } from 'alchemy-sdk';
import { MongoClient, ObjectId } from 'mongodb';
import {
  isValidAddress,
  isValidNumber,
  isValidObject,
  isValidString,
  isValidTokenIds,
} from './queryValidator';
import { EthereumNetwork, config } from './config';
import winston from 'winston';
import { isAddress } from 'viem';
import moment from 'moment';
import { alchemyClient } from './alchemy';

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

const mongoDbUri = 'mongodb://localhost:27017';
//'mongodb+srv://express:unz3JN7zeo5rLK3J@free.ej7kjrx.mongodb.net/?retryWrites=true&w=majority&appName=AtlasApp';

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

interface Collection {
  name: string;
  symbol: string;
  image: string;
  contract: string;
  totalSupply: string;
  attributeSummary: Record<string, { attribute: string; options: Record<string, string> }>;
}

interface Token {
  collection_id: ObjectId;
  tokenId: number;
  image?: string;
  attributes: Record<string, string>;
}

interface TokenIdWithImage {
  tokenId: number;
  image?: string;
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

app.post('/jsonrpc', async (req, res, next) => {
  try {
    const { method, params, id, jsonrpc } = req.body;
    const result = await alchemy.core.send(method, params);

    res.status(200).json({ jsonrpc, id, result });
    next();
  } catch (err) {
    next(err);
  }
});

app.get('/collection/:contract', async (req, res, next) => {
  const { contract } = req.params;

  console.log(isAddress(contract));

  try {
    const collection = await client
      .db('mongodb')
      .collection<Collection>('collection')
      .findOne({ contract });

    if (collection) {
      const tokensCount = await client
        .db('mongodb')
        .collection('token')
        .countDocuments({ collection_id: collection._id });

      const isReady = tokensCount == Number(collection.totalSupply);

      res.status(200).json({ data: { collection, isReady: isReady } });
      next();
      return;
    }

    const metadata = await alchemyClient.nft.getContractMetadata(contract);
    if (metadata.tokenType != 'ERC721') {
      res.status(400).json({ error: 'only ERC721 tokens are supported' });
      next();
      return;
    }

    const attributes = await alchemyClient.nft.summarizeNftAttributes(contract);
    const attributeSummaryList = [];

    for (const [k, v] of Object.entries(attributes.summary)) {
      const options = Object.keys(v);
      attributeSummaryList.push({
        attribute: k,
        options: Object.fromEntries(Object.entries(options)),
      });
    }

    const newCollection = {
      name: metadata.name,
      symbol: metadata.symbol,
      image: metadata.openSeaMetadata?.imageUrl,
      contract,
      totalSupply: metadata.totalSupply,
      attributeSummary: Object.fromEntries(Object.entries(attributeSummaryList)),
    };

    await client.db('mongodb').collection('collection').insertOne(newCollection);

    res.status(200).json({ data: { collection: newCollection, isReady: false } });
    next();
  } catch (err) {
    next(err);
  }
});

app.get('/eth/tokens/:contract/:userAddress', async (req, res, next) => {
  try {
    const { contract, userAddress } = req.params;

    const collection = await client
      .db('mongodb')
      .collection<Collection>('collection')
      .findOne({ contract });

    if (!collection) {
      res.status(400).json({ error: 'collection not supported' });
      next();
      return;
    }

    const nfts = alchemy.nft.getNftsForOwnerIterator(userAddress, {
      contractAddresses: [contract],
      omitMetadata: true,
    });

    let tokenIds: number[] = [];
    for await (const { tokenId } of nfts) {
      tokenIds.push(Number(tokenId));
    }

    const tokens = await client
      .db('mongodb')
      .collection<Token>('token')
      .find({ collection_id: collection._id, tokenId: { $in: tokenIds } })
      .toArray();

    res.status(200).json({ data: { tokens } });
    next();
  } catch (err) {
    next(err);
  }
});

app.post('/tokens/:contract', async (req, res, next) => {
  try {
    const { contract } = req.params;
    const {
      tokenIds: tokenIdsRequest,
      filters,
      limit,
      skip,
    }: {
      tokenIds: string[];
      filters: Record<string, string>;
      limit?: number;
      skip?: number;
    } = req.body;

    if (tokenIdsRequest && !isValidTokenIds(tokenIdsRequest)) {
      res.status(400).json({ error: 'invalid `tokenIds` field' });
      next();
      return;
    }

    if (limit && !isValidNumber(limit)) {
      res.status(400).json({ error: 'invalid `limit` field' });
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

    const collection = await client
      .db('mongodb')
      .collection<Collection>('collection')
      .findOne({ contract });

    if (!collection) {
      res.status(400).json({ error: 'collection not supported' });
      next();
      return;
    }

    Object.keys(filters).forEach((key) => {
      filters['attributes.' + key] = filters[key];
      delete filters[key];
    });

    const query: Record<string, any> = { collection_id: collection._id, ...filters };

    if (!!tokenIdsRequest) {
      query.tokenId = { $in: tokenIdsRequest };
    }

    const filteredTokenIds = await client
      .db('mongodb')
      .collection<Token>('token')
      .find(query, { sort: { tokenId: 1 }, limit, skip })
      .toArray();

    const count = await client.db('mongodb').collection<Token>('token').countDocuments(query);

    res.status(200).json({ data: { tokens: filteredTokenIds, limit, skip, count } });
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

    const query = { token: order.token, tokenId: order.tokenId };
    const existingOrder = await client.db('mongodb').collection<Order>('orders').findOne(query);
    if (existingOrder) {
      const hasExpired = moment.unix(Number(existingOrder.endTime)).isBefore(moment());
      if (hasExpired) {
        await client.db('mongodb').collection('orders').deleteOne({ _id: existingOrder._id });
      }
    }

    await client.db('mongodb').collection('orders').insertOne(order);

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

app.post('/orders/list/:contract', async (req, res, next) => {
  try {
    const { tokenIds, offerer }: { tokenIds?: string[]; offerer?: string } = req.body;
    const { contract } = req.params;

    const collection = await client
      .db('mongodb')
      .collection<Collection>('collection')
      .findOne({ contract });

    if (!collection) {
      res.status(400).json({ error: 'collection not supported' });
      next();
      return;
    }

    if (tokenIds && !isValidTokenIds(tokenIds)) {
      res.status(400).json({ error: 'invalid `tokenIds` field' });
      next();
      return;
    }

    if (offerer && !isValidAddress(offerer)) {
      res.status(400).json({ error: 'invalid `offerer` field' });
      next();
      return;
    }

    let allowed = { allowed: { $ne: false } };
    let transferred = { transferred: { $ne: true } };
    let tokenQuery = { token: contract };
    let query: { $and: any[] } = { $and: [tokenQuery, allowed, transferred] }; // TODO: and is not needed!

    if (!!offerer) {
      let offererQuery = { offerer: offerer };
      query.$and.push(offererQuery);
    }

    if (!!tokenIds) {
      let tokenIdQuery = { tokenId: { $in: tokenIds.map((t) => t.toString()) } }; // TODO: toString is a workaround
      query.$and.push(tokenIdQuery);
    }

    const orders = await client.db('mongodb').collection<Order>('orders').find(query).toArray();
    const notExpiredOrders = orders.filter((order) => {
      const endTime = moment.unix(Number(order.endTime));
      return endTime.isAfter(moment());
    });

    res.status(200).json({ data: { orders: notExpiredOrders } });
    next();
  } catch (err) {
    next(err);
  }
});

app.post('/activities/list/:contract', async (req, res, next) => {
  try {
    const { address, tokenIds }: { address?: string; tokenIds?: string[] } = req.body;
    const { contract } = req.params;

    const collection = await client
      .db('mongodb')
      .collection<Collection>('collection')
      .findOne({ contract });

    if (!collection) {
      res.status(400).json({ error: 'collection not supported' });
      next();
      return;
    }

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

    let tokenQuery = { token: contract };
    let query: { $and: any[] } = { $and: [tokenQuery] };

    if (!!address) {
      let addressQuery = { $or: [{ fulfiller: address }, { offerer: address }] };
      query.$and.push(addressQuery);
    }

    if (!!tokenIds) {
      let tokenIdQuery = { tokenId: { $in: tokenIds.map((t) => t.toString()) } };
      query.$and.push(tokenIdQuery);
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
app.get('/notifications/list/:contract/:userAddress', async (req, res, next) => {
  try {
    const { contract, userAddress } = req.params;

    const collection = await client
      .db('mongodb')
      .collection<Collection>('collection')
      .findOne({ contract });

    if (!collection) {
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
