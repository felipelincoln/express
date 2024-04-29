import { alchemyClient } from './alchemy';
import { MongoClient, ObjectId } from 'mongodb';

const mongoDbUri = 'mongodb://localhost:27017';
//'mongodb+srv://express:unz3JN7zeo5rLK3J@free.ej7kjrx.mongodb.net/?retryWrites=true&w=majority&appName=AtlasApp';

const client = new MongoClient(mongoDbUri);

interface Collection {
  name?: string;
  symbol?: string;
  image?: string;
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
      .countDocuments({ collection_id: collection._id });

    if (totalSupply == tokensCount) {
      continue;
    }

    const lastToken = await client
      .db('mongodb')
      .collection<Token>('token')
      .findOne({ contract: collection.contract }, { sort: { tokenId: -1 } });
    const lastTokenId = lastToken?.tokenId;

    console.log(`${collection.name}: [${tokensCount} / ${totalSupply}] - processing ⌛`);

    const reverseAttributeSummary = Object.fromEntries(
      Object.entries(collection.attributeSummary).map((x) => [
        x[1].attribute,
        {
          attribute: x[0],
          options: Object.fromEntries(Object.entries(x[1].options).map((y) => [y[1], y[0]])),
        },
      ]),
    );

    let newTokensBatch = [];
    let newTokensCount = 0;
    try {
      const tokens = alchemyClient.nft.getNftsForContractIterator(collection.contract, {
        tokenUriTimeoutInMs: 0,
        pageKey: lastTokenId ? (lastTokenId + 1).toString() : undefined,
      });

      for await (const token of tokens) {
        const attributes: Record<string, string> = {};

        token.raw.metadata.attributes.forEach((attr: { trait_type: string; value: string }) => {
          const { attribute, options } = reverseAttributeSummary[attr.trait_type];
          const attributeValue = options[attr.value];

          attributes[attribute] = attributeValue;
        });

        const newToken: Token = {
          collection_id: collection._id,
          tokenId: Number(token.tokenId),
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
