import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { Alchemy, Network, TransactionReceipt } from 'alchemy-sdk';
import { Db, MongoClient, ObjectId, WithId } from 'mongodb';
import { supportedCollections } from './collections';
import { isValidAddress, isValidObject, isValidString, isValidTokenIds } from './queryValidator';
import { EthereumNetwork, config } from './config';
import winston from 'winston';
import { MethodNotFoundRpcError } from 'viem';

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

app.get('/eth/tokens/:collection/:userAddress', async (req, res, next) => {
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

app.post('/orders/list/:collection', async (req, res, next) => {
  try {
    const { tokenIds }: { tokenIds?: string[] } = req.body;
    const { collection } = req.params;
    const { address: contractAddress } = supportedCollections[collection] || {};

    if (!contractAddress) {
      res.status(400).json({ error: 'Collection not supported' });
      next();
      return;
    }

    if (tokenIds && !isValidTokenIds(tokenIds)) {
      res.status(400).json({ error: 'invalid `tokenIds` field' });
      next();
      return;
    }

    let tokenQuery = { token: contractAddress };
    let query: {} = tokenQuery;

    if (!!tokenIds) {
      query = { $and: [tokenQuery, { tokenId: { $in: tokenIds } }] };
    }

    const orders = await client.db('mongodb').collection('orders').find(query).toArray();

    res.status(200).json({ data: { orders } });
    next();
  } catch (err) {
    next(err);
  }
});

app.post('/activities/list/:collection', async (req, res, next) => {
  try {
    const { address, tokenIds }: { address?: string; tokenIds?: string[] } = req.body;
    const { collection } = req.params;
    const { address: contractAddress } = supportedCollections[collection] || {};

    if (!contractAddress) {
      res.status(400).json({ error: 'Collection not supported' });
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

    let tokenQuery = { token: contractAddress };
    let query: { $and: any[] } = { $and: [tokenQuery] };

    if (!!address) {
      let addressQuery = { $or: [{ fulfiller: address }, { offerer: address }] };
      query.$and.push(addressQuery);
    }

    if (!!tokenIds) {
      let tokenIdQuery = { tokenId: { $in: tokenIds } };
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
app.get('/notifications/list/:collection/:userAddress', async (req, res, next) => {
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

/*
  await client.db('mongodb').createCollection('orders', {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: false,
        required: [
          '_id',
          'tokenId',
          'token',
          'offerer',
          'endTime',
          'signature',
          'orderHash',
          'fulfillmentCriteria',
        ],
        properties: {
          _id: { bsonType: 'objectId' },
          tokenId: {
            bsonType: 'string',
            description: "'tokenId' is required (string)",
          },
          token: {
            bsonType: 'string',
            description: "'token' is required (string)",
          },
          offerer: {
            bsonType: 'string',
            description: "'offerer' is required (string)",
          },
          endTime: {
            bsonType: 'string',
            description: "'endTime' is required (string)",
          },
          signature: {
            bsonType: 'string',
            description: "'signature' is required (string)",
          },
          orderHash: {
            bsonType: 'string',
            description: "'orderHash' is required (string)",
          },
          fulfillmentCriteria: {
            bsonType: 'object',
            additionalProperties: false,
            description: "'fulfillmentCriteria' is required (object)",
            required: ['token'],
            properties: {
              coin: {
                bsonType: 'object',
                additionalProperties: false,
                description: "'coin' is required (object)",
                required: ['amount'],
                properties: {
                  amount: {
                    bsonType: 'string',
                    description: "'amount' is required (string)",
                  },
                },
              },
              token: {
                bsonType: 'object',
                additionalProperties: false,
                description: "'token' is required (object)",
                required: ['amount', 'identifier'],
                properties: {
                  amount: {
                    bsonType: 'string',
                    description: "'amount' is required (string)",
                  },
                  identifier: {
                    bsonType: 'array',
                    description: "'identifier' is required (array)",
                    items: {
                      bsonType: 'string',
                      description: "'identifier' is required (string)",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  await client.db('mongodb').createCollection('activity', {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: false,
        required: [
          '_id',
          'etype',
          'tokenId',
          'token',
          'offerer',
          'fulfiller',
          'fulfillment',
          'txHash',
          'createdAt',
        ],
        properties: {
          _id: { bsonType: 'objectId' },
          etype: {
            bsonType: 'string',
            enum: ['trade'],
            description: "'tokenId' is required (string)",
          },
          tokenId: {
            bsonType: 'string',
            description: "'tokenId' is required (string)",
          },
          token: {
            bsonType: 'string',
            description: "'token' is required (string)",
          },
          offerer: {
            bsonType: 'string',
            description: "'offerer' is required (string)",
          },
          fulfiller: {
            bsonType: 'string',
            description: "'fulfiller' is required (string)",
          },
          txHash: {
            bsonType: 'string',
            description: "'TxHash' is required (string)",
          },
          createdAt: {
            bsonType: 'string',
            description: "'createdAt' is required (string)",
          },
          fulfillment: {
            bsonType: 'object',
            additionalProperties: false,
            description: "'fulfillment' is required (object)",
            required: ['token'],
            properties: {
              coin: {
                bsonType: 'object',
                additionalProperties: false,
                description: "'coin' is required (object)",
                required: ['amount'],
                properties: {
                  amount: {
                    bsonType: 'string',
                    description: "'amount' is required (string)",
                  },
                },
              },
              token: {
                bsonType: 'object',
                additionalProperties: false,
                description: "'token' is required (object)",
                required: ['amount', 'identifier'],
                properties: {
                  amount: {
                    bsonType: 'string',
                    description: "'amount' is required (string)",
                  },
                  identifier: {
                    bsonType: 'array',
                    description: "'identifier' is required (array)",
                    items: {
                      bsonType: 'string',
                      description: "'identifier' is required (string)",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  await client.db('mongodb').createCollection('notification', {
    validator: {
      $jsonSchema: {
        bsonType: 'object',
        additionalProperties: false,
        required: ['_id', 'activityId', 'address'],
        properties: {
          _id: { bsonType: 'objectId' },
          activityId: {
            bsonType: 'objectId',
            description: "'activityId' is required (string)",
          },
          address: {
            bsonType: 'string',
            description: "'address' is required (string)",
          },
        },
      },
    },
  });
  await client
    .db('mongodb')
    .collection('orders')
    .createIndex({ token: 1, tokenId: 1 }, { unique: true });
  await client.db('mongodb').collection('activity').createIndex({ txHash: 1 }, { unique: true });
  await client
    .db('mongodb')
    .collection('notification')
    .createIndex({ activityId: 1 }, { unique: true });
*/
