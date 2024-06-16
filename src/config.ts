import { LowerCaseAddress } from './eth';

function fail(varName: string) {
  throw new Error(`${varName} is required.`);
}

const getEnv = (varName: string) => (process.env[varName] || fail(varName)) as string;

export enum Network {
  EthMainnet = '1',
  EthSepolia = '11155111',
}

export const config = {
  network: Network.EthMainnet,
  db: {
    uri: 'mongodb+srv://collectoorfelipelincoln:7X4WxFDjj8CYXa2T@cluster0.em5w3pe.mongodb.net/',
    name: 'eth-mainnet',
  },
  web3: {
    alchemyApiKey: getEnv('ALCHEMY_API_KEY'),
    openseaApiKey: getEnv('OPENSEA_API_KEY'),
    nftscanApiKey: getEnv('NFTSCAN_API_KEY'),
    openseaApiUrl: 'https://api.opensea.io',
    seaportContract: '0x0000000000000068f116a894984e2db1123eb395' as LowerCaseAddress,
    seaportConduitContract: '0x1e0049783f008a0085193e00003d00cd54003c71' as LowerCaseAddress,
    blockedCollectionContracts: [
      '0xb47e3cd837ddf8e4c57f05d70ab865de6e193bbb',
    ] as LowerCaseAddress[],
  },
};
