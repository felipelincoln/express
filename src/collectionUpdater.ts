import { alchemyClient } from './alchemy';
import fs from 'fs';
import { mongoClient } from './mongodb';
import { Order, WithOrderHash, WithSignature } from './server';
import { StopImpersonatingAccountParameters, decodeEventLog } from 'viem';
import seaportABI from './seaport.abi.json';
import erc721ABI from './erc721.abi.json';
import { Log } from 'alchemy-sdk/dist/src/types/types';
import { MongoClient, OrderedBulkOperation, WithId } from 'mongodb';

const mongoDbUri =
  'mongodb+srv://express:unz3JN7zeo5rLK3J@free.ej7kjrx.mongodb.net/?retryWrites=true&w=majority&appName=AtlasApp';

const client = new MongoClient(mongoDbUri);

interface Collection {
  name?: string;
  symbol?: string;
  image?: string;
  contract: string;
  totalSupply: string;
  attributeSummary: { attribute: string; options: string[] }[];
}

interface Token {
  contract: string;
  tokenId: number;
  image?: string;
  rawImage?: string;
  attributes: { name: string; value: string[] }[];
}

let isRunning = false;
async function run() {
  console.log('searching for new contracts to process...');
  isRunning = true;

  const collections = await client
    .db('mongodb')
    .collection<Collection>('collection')
    .find()
    .toArray();

  for (const collection of collections) {
    const totalSupply = Number(collection.totalSupply);
    const tokensCount = await client
      .db('mongodb')
      .collection<Token>('token')
      .countDocuments({ contract: collection.contract });

    if (totalSupply == tokensCount) {
      continue;
    }

    if (totalSupply != tokensCount) {
      console.log(
        `${collection.contract}: [${tokensCount} != ${totalSupply}] - Action: deleted tokens ❌`,
      );
      await client.db('mongodb').collection('token').deleteMany({ contract: collection.contract });
    }

    console.log(`${collection.contract}: [0 / ${totalSupply}] - Action: Processing ⌛`);

    try {
      const inserts = [];
      const tokens = alchemyClient.nft.getNftsForContractIterator(collection.contract);
      for await (const token of tokens) {
        const attributes = token.raw.metadata.attributes.map(
          (attr: { trait_type: string; value: string }) => {
            return { name: attr.trait_type, value: attr.value };
          },
        );

        const newToken: Token = {
          contract: collection.contract,
          tokenId: Number(token.tokenId),
          rawImage: token.image.originalUrl,
          attributes,
        };

        const alchemyImage = token.image.thumbnailUrl;
        if (alchemyImage) {
          newToken.image = alchemyImage;
        }

        inserts.push(client.db('mongodb').collection('token').insertOne(newToken));

        if (Number(token.tokenId) % 1000 == 0) {
          console.log(
            `${collection.contract}: [${token.tokenId} / ${totalSupply}] - Action: Processing ⌛`,
          );
        }
      }

      console.log(
        `${collection.contract}: [${totalSupply} / ${totalSupply}] - Action: Processing ⌛`,
      );
      await Promise.all(inserts);
    } catch (e) {
      console.log(e);
    }
  }

  isRunning = false;

  /*
  const contract = '0x1ddb32a082c369834b57473dd3a5146870ecf8b7';
  const metadata = await alchemyClient.nft.getContractMetadata(contract);
  if (metadata.tokenType != 'ERC721') {
    isRunning = false;
    return;
  }

  const attributes = await alchemyClient.nft.summarizeNftAttributes(contract);
  const attributeSummary = [];

  for (const [k, v] of Object.entries(attributes.summary)) {
    const options = Object.keys(v);
    attributeSummary.push({ attribute: k, options });
  }

  const newCollection: Collection = {
    name: metadata.name,
    symbol: metadata.symbol,
    image: metadata.openSeaMetadata?.imageUrl,
    contract,
    totalSupply: attributes.totalSupply,
    attributeSummary,
  };

  await client.db('mongodb').collection('collection').insertOne(newCollection);
  */
}

setInterval(async () => {
  if (isRunning) return;

  await run();
}, 1_000);
