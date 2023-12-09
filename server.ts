import express from 'express';
import cors from 'cors';
import { Alchemy, Network } from 'alchemy-sdk';
import { MongoClient } from 'mongodb';

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

interface NFT {
  tokenId: string;
  thumbnail?: string;
}

app.get('/healthcheck', async (req, res) => {
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

app.get('/orders/', async (req, res) => {
  const orders = await client.db('mongodb').collection('orders').find({ tokenId: 100 }).toArray();
  res.json({ data: orders });
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

app.get('/orders/:tokenId', async (req, res) => {
  const { tokenId } = req.params;
  console.log({ tokenId });
  const order = await client
    .db('mongodb')
    .collection('orders')
    .findOne({ tokenId: parseInt(tokenId) });
  console.log({ order });

  res.json({ data: order });
});

app.listen(3000, () => {
  console.log(`⚡️[server]: Server is running at http://localhost:3000`);
});
