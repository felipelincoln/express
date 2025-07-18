import { LowerCaseAddress } from './eth';

function fail(varName: string) {
  throw new Error(`${varName} is required.`);
}

const getEnv = (varName: string) => (process.env[varName] || fail(varName)) as string;

export enum Network {
  EthMainnet = '1',
  EthSepolia = '11155111',
  Base = '8453',
  Polygon = '137',
}

function getChain(chainStr: string): Network {
  switch (chainStr) {
    case 'mainnet':
      return Network.EthMainnet;

    case 'sepolia':
      return Network.EthSepolia;

    case 'base':
      return Network.Base;

    case 'polygon':
      return Network.Polygon;

    default:
      return Network.EthMainnet;
  }
}

export const config = {
  network: getChain(getEnv('CHAIN')),
  db: {
    uri: getEnv('MONGO_URI'),
    name: getEnv('MONGO_DBNAME'),
  },
  web3: {
    alchemyApiKey: getEnv('ALCHEMY_API_KEY'),
    openseaApiKey: getEnv('OPENSEA_API_KEY'),
    nftscanApiKey: getEnv('NFTSCAN_API_KEY'),
    openseaApiUrl: 'https://api.opensea.io',
    seaportContract: '0x0000000000000068f116a894984e2db1123eb395' as LowerCaseAddress,
    seaportConduitContract: '0x1e0049783f008a0085193e00003d00cd54003c71' as LowerCaseAddress,
    blockedCollectionContracts: [
      '0xb47e3cd837ddf8e4c57f05d70ab865de6e193bbb', // punks
      '0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85', // ens
    ] as LowerCaseAddress[],
  },
};
