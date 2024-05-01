import express, { NextFunction, Request, Response } from 'express';
import { createLogger } from './log';
import cors from 'cors';
import { alchemyClient, lowerCaseAddress } from './eth';
import { isAddress } from 'viem';
import { DbCollection, DbOrder, DbToken, db } from './db';
import moment from 'moment';
import { ObjectId } from 'mongodb';

const logger = createLogger('log/all.log');
const app = express();

app.use(express.json());
app.use(cors({ origin: '*' }));
app.use((_, res, next) => {
  const json = res.json;

  res.json = function (body?: any) {
    res.locals.error = body.error;
    return json.call(this, body);
  };

  res.locals.startTime = moment.now();
  res.status(404);

  next();
});

app.post('/jsonrpc', async (req, res, next) => {
  try {
    const { method, params, id, jsonrpc } = req.body;
    const result = await alchemyClient.core.send(method, params);

    res.status(200).json({ jsonrpc, id, result });
    next();
  } catch (err) {
    next(err);
  }
});

app.get('/collections/get/:contract', async (req, res, next) => {
  const { contract } = req.params;

  if (!isAddress(contract)) {
    res.status(400).json({ error: 'invalid `contract`' });
    next();
    return;
  }

  const lowerCaseContract = lowerCaseAddress(contract);

  try {
    const collection = await db
      .collection<DbCollection>('collection')
      .findOne({ contract: lowerCaseContract }, { projection: { _id: 0 } });

    if (collection) {
      const tokensCount = await db
        .collection('token')
        .countDocuments({ contract: lowerCaseContract });

      const isReady = tokensCount == collection.totalSupply;

      if (isReady) {
        const tokens = await db
          .collection<DbToken>('token')
          .find(
            { contract: lowerCaseContract },
            { projection: { _id: 0, contract: 0, attributes: 0 } },
          )
          .toArray();

        // TODO: remove baseURL
        const tokenImages = Object.fromEntries(tokens.map((t) => [t.tokenId, t.image]));

        res.status(200).json({ data: { collection, isReady: isReady, tokenImages } });
        next();
        return;
      }

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

    if (Number(metadata.totalSupply) > 11000) {
      logger.warn(`[${lowerCaseContract}] has supply of ${metadata.totalSupply}`);
      res.status(400).json({ error: 'this contract is not supported yet' });
      next();
      return;
    }

    if (
      !metadata.totalSupply ||
      !metadata.name ||
      !metadata.symbol ||
      !metadata.openSeaMetadata?.imageUrl
    ) {
      logger.warn(`[${lowerCaseContract}] has missing fields.`, { context: { metadata } });
      res.status(400).json({ error: 'this contract is not supported yet' });
      next();
      return;
    }

    const attributes = await alchemyClient.nft.summarizeNftAttributes(contract);
    const attributeSummaryList = [];

    if (!attributes.summary || Object.keys(attributes.summary).length == 0) {
      logger.warn(`[${lowerCaseContract}] is missing attributes summary.`, {
        context: { attributes },
      });
      res.status(400).json({ error: 'this contract is not supported yet' });
      next();
      return;
    }

    for (const [k, v] of Object.entries(attributes.summary)) {
      const options = Object.keys(v);
      options.sort();
      attributeSummaryList.push({
        attribute: k,
        options: Object.fromEntries(Object.entries(options)),
      });
    }

    attributeSummaryList.sort((a, b) => a.attribute.localeCompare(b.attribute));

    const newCollection: DbCollection = {
      name: metadata.name,
      symbol: metadata.symbol,
      image: metadata.openSeaMetadata?.imageUrl,
      contract: lowerCaseContract,
      totalSupply: Number(metadata.totalSupply),
      attributeSummary: Object.fromEntries(Object.entries(attributeSummaryList)),
    };

    await db.collection('collection').insertOne(newCollection);

    res.status(200).json({ data: { collection: newCollection, isReady: false } });
    next();
  } catch (err) {
    next(err);
  }
});

app.get('/eth/tokens/list/:contract/:userAddress', async (req, res, next) => {
  try {
    const { contract, userAddress } = req.params;

    if (!isAddress(contract)) {
      res.status(400).json({ error: 'invalid `contract`' });
      next();
      return;
    }

    if (!isAddress(userAddress)) {
      res.status(400).json({ error: 'invalid `userAddress`' });
      next();
      return;
    }

    const lowerCaseContract = lowerCaseAddress(contract);

    const collection = await db
      .collection<DbCollection>('collection')
      .findOne({ contract: lowerCaseContract });

    if (!collection) {
      res.status(400).json({ error: 'collection not supported' });
      next();
      return;
    }

    const nfts = alchemyClient.nft.getNftsForOwnerIterator(userAddress, {
      contractAddresses: [contract],
      omitMetadata: true,
    });

    let tokenIds: number[] = [];
    for await (const { tokenId } of nfts) {
      tokenIds.push(Number(tokenId));
    }

    res.status(200).json({ data: { tokenIds } });
    next();
  } catch (err) {
    next(err);
  }
});

app.post('/tokens/list/:contract', async (req, res, next) => {
  try {
    const { contract } = req.params;
    const {
      tokenIds: tokenIdsRequest,
      attributes,
      limit,
      skip,
    }: {
      tokenIds: string[];
      attributes: Record<string, string>;
      limit?: number;
      skip?: number;
    } = req.body;

    if (!isAddress(contract)) {
      res.status(400).json({ error: 'invalid `contract`' });
      next();
      return;
    }

    if (tokenIdsRequest && !isValidNumberArray(tokenIdsRequest)) {
      res.status(400).json({ error: 'invalid `tokenIds` field' });
      next();
      return;
    }

    if (limit && !isValidNumber(limit)) {
      res.status(400).json({ error: 'invalid `limit` field' });
      next();
      return;
    }

    if (skip && !isValidNumber(skip)) {
      res.status(400).json({ error: 'invalid `skip` field' });
      next();
      return;
    }

    if (attributes && !isValidObject(attributes)) {
      res.status(400).json({ error: 'invalid `attributes` field' });
      next();
      return;
    }

    const lowerCaseContract = lowerCaseAddress(contract);

    const collection = await db
      .collection<DbCollection>('collection')
      .findOne({ contract: lowerCaseContract });

    if (!collection) {
      res.status(400).json({ error: 'collection not supported' });
      next();
      return;
    }

    Object.keys(attributes).forEach((key) => {
      attributes['attributes.' + key] = attributes[key];
      delete attributes[key];
    });

    const query: Record<string, any> = { contract: lowerCaseContract, ...attributes };

    if (!!tokenIdsRequest) {
      query.tokenId = { $in: tokenIdsRequest };
    }

    const filteredTokenIds = await db
      .collection<DbToken>('token')
      .find(query, { sort: { tokenId: 1 }, limit, skip })
      .toArray();

    const count = await db.collection<DbToken>('token').countDocuments(query);

    res.status(200).json({ data: { tokens: filteredTokenIds, limit, skip, count } });
    next();
  } catch (err) {
    next(err);
  }
});

app.post('/orders/create/', async (req, res, next) => {
  try {
    const { order }: { order: DbOrder } = req.body;

    if (!order) {
      res.status(400).json({ error: 'missing `order` field in request body' });
      next();
      return;
    }

    if (!isValidObject(order)) {
      res.status(400).json({ error: 'invalid `order` field' });
      next();
      return;
    }

    const query = { contract: order.contract, tokenId: order.tokenId };
    const existingOrder = await db.collection<DbOrder>('order').findOne(query);
    if (existingOrder) {
      const hasExpired = moment.unix(Number(existingOrder.endTime)).isBefore(moment());
      if (hasExpired) {
        await db.collection('order').deleteOne({ _id: existingOrder._id });
      }
    }

    const { contract, offerer, fee } = order;
    await db.collection('order').insertOne({
      ...order,
      contract: lowerCaseAddress(contract),
      offerer: lowerCaseAddress(offerer),
      fee: fee ? { recipient: lowerCaseAddress(fee.recipient), amount: fee.amount } : null,
    });

    res.status(200).json({ data: 'order created' });
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
    const { tokenIds, offerer }: { tokenIds?: number[]; offerer?: string } = req.body;
    const { contract } = req.params;

    if (offerer && !isAddress(offerer)) {
      res.status(400).json({ error: 'invalid `offerer` field' });
      next();
      return;
    }

    if (tokenIds && !isValidNumberArray(tokenIds)) {
      res.status(400).json({ error: 'invalid `tokenIds` field' });
      next();
      return;
    }

    if (!isAddress(contract)) {
      res.status(400).json({ error: 'invalid `contract`' });
      next();
      return;
    }

    let query: any = {
      contract: lowerCaseAddress(contract),
      allowed: { $ne: false },
      transferred: { $ne: true },
      endTime: { $gt: moment.now() },
    };

    if (!!offerer) {
      query.offerer = lowerCaseAddress(offerer);
    }

    if (!!tokenIds) {
      query.tokenId = { $in: tokenIds };
    }

    const orders = await db.collection<DbOrder>('order').find(query).toArray();

    res.status(200).json({ data: { orders } });
    next();
  } catch (err) {
    next(err);
  }
});

app.post('/activities/list/:contract', async (req, res, next) => {
  try {
    const { address, tokenIds }: { address?: string; tokenIds?: number[] } = req.body;
    const { contract } = req.params;

    if (address && !isAddress(address)) {
      res.status(400).json({ error: 'invalid `address` field' });
      next();
      return;
    }

    if (tokenIds && !isValidNumberArray(tokenIds)) {
      res.status(400).json({ error: 'invalid `tokenIds` field' });
      next();
      return;
    }

    if (!isAddress(contract)) {
      res.status(400).json({ error: 'invalid `contract`' });
      next();
      return;
    }

    let query: any = { contract: lowerCaseAddress(contract) };

    if (!!address) {
      query.$or = [
        { fulfiller: lowerCaseAddress(address) },
        { offerer: lowerCaseAddress(address) },
      ];
    }

    if (!!tokenIds) {
      query.tokenId = { $in: tokenIds };
    }

    const activities = await db
      .collection('activity')
      .find(query, { sort: { createdAt: -1 } })
      .toArray();

    res.status(200).json({ data: { activities } });
    next();
  } catch (err) {
    next(err);
  }
});

app.get('/notifications/list/:contract/:address', async (req, res, next) => {
  try {
    const { address, contract } = req.params;

    if (!isAddress(address)) {
      res.status(400).json({ error: 'invalid `address`' });
      next();
      return;
    }

    if (!isAddress(contract)) {
      res.status(400).json({ error: 'invalid `contract`' });
      next();
      return;
    }

    const query = { contract: lowerCaseAddress(contract), address: lowerCaseAddress(address) };
    const notifications = await db
      .collection('notification')
      .find(query, { projection: { _id: 0 } })
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

    if (notificationIds && !isValidStringArray(notificationIds)) {
      res.status(400).json({ error: 'invalid `notificationIds` field' });
      next();
      return;
    }

    const notificationObjectIds = notificationIds.map((id) => new ObjectId(id));

    const query = { _id: { $in: notificationObjectIds } };
    const notifications = await db.collection('notification').deleteMany(query);

    res.status(200).json({ data: { notifications } });
    next();
  } catch (err) {
    next(err);
  }
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  res.status(500).json({ error: 'Internal server error' });
  next();
  logger.error(err.stack);
});

// Logger
app.use((req, res, next) => {
  const ms = moment.now() - res.locals.startTime;
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

function isValidNumberArray(numArray: any): boolean {
  if (!Array.isArray(numArray)) {
    return false;
  }

  if (
    !numArray.every((num) => {
      return isValidNumber(num);
    })
  ) {
    return false;
  }

  return true;
}

function isValidStringArray(strArray: any): boolean {
  if (!Array.isArray(strArray)) {
    return false;
  }

  if (
    !strArray.every((str) => {
      return isValidString(str);
    })
  ) {
    return false;
  }

  return true;
}

function isValidObject(object: any): boolean {
  return typeof object === 'object' && !Array.isArray(object) && object !== null;
}

function isValidString(string: any): boolean {
  return typeof string === 'string';
}

function isValidNumber(number: any): boolean {
  return typeof number === 'number';
}
