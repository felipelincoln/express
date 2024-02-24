import raccoolsMetadata from './metadata/raccools.json';
import raccoolsSepoliaMetadata from './metadata/raccools-sepolia.json';
import { EthereumNetwork, config } from './config';

function range(start: number, end: number) {
  return Array.from({ length: end }, (_, index) => String(index + start));
}

export interface CollectionDetails {
  key: string;
  address: `0x${string}`;
  mintedTokens: string[];
  metadata: { [tokenId: string]: { [attribute: string]: string } };
}

const mainnetSupportedCollections = {
  ['raccools']: {
    key: 'raccools',
    address: '0x1dDB32a082c369834b57473Dd3a5146870ECF8B7',
    mintedTokens: range(1, 6969),
    metadata: raccoolsMetadata,
  },
} as { [slug: string]: CollectionDetails };

const sepoliaSupportedCollections = {
  ['sep-raccools']: {
    key: 'sep-raccools',
    address: '0x9ba6eba1fe9aa92feb36161009108dcee4ec64f2',
    mintedTokens: range(1, 100),
    metadata: raccoolsSepoliaMetadata,
  },
} as { [slug: string]: CollectionDetails };

export const supportedCollections = (() => {
  switch (config.ethereumNetwork) {
    case EthereumNetwork.Mainnet:
      return mainnetSupportedCollections;
    case EthereumNetwork.Sepolia:
      return sepoliaSupportedCollections;
    default:
      return {};
  }
})();
