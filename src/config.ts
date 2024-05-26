import { LowerCaseAddress } from './eth';

function fail(varName: string) {
  throw new Error(`${varName} is required.`);
}

const getEnv = (varName: string) => (process.env[varName] || fail(varName)) as string;

export enum EthereumNetwork {
  Mainnet = '1',
  Sepolia = '11155111',
}

export const config = {
  ethereumNetwork: EthereumNetwork.Mainnet,
  db: {
    uri: 'mongodb://localhost:27017',
    name: 'eth-mainnet',
  },
  eth: {
    alchemyApiKey: getEnv('ALCHEMY_API_KEY'),
    openseaApiUrl: 'https://api.opensea.io',
    openseaApiKey: getEnv('OPENSEA_API_KEY'),
    seaportContract: '0x0000000000000068f116a894984e2db1123eb395' as LowerCaseAddress,
    seaportConduitContract: '0x1e0049783f008a0085193e00003d00cd54003c71' as LowerCaseAddress,
    blockedCollectionContracts: [
      '0xb47e3cd837ddf8e4c57f05d70ab865de6e193bbb',
    ] as LowerCaseAddress[],
  },
};
