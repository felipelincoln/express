import express from 'express';
import { Alchemy, Network } from 'alchemy-sdk';

const app = express();

const alchemy = new Alchemy({
  apiKey: process.env.ALCHEMY_API_KEY,
  network: Network.ETH_MAINNET,
});

interface NFT {
  tokenId: string;
  thumbnail?: string;
}

async function getNFTsFromAlchemy(contract: string, user: string, page?: string): Promise<NFT[]> {
  const nftsFromAlchemy = await alchemy.nft.getNftsForOwner(user, {
    contractAddresses: [contract],
    pageKey: page,
  });

  const nfts: NFT[] = nftsFromAlchemy.ownedNfts.map((nft) => {
    return { tokenId: nft.tokenId, thumbnail: nft.media[0]?.thumbnail };
  });

  const nextPage = nftsFromAlchemy.pageKey;

  if (nextPage) {
    const nftsFromNextPage = await getNFTsFromAlchemy(contract, user, nextPage);
    nfts.push(...nftsFromNextPage);
  }

  return nfts;
}

app.get('/nfts/:contract/:user', async (req, res) => {
  const { contract, user } = req.params;
  const nfts = await getNFTsFromAlchemy(contract, user);

  res.json({ data: nfts });
});

app.listen(3000, () => {
  console.log(`⚡️[server]: Server is running at http://localhost:3000`);
});
