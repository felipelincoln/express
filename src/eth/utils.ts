import { isAddress } from 'viem';

export type LowerCaseAddress = string & { __lowerCaseAddress: unknown };

export function lowerCaseAddress(address: string): LowerCaseAddress {
  if (!isAddress(address)) throw new Error('eth.lowerCaseAddress: Invalid address');

  return address.toLowerCase() as LowerCaseAddress;
}
