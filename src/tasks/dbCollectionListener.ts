import { DbToken, createTokenCollection, db } from '../db';
import { alchemyClient, nftScanClient, openseaClient } from '../eth';
import { createLogger } from '../log';

const logger = createLogger();
logger.info('task started');
let isRunning = false;

async function run() {
  isRunning = true;

  const collections = await db.collection.find().toArray();

  for (const collection of collections) {
    const totalSupply = collection.totalSupply;
    const tokensCount = await db.token(collection.contract).countDocuments();

    if (totalSupply == 0) {
      await createTokenCollection(collection.contract);
    }
    if (totalSupply == tokensCount) {
      continue;
    }

    const lastToken = await db.token(collection.contract).findOne({}, { sort: { tokenId: -1 } });
    const lastTokenId = lastToken?.tokenId;

    logger.info(`[${collection.name}] processing (${tokensCount} / ${totalSupply}) ⌛`);

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
      /*
      const tokensAlt = await nftScanClient.asset.getAssetsByContract(collection.contract, {
        cursor: lastTokenId ? '0x' + (lastTokenId + 1).toString(16).padStart(64, '0') : undefined,
      });
      */

      for await (const token of tokens) {
        // TODO: move into alchemy class
        const attributesFromAlchemy = () => {
          try {
            const { attributes } = token.raw.metadata;
            if (Array.isArray(attributes) && attributes.length > 0) {
              return attributes as { trait_type: string; value: string }[];
            }
          } catch (_e) {
            return undefined;
          }
        };

        // TODO: move into opensea class
        const nftFromOpensea = async () => {
          try {
            return await openseaClient.getNFT(collection.contract, token.tokenId);
          } catch (_e) {
            return undefined;
          }
        };

        // TODO: move into nftscan class
        const nftFromNFTScan = async () => {
          try {
            const response = await nftScanClient.asset.getAssetsByContractAndTokenId(
              collection.contract,
              token.tokenId,
            );
            let attributes;
            let image;

            if (response.attributes) {
              attributes = response.attributes.map((attribute) => {
                return { trait_type: attribute.attribute_name, value: attribute.attribute_value };
              });
            }
            if (response.nftscan_uri) {
              image = response.nftscan_uri;
            }

            return { attributes, image };
          } catch (_e) {
            return undefined;
          }
        };

        let image = token.image.thumbnailUrl;
        let attributesArray = attributesFromAlchemy();

        // if not from alchemy - try nftscan
        if (!attributesArray || !image) {
          const response = await nftFromNFTScan();

          if (!attributesArray) {
            attributesArray = response?.attributes;
          }

          if (!image) {
            image = response?.image;
          }
        }

        // if not from nftscan - try opensea
        if (!attributesArray || !image) {
          const response = await nftFromOpensea();

          if (!attributesArray) {
            attributesArray = response?.attributes;
          }

          if (!image) {
            image = response?.image;
          }
        }

        if (!attributesArray) {
          throw new Error(`Failed to fetch attributes for token ${token.tokenId}`);
        }

        const attributes: Record<string, string> = {};
        attributesArray.forEach((attr: { trait_type: string; value: string }) => {
          if (!reverseAttributeSummary[attr.trait_type]) {
            logger.error(`[${collection.name}] is missing the attribute "${attr.trait_type}"`);
            return;
          }

          const { attribute, options } = reverseAttributeSummary[attr.trait_type];
          const attributeValue = options[attr.value];

          attributes[attribute] = attributeValue;
        });

        const newToken: DbToken = {
          tokenId: Number(token.tokenId),
          attributes,
          image,
        };

        newTokensBatch.push(newToken);
        newTokensCount++;

        if (newTokensBatch.length >= 100) {
          await db.token(collection.contract).insertMany(newTokensBatch);
          newTokensBatch = [];
          logger.info(
            `[${collection.name}] processing (${tokensCount + newTokensCount} / ${totalSupply}) ⌛`,
          );

          // alchemy rate limit workaround
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      if (newTokensBatch.length > 0) {
        await db.token(collection.contract).insertMany(newTokensBatch);
        logger.info(
          `[${collection.name}] processing (${tokensCount + newTokensCount} / ${totalSupply}) ⌛`,
        );
      }

      logger.info(`[${collection.name}] finished ✅`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      if (newTokensBatch.length > 0) {
        await db.token(collection.contract).insertMany(newTokensBatch);
      }

      logger.warn(`[${collection.name}] failed (${tokensCount + newTokensCount}) ⚠️`, {
        context: { error: e.message },
      });
      continue;
    }
  }

  isRunning = false;
}

setInterval(async () => {
  if (isRunning) return;

  try {
    await run();
  } catch (e) {
    logger.error('task failed. retrying', { context: e });
  }
}, 10_000);
