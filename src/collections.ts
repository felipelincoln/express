import raccoolsMetadata from './metadata/raccools.json';

export interface CollectionDetails {
  key: string;
  address: `0x${string}`;
  mintedTokens: string[];
  metadata: { [tokenId: string]: { [attribute: string]: string } };
}

export const supportedCollections = {
  ['raccools']: {
    key: 'raccools',
    address: '0x1dDB32a082c369834b57473Dd3a5146870ECF8B7',
    mintedTokens: Array.from({ length: 6969 }, (_, index) => String(index + 1)),
    metadata: raccoolsMetadata,
  },
} as { [slug: string]: CollectionDetails };
