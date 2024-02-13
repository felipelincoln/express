export function isValidTokenIds(tokenIds: any): boolean {
  if (!Array.isArray(tokenIds)) {
    return false;
  }

  if (
    !tokenIds.every((tokenId) => {
      return isValidTokenId(tokenId);
    })
  ) {
    return false;
  }

  return true;
}

export function isValidObject(object: any): boolean {
  return typeof object === 'object' && !Array.isArray(object) && object !== null;
}

export function isValidString(string: any): boolean {
  return typeof string === 'string';
}

export function isValidTokenId(tokenId: any): boolean {
  return isValidString(tokenId);
}

export function isValidOrderId(orderId: any): boolean {
  return isValidString(orderId);
}

export function isValidTxnHash(txnHash: any): boolean {
  return isValidString(txnHash);
}

export function isValidAddress(address: string): boolean {
  return isValidString(address);
}

export function isValidOrder(order: any): boolean {
  return true;
}
