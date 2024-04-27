import { alchemyClient } from './alchemy';
import { MongoClient } from 'mongodb';

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
  attributes: string[];
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

    const lastToken = await client
      .db('mongodb')
      .collection<Token>('token')
      .findOne({ contract: collection.contract }, { sort: { tokenId: -1 } });
    const lastTokenId = lastToken?.tokenId;

    console.log(`${collection.name}: [${tokensCount} / ${totalSupply}] - processing ⌛`);

    let newTokensBatch = [];
    let newTokensCount = 0;
    try {
      const tokens = alchemyClient.nft.getNftsForContractIterator(collection.contract, {
        tokenUriTimeoutInMs: 0,
        pageKey: lastTokenId ? (lastTokenId + 1).toString() : undefined,
      });
      for await (const token of tokens) {
        const rawAttributes = token.raw.metadata.attributes;
        const a = collection.attributeSummary.map((entry, index) => [entry.attribute, index]);

        const attributes = token.raw.metadata.attributes.map(
          (attr: { trait_type: string; value: string }) => {
            collection.attributeSummary;
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

        newTokensBatch.push(newToken);
        newTokensCount++;

        if (newTokensBatch.length >= 100) {
          await client.db('mongodb').collection('token').insertMany(newTokensBatch);
          newTokensBatch = [];
          console.log(
            `${collection.name}: [${
              tokensCount + newTokensCount
            } / ${totalSupply}] - processing ⌛`,
          );
        }
      }

      if (newTokensBatch.length > 0) {
        await client.db('mongodb').collection('token').insertMany(newTokensBatch);
        newTokensBatch = [];
        console.log(
          `${collection.name}: [${tokensCount + newTokensCount} / ${totalSupply}] - processing ⌛`,
        );
      }
    } catch (e) {
      if (newTokensBatch.length > 0) {
        await client.db('mongodb').collection('token').insertMany(newTokensBatch);
      }
      console.log(
        `${collection.name}: [${tokensCount + newTokensCount} / ${totalSupply}] - failed ⚠️`,
      );
      continue;
    }
  }

  isRunning = false;
}

setInterval(async () => {
  if (isRunning) return;

  await run();
}, 10_000);
