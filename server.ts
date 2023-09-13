import express from 'express';
import { Alchemy, Network } from 'alchemy-sdk';

const app = express();

const settings = {
  apiKey: '',
  network: Network.ETH_MAINNET,
};

app.get('/', async (req, res) => {
  const alchemy = new Alchemy(settings);
  const nfts = await alchemy.nft.getNftsForOwner('mande.eth', {
    contractAddresses: ['0x960b7a6bcd451c9968473f7bbfd9be826efd549a'],
  });
  res.send(nfts);
});

app.listen(3000, () => {
  console.log(`⚡️[server]: Server is running at http://localhost:3000`);
});
